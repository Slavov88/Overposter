import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir } from "./projects.js";
import { testHosted, validTestSubject } from "./identity.js";

export type Role = "owner" | "editor" | "viewer";
type Access = { owner: string; members: Record<string, "editor" | "viewer"> };
type OwnerRow = { owner: string };
type MemberRow = { subject: string; role: "editor" | "viewer" };
const legacyDir = join(dataDir, "access");
const databasePath = join(dataDir, "access.sqlite");
const validSubject = validTestSubject;
let database: DatabaseSync | null = null;
function validProjectId(id: string): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid project ID");
}
function db(): DatabaseSync {
  if (!database) throw new Error("Membership database is not initialized");
  return database;
}
function legacyAccess(raw: unknown, filename: string): Access {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid legacy membership: ${filename}`);
  const value = raw as Record<string, unknown>;
  if (typeof value.owner !== "string" || !validSubject(value.owner) || !value.members || typeof value.members !== "object" || Array.isArray(value.members))
    throw new Error(`Invalid legacy membership: ${filename}`);
  const members: Access["members"] = {};
  for (const [subject, role] of Object.entries(value.members)) {
    if (!validSubject(subject) || subject === value.owner || (role !== "editor" && role !== "viewer"))
      throw new Error(`Invalid legacy membership: ${filename}`);
    members[subject] = role;
  }
  return { owner: value.owner, members };
}

export async function initAccess(options: { allowLegacyMigration?: boolean } = {}): Promise<void> {
  if (!testHosted || database) return;
  await mkdir(dataDir, { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath, { timeout: 5000, defensive: true });
  try {
    connection.exec("PRAGMA foreign_keys=ON");
    const version = (connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 1) throw new Error(`Unsupported membership schema version ${version}`);
    connection.exec("PRAGMA journal_mode=WAL");
    const legacy: { id: string; path: string; filename: string }[] = [];
    try {
      for (const filename of await readdir(legacyDir)) {
        if (!filename.endsWith(".json")) continue;
        const id = filename.slice(0, -5);
        validProjectId(id);
        legacy.push({ id, path: join(legacyDir, filename), filename });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    connection.exec("BEGIN IMMEDIATE");
    try {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS project_access (
          project_id TEXT PRIMARY KEY,
          owner_subject TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_members (
          project_id TEXT NOT NULL REFERENCES project_access(project_id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
          PRIMARY KEY(project_id, subject)
        );
        CREATE TABLE IF NOT EXISTS legacy_migrations (
          project_id TEXT PRIMARY KEY,
          imported_at TEXT NOT NULL
        );
      `);
      for (const { id, path, filename } of legacy) {
        if (connection.prepare("SELECT 1 FROM legacy_migrations WHERE project_id=?").get(id)) continue;
        if (!options.allowLegacyMigration)
          throw new Error("Legacy membership requires the backed-up access:migrate command before startup");
        if (!(await lstat(path)).isFile()) throw new Error(`Legacy membership must be a regular file: ${filename}`);
        const access = legacyAccess(JSON.parse(await readFile(path, "utf8")), filename);
        if (connection.prepare("SELECT 1 FROM project_access WHERE project_id=?").get(id))
          throw new Error(`Legacy membership conflicts with database for project ${id}`);
        connection.prepare("INSERT INTO project_access(project_id, owner_subject) VALUES (?, ?)").run(id, access.owner);
        for (const [subject, role] of Object.entries(access.members))
          connection.prepare("INSERT INTO project_members(project_id, subject, role) VALUES (?, ?, ?)").run(id, subject, role);
        connection.prepare("INSERT INTO legacy_migrations(project_id, imported_at) VALUES (?, ?)").run(id, new Date().toISOString());
      }
      connection.exec("PRAGMA user_version=1; COMMIT");
    } catch (error) { connection.exec("ROLLBACK"); throw error; }
    database = connection;
  } catch (error) { connection.close(); throw error; }
}

export function closeAccess(): void {
  database?.close();
  database = null;
}

export async function createAccess(id: string, owner: string): Promise<void> {
  if (!testHosted) return;
  validProjectId(id);
  if (!validSubject(owner)) throw new Error("Invalid test subject");
  db().prepare("INSERT INTO project_access(project_id, owner_subject) VALUES (?, ?)").run(id, owner);
}
export async function deleteAccess(id: string): Promise<void> {
  if (!testHosted) return;
  validProjectId(id);
  db().prepare("DELETE FROM project_access WHERE project_id=?").run(id);
}
export async function roleFor(id: string, subject: string): Promise<Role | null> {
  if (!testHosted) return "owner";
  validProjectId(id);
  const owner = db().prepare("SELECT owner_subject AS owner FROM project_access WHERE project_id=?").get(id) as OwnerRow | undefined;
  if (!owner) return null;
  if (owner.owner === subject) return "owner";
  const member = db().prepare("SELECT role FROM project_members WHERE project_id=? AND subject=?").get(id, subject) as { role: Role } | undefined;
  return member?.role || null;
}
export async function requireRole(id: string, subject: string, minimum: Role): Promise<Role> {
  const role = await roleFor(id, subject);
  const rank = { viewer: 1, editor: 2, owner: 3 };
  if (!role || rank[role] < rank[minimum])
    throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
  return role;
}
export async function listMembers(id: string): Promise<Access> {
  if (!testHosted) return { owner: "local", members: {} };
  validProjectId(id);
  const owner = db().prepare("SELECT owner_subject AS owner FROM project_access WHERE project_id=?").get(id) as OwnerRow | undefined;
  if (!owner) throw Object.assign(new Error("Project access not found"), { statusCode: 404 });
  const rows = db().prepare("SELECT subject, role FROM project_members WHERE project_id=? ORDER BY subject").all(id) as MemberRow[];
  return { owner: owner.owner, members: Object.fromEntries(rows.map(({ subject, role }) => [subject, role])) };
}
export async function setMember(id: string, subject: string, role: "editor" | "viewer" | null): Promise<void> {
  if (!testHosted) throw Object.assign(new Error("Sharing is unavailable in local mode"), { statusCode: 404 });
  validProjectId(id);
  if (!validSubject(subject)) throw new Error("Invalid test subject");
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const owner = connection.prepare("SELECT owner_subject AS owner FROM project_access WHERE project_id=?").get(id) as OwnerRow | undefined;
    if (!owner) throw Object.assign(new Error("Project access not found"), { statusCode: 404 });
    if (subject === owner.owner) throw new Error("The owner role cannot be changed here");
    if (role) connection.prepare("INSERT INTO project_members(project_id, subject, role) VALUES (?, ?, ?) ON CONFLICT(project_id, subject) DO UPDATE SET role=excluded.role").run(id, subject, role);
    else connection.prepare("DELETE FROM project_members WHERE project_id=? AND subject=?").run(id, subject);
    connection.exec("COMMIT");
  } catch (error) { connection.exec("ROLLBACK"); throw error; }
}
