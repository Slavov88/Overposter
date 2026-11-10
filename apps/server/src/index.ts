import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
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
import { checkpoint, listVersions, readVersionFile, restoreVersion, versionDiff } from "./versions.js";
import { createHash } from "node:crypto";
import { closeAccess, createAccess, deleteAccess, initAccess, listMembers, requireRole, roleFor, setMember, type Role } from "./access.js";
import { identityProvider, subjectForRequest, testHosted, validTestSubject } from "./identity.js";
import { closeProject, closeRevoked, flushProject, registerCollaboration, reloadAfterRestore, replaceFromRest } from "./collaboration.js";
import { readOverrootLink, removeOverrootLink, setOverrootLink } from "./links.js";

if (process.env.OVERPOSTER_MODE === "hosted")
  throw new Error("Hosted mode needs a configured identity provider and isolated compile worker; startup is disabled until both are implemented.");
if (testHosted && (process.env.NODE_ENV !== "test" || process.env.OVERPOSTER_TEST_IDENTITIES !== "1"))
  throw new Error("Test identities require an explicit test environment and must not be used for public hosting.");
await initAccess();
const app = Fastify({ logger: true, bodyLimit: 10_000_000 });
app.addHook("onClose", async () => { closeAccess(); });
const port = Number(process.env.PORT || 4318);
const fileWrites = new Map<string, Promise<void>>();
const etag = (bytes: Buffer) => `"${createHash("sha256").update(bytes).digest("hex")}"`;
await app.register(multipart, { limits: { fileSize: 30_000_000 } });
await app.register(websocket, { options: { maxPayload: 1_000_000 } });
app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (
    origin &&
    ![
      "http://127.0.0.1:4318",
      "http://localhost:4318",
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      `http://127.0.0.1:${process.env.OVERPOSTER_WEB_PORT || 5173}`,
      `http://localhost:${process.env.OVERPOSTER_WEB_PORT || 5173}`,
    ].includes(origin)
  )
    reply
      .code(403)
      .send({ error: "This local workspace rejects cross-site requests" });
});
app.addHook("preHandler", async (request) => {
  if (!testHosted || !request.url.startsWith("/api/")) return;
  if (request.url.startsWith("/api/health") || request.url.startsWith("/api/templates") || request.url.startsWith("/api/test-session")) return;
  const subject = await subjectForRequest(request);
  const match = /^\/api\/projects\/([a-f0-9-]{36})(?:[/?]|$)/.exec(request.url);
  if (!match) return;
  let minimum: Role = request.method === "GET" || request.method === "HEAD" ? "viewer" : "editor";
  if (request.method === "DELETE" && /^\/api\/projects\/[^/]+(?:\?|$)/.test(request.url)) minimum = "owner";
  if (request.url.includes("/members")) minimum = "owner";
  if (request.url.includes("/overroot-link") && request.method !== "GET") minimum = "owner";
  await requireRole(match[1], subject, minimum);
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
app.get("/api/session", async (request) => ({ mode: identityProvider.mode, subject: await subjectForRequest(request) }));
app.post("/api/test-session", async (request, reply) => {
  if (!testHosted) return reply.code(404).send({ error: "Not found" });
  const { subject } = z.object({ subject: z.string() }).parse(request.body);
  if (!validTestSubject(subject)) return reply.code(400).send({ error: "Invalid test subject" });
  reply.header("Set-Cookie", `overposter_test_subject=${encodeURIComponent(subject)}; HttpOnly; SameSite=Strict; Path=/`);
  return { subject };
});
app.get("/api/templates", async () => templateIds);
app.get("/api/projects", async (request) => {
  const projects = await listProjects();
  if (!testHosted) return projects;
  const subject = await subjectForRequest(request);
  const roles = await Promise.all(projects.map((project) => roleFor(project.id, subject)));
  return projects.filter((_, index) => roles[index] !== null);
});
app.post("/api/projects", async (request) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(120),
      config: posterConfigPatchSchema.optional(),
    })
    .parse(request.body);
  const project = await createProject(body.name, body.config || {});
  await createAccess(project.id, await subjectForRequest(request));
  return project;
});
app.post("/api/import", async (request) => {
  const file = await request.file();
  if (!file) throw new Error("Select a ZIP file");
  const project = await importZip(file.filename.replace(/\.zip$/i, ""), await file.toBuffer());
  await createAccess(project.id, await subjectForRequest(request));
  return project;
});
app.get<{ Params: { id: string } }>("/api/projects/:id/members", async (request) => listMembers(request.params.id));
app.get<{ Params: { id: string } }>("/api/projects/:id/role", async (request) => ({ role: await roleFor(request.params.id, await subjectForRequest(request)) }));
app.get<{ Params: { id: string } }>("/api/projects/:id/overroot-link", async (request) => readOverrootLink(request.params.id));
app.put<{ Params: { id: string } }>("/api/projects/:id/overroot-link", async (request) => {
  const input = z.object({ projectId: z.string(), url: z.string(), expectedVersion: z.string().nullable() }).parse(request.body);
  return setOverrootLink(request.params.id, input, await subjectForRequest(request));
});
app.delete<{ Params: { id: string } }>("/api/projects/:id/overroot-link", async (request) => {
  const { expectedVersion } = z.object({ expectedVersion: z.string().nullable() }).parse(request.body);
  return removeOverrootLink(request.params.id, expectedVersion);
});
app.put<{ Params: { id: string; subject: string } }>("/api/projects/:id/members/:subject", async (request) => {
  const { role } = z.object({ role: z.enum(["editor", "viewer"]) }).parse(request.body);
  await setMember(request.params.id, request.params.subject, role);
  closeRevoked(request.params.id, request.params.subject);
  return { ok: true };
});
app.delete<{ Params: { id: string; subject: string } }>("/api/projects/:id/members/:subject", async (request) => {
  await setMember(request.params.id, request.params.subject, null);
  closeRevoked(request.params.id, request.params.subject);
  return { ok: true };
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
app.get<{ Params: { id: string } }>("/api/projects/:id/versions", async (request) => listVersions(request.params.id));
app.post<{ Params: { id: string } }>("/api/projects/:id/versions", async (request) => {
  const { message } = z.object({ message: z.string().min(1).max(120) }).parse(request.body);
  await flushProject(request.params.id);
  return { id: await checkpoint(request.params.id, message) };
});
app.get<{ Params: { id: string; sha: string }; Querystring: { path: string } }>("/api/projects/:id/versions/:sha/file", async (request) => ({ content: await readVersionFile(request.params.id, request.params.sha, request.query.path) }));
app.get<{ Params: { id: string; sha: string }; Querystring: { to?: string } }>("/api/projects/:id/versions/:sha/diff", async (request) => ({ diff: await versionDiff(request.params.id, request.params.sha, request.query.to) }));
app.post<{ Params: { id: string; sha: string } }>("/api/projects/:id/versions/:sha/restore", async (request) => {
  const { expectedHead } = z.object({ expectedHead: z.string() }).parse(request.body);
  await flushProject(request.params.id);
  const id = await restoreVersion(request.params.id, request.params.sha, expectedHead);
  await reloadAfterRestore(request.params.id);
  return { id };
});
app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
  await closeProject(request.params.id);
  await deleteProject(request.params.id);
  await deleteAccess(request.params.id);
  return { ok: true };
});
app.get<{ Params: { id: string } }>(
  "/api/projects/:id/files",
  async (request) => listFiles(request.params.id),
);
app.get<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/projects/:id/file",
  async (request, reply) => {
    await flushProject(request.params.id);
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
      await flushProject(request.params.id);
      let current: Buffer | undefined;
      try { current = await readProjectFile(request.params.id, request.query.path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const expected = request.headers["if-match"];
      if (testHosted && current && !expected)
        return reply.code(428).send({ error: "Use the current file ETag when saving shared source" });
      if (expected && (!current || etag(current) !== expected))
        return reply.code(409).send({ conflict: true, currentEtag: current ? etag(current) : null });
      if (testHosted) await replaceFromRest(request.params.id, request.query.path, request.body as string);
      else await writeProjectFile(request.params.id, request.query.path, request.body as string);
      return { ok: true, etag: etag(Buffer.from(request.body as string)) };
    } finally {
      release();
      if (fileWrites.get(key) === next) fileWrites.delete(key);
    }
  },
);
app.post<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/projects/:id/upload",
  async (request, reply) => {
    const path = request.query.path;
    if (!/^figures\/[^./\\\x00-\x1f][^/\\\x00-\x1f]*\.(pdf|png|jpe?g)$/i.test(path))
      return reply.code(400).send({ error: "Figures must be PDF, PNG, or JPEG files in figures/" });
    const file = await request.file();
    if (!file) throw new Error("Select a file");
    try {
      await writeProjectFile(request.params.id, path, await file.toBuffer(), { createOnly: true });
      return { ok: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return reply.code(409).send({ error: "A figure with this name already exists. Rename the upload first." });
      throw error;
    }
  },
);
app.post<{ Params: { id: string } }>(
  "/api/projects/:id/build",
  async (request) => {
    await flushProject(request.params.id);
    const result = await buildProject(request.params.id);
    if (result.ok && !result.cached) {
      try { await checkpoint(request.params.id, "Successful compile"); }
      catch (error) { result.log += "\nCheckpoint failed: " + (error instanceof Error ? error.message : String(error)); }
    }
    return result;
  },
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
    await flushProject(request.params.id);
    const bytes = await exportZip(request.params.id);
    reply
      .type("application/zip")
      .header("Content-Disposition", 'attachment; filename="poster-source.zip"')
      .send(Buffer.from(bytes));
  },
);
await registerCollaboration(app);
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
await app.listen({ host: "127.0.0.1", port });
