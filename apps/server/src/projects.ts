import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  cp,
  copyFile,
  rm,
  stat,
  lstat,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  posterConfigSchema,
  parsePosterConfig,
  defaults,
  configTex,
  safePath,
  type PosterConfig,
  templateIds,
} from "./model.js";
import {
  ZipReader,
  BlobReader,
  BlobWriter,
  ZipWriter,
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js";

export const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const dataDir = resolve(
  process.env.OVERPOSTER_DATA || join(root, ".overposter"),
);
export const projectsDir = join(dataDir, "projects");
export type Project = {
  id: string;
  name: string;
  config: PosterConfig;
  updatedAt: string;
  imported?: boolean;
  trusted?: boolean;
};
const projectDir = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid project ID");
  return join(projectsDir, id);
};
const filesDir = (id: string) => join(projectDir(id), "source");
function within(base: string, path: string) {
  const full = resolve(base, path);
  if (full !== base && !full.startsWith(base + sep))
    throw new Error("Unsafe project path");
  return full;
}
export async function listProjects(): Promise<Project[]> {
  await mkdir(projectsDir, { recursive: true });
  const ids = await readdir(projectsDir);
  const all = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getProject(id);
      } catch {
        return null;
      }
    }),
  );
  return all
    .filter((x): x is Project => !!x)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id: string): Promise<Project> {
  const project = JSON.parse(
    await readFile(join(projectDir(id), "project.json"), "utf8"),
  ) as Project;
  return { ...project, config: parsePosterConfig(project.config) };
}
export async function createProject(
  name: string,
  input: Partial<PosterConfig> = {},
  useTemplate = true,
): Promise<Project> {
  const config = posterConfigSchema.parse({ ...defaults, ...input });
  const id = randomUUID();
  const target = projectDir(id);
  await mkdir(filesDir(id), { recursive: true });
  if (useTemplate)
    await cp(join(root, "templates", config.theme), filesDir(id), {
      recursive: true,
    });
  if (useTemplate)
    await copyFile(join(root, "templates", "shared", "poster-layout.tex"), join(filesDir(id), "poster-layout.tex"));
  await mkdir(join(filesDir(id), "figures"), { recursive: true });
  await mkdir(join(filesDir(id), "assets"), { recursive: true });
  const project = {
    id,
    name: name.trim() || config.title,
    config,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(target, "project.json"),
    JSON.stringify(project, null, 2) + "\n",
  );
  await writeFile(join(filesDir(id), "config.tex"), configTex(config));
  await writeFile(join(filesDir(id), "poster.json"), JSON.stringify(config, null, 2) + "\n");
  return project;
}
export async function updateProject(
  id: string,
  changes: Partial<PosterConfig>,
): Promise<Project> {
  const project = await getProject(id);
  if (changes.theme && changes.theme !== project.config.theme)
    throw new Error("Create a new project to change the layout");
  const config = posterConfigSchema.parse({ ...project.config, ...changes });
  project.config = config;
  project.updatedAt = new Date().toISOString();
  await writeFile(
    join(projectDir(id), "project.json"),
    JSON.stringify(project, null, 2) + "\n",
  );
  await writeFile(join(filesDir(id), "config.tex"), configTex(config));
  await writeFile(join(filesDir(id), "poster.json"), JSON.stringify(config, null, 2) + "\n");
  return project;
}
export async function deleteProject(id: string) {
  await rm(projectDir(id), { recursive: true });
  const output = join(dataDir, "builds", `${id}.pdf`);
  await Promise.all([
    rm(output, { force: true }),
    rm(output + ".sha256", { force: true }),
    rm(output + ".preflight.json", { force: true }),
    rm(join(dataDir, "versions", `${id}.git`), { recursive: true, force: true }),
    rm(join(dataDir, "collaboration", id), { recursive: true, force: true }),
  ]);
}
export async function listFiles(id: string): Promise<string[]> {
  const base = filesDir(id);
  const result: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else result.push(full.slice(base.length + 1).replaceAll("\\", "/"));
    }
  }
  await walk(base);
  return result.sort();
}
export async function readProjectFile(
  id: string,
  path: string,
): Promise<Buffer> {
  return readFile(within(filesDir(id), safePath(path)));
}
export async function writeProjectFile(
  id: string,
  path: string,
  data: Buffer | string,
  options: { createOnly?: boolean } = {},
): Promise<void> {
  await getProject(id);
  const base = filesDir(id);
  const full = within(base, safePath(path));
  if (path === "config.tex")
    throw new Error("Edit poster configuration instead");
  if (Buffer.byteLength(data) > 8_000_000) throw new Error("File too large");
  await mkdir(dirname(full), { recursive: true });
  let cursor = dirname(full);
  while (cursor.startsWith(base) && cursor !== base) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error("Symbolic links are not allowed in projects");
    cursor = dirname(cursor);
  }
  try {
    if ((await lstat(full)).isSymbolicLink())
      throw new Error("Symbolic links are not allowed in projects");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(full, data, options.createOnly ? { flag: "wx" } : undefined);
}
export async function trustImportedProject(id: string): Promise<Project> {
  if (process.env.OVERPOSTER_MODE && process.env.OVERPOSTER_MODE !== "local")
    throw new Error("Imported source cannot be trusted for direct compilation in hosted mode");
  const project = await getProject(id);
  if (!project.imported) throw new Error("Only imported projects need approval");
  project.trusted = true;
  await writeFile(join(projectDir(id), "project.json"), JSON.stringify(project, null, 2) + "\n");
  return project;
}
export async function sourceDir(id: string) {
  await getProject(id);
  return filesDir(id);
}
export async function importZip(
  name: string,
  bytes: Uint8Array,
): Promise<Project> {
  if (bytes.length > 30_000_000) throw new Error("ZIP is too large");
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(bytes)])));
  const entries = await reader.getEntries();
  if (entries.length > 150) throw new Error("Too many files");
  const contents = new Map<string, Uint8Array>();
  let total = 0;
  try {
    for (const e of entries) {
      if (e.directory) continue;
      const path = safePath(e.filename);
      if (e.unixMode && (e.unixMode & 0o170000) === 0o120000)
        throw new Error("ZIP cannot include symbolic links");
      if (e.uncompressedSize > 8_000_000) throw new Error("File too large");
      total += e.uncompressedSize;
      if (total > 40_000_000) throw new Error("ZIP expands too large");
      if (contents.has(path)) throw new Error("Duplicate ZIP path");
      const writer = new Uint8ArrayWriter();
      const data = await e.getData!(writer);
      if (data.byteLength !== e.uncompressedSize) throw new Error("ZIP size mismatch");
      contents.set(path, data);
    }
  } finally {
    await reader.close();
  }
  if (!contents.has("poster.tex"))
    throw new Error("ZIP needs poster.tex at its root");
  let config: PosterConfig = defaults;
  if (contents.has("poster.json"))
    config = parsePosterConfig(
      JSON.parse(new TextDecoder().decode(contents.get("poster.json"))),
    );
  const project = await createProject(name, { ...config }, false);
  project.imported = true;
  await writeFile(
    join(projectDir(project.id), "project.json"),
    JSON.stringify(project, null, 2) + "\n",
  );
  for (const [path, data] of contents) {
    if (path === "config.tex" || path === "poster.json") continue;
    await writeProjectFile(project.id, path, Buffer.from(data));
  }
  return project;
}
export async function exportZip(id: string): Promise<Uint8Array> {
  const project = await getProject(id);
  const writer = new BlobWriter();
  const zip = new ZipWriter(writer);
  for (const path of await listFiles(id)) {
    if (path === "poster.json") continue;
    await zip.add(path, new Uint8ArrayReader(await readProjectFile(id, path)));
  }
  await zip.add(
    "poster.json",
    new TextReader(JSON.stringify(project.config, null, 2)),
  );
  await zip.close();
  return new Uint8Array(await (await writer.getData()).arrayBuffer());
}
export async function projectExists(id: string) {
  try {
    await stat(projectDir(id));
    return true;
  } catch {
    return false;
  }
}
export { templateIds };
