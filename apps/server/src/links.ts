import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProject, projectsDir } from "./projects.js";

export type OverrootLink = { projectId: string; url: string; linkedAt: string; linkedBy: string };
type LinkState = { link: OverrootLink | null; version: string | null };
const locks = new Map<string, Promise<void>>();
const origin = new URL(process.env.OVERPOSTER_OVERROOT_ORIGIN || "https://overroot.toni.foo");
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
  throw new Error("OVERPOSTER_OVERROOT_ORIGIN must be an HTTPS origin");

function linkPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid project ID");
  return join(projectsDir, id, "overroot-link.json");
}
function conflict(): Error {
  return Object.assign(new Error("This link changed elsewhere. Reload it before editing."), { statusCode: 409 });
}
async function serialized<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(id, next);
  await previous;
  try { return await action(); }
  finally { release(); if (locks.get(id) === next) locks.delete(id); }
}
export async function readOverrootLink(id: string): Promise<LinkState> {
  await getProject(id);
  try {
    const bytes = await readFile(linkPath(id));
    return { link: JSON.parse(bytes.toString("utf8")) as OverrootLink, version: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { link: null, version: null };
    throw error;
  }
}
export async function setOverrootLink(id: string, input: { projectId: string; url: string; expectedVersion: string | null }, subject: string): Promise<LinkState> {
  return serialized(id, async () => {
    const current = await readOverrootLink(id);
    if (current.version !== input.expectedVersion) throw conflict();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId)) throw new Error("Enter a stable Overroot project ID");
    let url: URL;
    try { url = new URL(input.url); } catch { throw new Error("Enter a valid Overroot project URL"); }
    if (url.origin !== origin.origin || url.pathname === "/" || url.search || url.hash || url.username || url.password)
      throw new Error(`Link must be a project page at ${origin.origin} without a query or fragment`);
    const link: OverrootLink = { projectId: input.projectId, url: url.href, linkedAt: new Date().toISOString(), linkedBy: subject };
    const destination = linkPath(id);
    const temp = destination + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(link, null, 2) + "\n", { flag: "wx" });
      await rename(temp, destination);
    } finally { await rm(temp, { force: true }); }
    return readOverrootLink(id);
  });
}
export async function removeOverrootLink(id: string, expectedVersion: string | null): Promise<LinkState> {
  return serialized(id, async () => {
    const current = await readOverrootLink(id);
    if (current.version !== expectedVersion) throw conflict();
    if (current.link) await rm(linkPath(id));
    return { link: null, version: null };
  });
}
