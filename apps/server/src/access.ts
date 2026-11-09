import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyRequest } from "fastify";
import { dataDir } from "./projects.js";

export type Role = "owner" | "editor" | "viewer";
type Access = { owner: string; members: Record<string, "editor" | "viewer"> };
export const testHosted = process.env.OVERPOSTER_MODE === "test-hosted";
const accessDir = join(dataDir, "access");
const locks = new Map<string, Promise<void>>();
const validSubject = (value: string) => /^[a-z][a-z0-9_.-]{0,63}$/i.test(value) && !["__proto__", "constructor", "prototype"].includes(value.toLowerCase());

export function testSubject(request: FastifyRequest): string {
  if (!testHosted) return "local";
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("overposter_test_subject="));
  const value = request.headers["x-overposter-test-subject"] ?? (cookie ? decodeURIComponent(cookie.slice("overposter_test_subject=".length)) : undefined);
  if (typeof value !== "string" || !validSubject(value))
    throw Object.assign(new Error("A test identity is required"), { statusCode: 401 });
  return value;
}

export function validTestSubject(value: string): boolean { return validSubject(value); }

function accessPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid project ID");
  return join(accessDir, `${id}.json`);
}

async function readAccess(id: string): Promise<Access> {
  return JSON.parse(await readFile(accessPath(id), "utf8")) as Access;
}

async function writeAccess(id: string, value: Access): Promise<void> {
  await mkdir(accessDir, { recursive: true });
  const path = accessPath(id);
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
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

export async function createAccess(id: string, owner: string): Promise<void> {
  if (testHosted) await writeAccess(id, { owner, members: {} });
}

export async function deleteAccess(id: string): Promise<void> {
  if (testHosted) await rm(accessPath(id), { force: true });
}

export async function roleFor(id: string, subject: string): Promise<Role | null> {
  if (!testHosted) return "owner";
  try {
    const access = await readAccess(id);
    return access.owner === subject ? "owner" : Object.hasOwn(access.members, subject) ? access.members[subject] : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function requireRole(id: string, subject: string, minimum: Role): Promise<Role> {
  const role = await roleFor(id, subject);
  const rank = { viewer: 1, editor: 2, owner: 3 };
  if (!role || rank[role] < rank[minimum])
    throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
  return role;
}

export async function listMembers(id: string): Promise<Access> {
  return readAccess(id);
}

export async function setMember(id: string, subject: string, role: "editor" | "viewer" | null): Promise<void> {
  if (!validSubject(subject)) throw new Error("Invalid test subject");
  await serialized(id, async () => {
    const access = await readAccess(id);
    if (subject === access.owner) throw new Error("The owner role cannot be changed here");
    if (role) access.members[subject] = role;
    else delete access.members[subject];
    await writeAccess(id, access);
  });
}
