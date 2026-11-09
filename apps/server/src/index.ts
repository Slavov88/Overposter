import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildProject } from "./compiler.js";
import {
  createProject,
  deleteProject,
  exportZip,
  getProject,
  importZip,
  listFiles,
  listProjects,
  readProjectFile,
  root,
  updateProject,
  writeProjectFile,
  dataDir,
  trustImportedProject,
} from "./projects.js";
import { templateIds } from "./model.js";
import { posterConfigPatchSchema } from "./model.js";
import { z } from "zod";
import { createHash } from "node:crypto";

if (process.env.OVERPOSTER_MODE === "hosted")
  throw new Error("Hosted mode needs a configured identity provider and isolated compile worker; startup is disabled until both are implemented.");
const app = Fastify({ logger: true, bodyLimit: 10_000_000 });
const fileWrites = new Map<string, Promise<void>>();
const etag = (bytes: Buffer) => `"${createHash("sha256").update(bytes).digest("hex")}"`;
await app.register(multipart, { limits: { fileSize: 30_000_000 } });
app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (
    origin &&
    ![
      "http://127.0.0.1:4318",
      "http://localhost:4318",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ].includes(origin)
  )
    reply
      .code(403)
      .send({ error: "This local workspace rejects cross-site requests" });
});
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const err = error as Error & { statusCode?: number; code?: string };
  if (err.code === "ENOENT") {
    reply.code(404).send({ error: "Project or file not found" });
    return;
  }
  reply
    .code(err.statusCode && err.statusCode < 500 ? err.statusCode : 400)
    .send({ error: err.message });
});
app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));
app.get("/api/templates", async () => templateIds);
app.get("/api/projects", listProjects);
app.post("/api/projects", async (request) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(120),
      config: posterConfigPatchSchema.optional(),
    })
    .parse(request.body);
  return createProject(body.name, body.config || {});
});
app.post("/api/import", async (request) => {
  const file = await request.file();
  if (!file) throw new Error("Select a ZIP file");
  return importZip(file.filename.replace(/\.zip$/i, ""), await file.toBuffer());
});
app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) =>
  getProject(request.params.id),
);
app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) =>
  updateProject(request.params.id, request.body as Record<string, unknown>),
);
app.post<{ Params: { id: string } }>("/api/projects/:id/trust", async (request) =>
  trustImportedProject(request.params.id),
);
app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
  await deleteProject(request.params.id);
  return { ok: true };
});
app.get<{ Params: { id: string } }>(
  "/api/projects/:id/files",
  async (request) => listFiles(request.params.id),
);
app.get<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/projects/:id/file",
  async (request, reply) => {
    const bytes = await readProjectFile(request.params.id, request.query.path);
    reply
      .header("ETag", etag(bytes))
      .type(
        /\.(tex|bib|txt|md|json)$/i.test(request.query.path)
          ? "text/plain; charset=utf-8"
          : "application/octet-stream",
      )
      .send(bytes);
  },
);
app.put<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/projects/:id/file",
  async (request, reply) => {
    const key = `${request.params.id}:${request.query.path}`;
    const previous = fileWrites.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    fileWrites.set(key, next);
    await previous;
    try {
      let current: Buffer | undefined;
      try { current = await readProjectFile(request.params.id, request.query.path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const expected = request.headers["if-match"];
      if (expected && (!current || etag(current) !== expected))
        return reply.code(409).send({ conflict: true, currentEtag: current ? etag(current) : null });
      await writeProjectFile(request.params.id, request.query.path, request.body as string);
      return { ok: true, etag: etag(Buffer.from(request.body as string)) };
    } finally {
      release();
      if (fileWrites.get(key) === next) fileWrites.delete(key);
    }
  },
);
app.post<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/projects/:id/upload",
  async (request) => {
    const file = await request.file();
    if (!file) throw new Error("Select a file");
    await writeProjectFile(
      request.params.id,
      request.query.path,
      await file.toBuffer(),
    );
    return { ok: true };
  },
);
app.post<{ Params: { id: string } }>(
  "/api/projects/:id/build",
  async (request) => buildProject(request.params.id),
);
app.get<{ Params: { id: string } }>(
  "/api/projects/:id/pdf",
  async (request, reply) => {
    await getProject(request.params.id);
    const path = join(dataDir, "builds", `${request.params.id}.pdf`);
    await stat(path);
    reply
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="poster.pdf"`)
      .send(await readFile(path));
  },
);
app.get<{ Params: { id: string } }>(
  "/api/projects/:id/export",
  async (request, reply) => {
    const bytes = await exportZip(request.params.id);
    reply
      .type("application/zip")
      .header("Content-Disposition", 'attachment; filename="poster-source.zip"')
      .send(Buffer.from(bytes));
  },
);
const webDist = join(root, "apps", "web", "dist");
try {
  await stat(webDist);
  await app.register(staticPlugin, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/"))
      reply.code(404).send({ error: "Not found" });
    else reply.sendFile("index.html");
  });
} catch {}
const port = Number(process.env.PORT || 4318);
await app.listen({ host: "127.0.0.1", port });
