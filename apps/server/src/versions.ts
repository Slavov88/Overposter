import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir, getProject, sourceDir } from "./projects.js";
import { configTex, parsePosterConfig, safePath } from "./model.js";
import { runCommand } from "./compiler.js";

export type Version = { id: string; author: string; timestamp: string; message: string; files: string[] };
const locks = new Map<string, Promise<void>>();
async function serialized<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(id, next);
  await previous;
  try { return await action(); }
  finally { release(); if (locks.get(id) === next) locks.delete(id); }
}
async function context(id: string) {
  const source = await sourceDir(id);
  const gitDir = join(dataDir, "versions", id + ".git");
  const hookDir = join(dataDir, "versions", "disabled-hooks");
  await mkdir(hookDir, { recursive: true });
  try { await stat(join(gitDir, "HEAD")); }
  catch {
    await mkdir(gitDir, { recursive: true });
    const init = await runCommand("git", ["init", "--bare", gitDir], 15000);
    if (init.code !== 0) throw new Error("Could not initialize project history: " + init.log);
  }
  return { source, gitDir, hookDir };
}
async function git(id: string, args: string[]): Promise<string> {
  const { source, gitDir, hookDir } = await context(id);
  const result = await runCommand("git", [
    "-c", "user.name=Overposter",
    "-c", "user.email=local@overposter.invalid",
    "-c", "core.autocrlf=false",
    "-c", "core.hooksPath=" + hookDir,
    "--git-dir=" + gitDir, "--work-tree=" + source,
    ...args,
  ], 30000);
  if (result.code !== 0) throw new Error("Version operation failed: " + result.log);
  return result.log;
}
async function head(id: string): Promise<string | null> {
  try { return (await git(id, ["rev-parse", "HEAD"])).trim(); } catch { return null; }
}
async function checkpointUnlocked(id: string, message: string): Promise<string> {
  const project = await getProject(id);
  const source = await sourceDir(id);
  await writeFile(join(source, "poster.json"), JSON.stringify(project.config, null, 2) + "\n");
  await writeFile(join(source, "config.tex"), configTex(project.config));
  await git(id, ["add", "--all", "--", "."]);
  await git(id, ["commit", "--allow-empty", "--no-gpg-sign", "-m", message]);
  return (await head(id))!;
}
export async function checkpoint(id: string, message: string): Promise<string> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 120) throw new Error("Checkpoint name must be 1–120 characters");
  return serialized(id, () => checkpointUnlocked(id, trimmed));
}
export async function listVersions(id: string): Promise<{ head: string | null; versions: Version[] }> {
  await getProject(id);
  const current = await head(id);
  if (!current) return { head: null, versions: [] };
  const lines = (await git(id, ["log", "-n", "50", "--format=%H%x09%an%x09%aI%x09%s"])).split(/\r?\n/).filter(Boolean);
  const versions: Version[] = [];
  for (const line of lines) {
    const [versionId, author, timestamp, message] = line.split("\t");
    const files = (await git(id, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", versionId])).split(/\r?\n/).filter(Boolean);
    versions.push({ id: versionId, author, timestamp, message, files });
  }
  return { head: current, versions };
}
function validSha(sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Invalid version ID");
}
export async function versionDiff(id: string, from: string, to?: string): Promise<string> {
  validSha(from);
  if (to) validSha(to);
  await getProject(id);
  return git(id, ["diff", "--no-ext-diff", from, to || "HEAD", "--", "."]);
}
export async function readVersionFile(id: string, sha: string, path: string): Promise<string> {
  validSha(sha);
  const relative = safePath(path);
  if (!/\.(tex|bib|txt|md|json)$/i.test(relative)) throw new Error("Only text files can be previewed");
  await getProject(id);
  return git(id, ["show", sha + ":" + relative]);
}
export async function restoreVersion(id: string, sha: string, expectedHead: string): Promise<string> {
  validSha(sha);
  validSha(expectedHead);
  return serialized(id, async () => {
    const current = await head(id);
    if (current !== expectedHead) throw new Error("Project history changed. Refresh versions before restoring.");
    await checkpointUnlocked(id, "Before restore");
    await git(id, ["cat-file", "-e", sha + "^{commit}"]);
    await git(id, ["restore", "--source=" + sha, "--staged", "--worktree", "--", "."]);
    const source = await sourceDir(id);
    const restoredConfig = parsePosterConfig(JSON.parse(await readFile(join(source, "poster.json"), "utf8")));
    const project = await getProject(id);
    project.config = restoredConfig;
    project.updatedAt = new Date().toISOString();
    await writeFile(join(dataDir, "projects", id, "project.json"), JSON.stringify(project, null, 2) + "\n");
    await git(id, ["add", "--all", "--", "."]);
    await git(id, ["commit", "--allow-empty", "--no-gpg-sign", "-m", "Restore " + sha.slice(0, 10)]);
    return (await head(id))!;
  });
}
