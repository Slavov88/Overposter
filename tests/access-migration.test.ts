import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const originalData = process.env.OVERPOSTER_DATA;
const originalMode = process.env.OVERPOSTER_MODE;
const directories: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "overposter-access-migration-"));
  directories.push(path);
  return path;
}
async function load(path: string) {
  process.env.OVERPOSTER_DATA = path;
  process.env.OVERPOSTER_MODE = "test-hosted";
  vi.resetModules();
  return import("../apps/server/src/access.js");
}
afterEach(async () => {
  if (originalData === undefined) delete process.env.OVERPOSTER_DATA;
  else process.env.OVERPOSTER_DATA = originalData;
  if (originalMode === undefined) delete process.env.OVERPOSTER_MODE;
  else process.env.OVERPOSTER_MODE = originalMode;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("copies legacy grants into SQLite once and never revives a deleted project", async () => {
  const path = await directory();
  const id = randomUUID();
  const legacy = join(path, "access", `${id}.json`);
  await mkdir(join(path, "access"));
  const original = JSON.stringify({ owner: "alice", members: { bob: "editor", carol: "viewer" } }, null, 2);
  await writeFile(legacy, original);
  const first = await load(path);
  await expect(first.initAccess()).rejects.toThrow("backed-up access:migrate");
  await first.initAccess({ allowLegacyMigration: true });
  expect(await first.roleFor(id, "alice")).toBe("owner");
  expect(await first.roleFor(id, "carol")).toBe("viewer");
  await first.setMember(id, "bob", "viewer");
  expect(await readFile(legacy, "utf8")).toBe(original);
  first.closeAccess();
  await writeFile(legacy, "{ outdated rollback copy");

  const second = await load(path);
  await second.initAccess();
  expect(await second.roleFor(id, "bob")).toBe("viewer");
  await second.deleteAccess(id);
  second.closeAccess();

  const third = await load(path);
  await third.initAccess();
  expect(await third.roleFor(id, "alice")).toBeNull();
  expect(await readFile(legacy, "utf8")).toBe("{ outdated rollback copy");
  third.closeAccess();
});

it("rejects invalid legacy data without modifying the original file", async () => {
  const path = await directory();
  const id = randomUUID();
  const legacy = join(path, "access", `${id}.json`);
  await mkdir(join(path, "access"));
  const original = JSON.stringify({ owner: "alice", members: { "__proto__": "editor", bob: "owner" } });
  await writeFile(legacy, original);
  const access = await load(path);
  await expect(access.initAccess({ allowLegacyMigration: true })).rejects.toThrow("Invalid legacy membership");
  expect(await readFile(legacy, "utf8")).toBe(original);
});

it("refuses a database schema newer than this release", async () => {
  const path = await directory();
  const connection = new DatabaseSync(join(path, "access.sqlite"));
  connection.exec("PRAGMA user_version=99");
  connection.close();
  const access = await load(path);
  await expect(access.initAccess()).rejects.toThrow("Unsupported membership schema version 99");
});

it("creates a separate backup before migrating and verifies the database", async () => {
  const path = await directory();
  const backupPath = join(tmpdir(), `overposter-access-backup-${randomUUID()}`);
  directories.push(backupPath);
  const id = randomUUID();
  await mkdir(join(path, "access"));
  await writeFile(join(path, "access", `${id}.json`), JSON.stringify({ owner: "alice", members: { bob: "editor" } }));
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/access-migrate.ts", "--data", path, "--backup", backupPath], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain("Membership migration verified: schema 1, 1 projects, 1 members");
  expect(JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8")) as { hadLegacy: boolean; hadDatabase: boolean }).toMatchObject({ hadLegacy: true, hadDatabase: false });
  expect(await readFile(join(backupPath, "access", `${id}.json`), "utf8")).toContain("alice");
  const check = new DatabaseSync(join(path, "access.sqlite"), { readOnly: true });
  try { expect((check.prepare("SELECT role FROM project_members WHERE project_id=? AND subject='bob'").get(id) as { role: string }).role).toBe("editor"); }
  finally { check.close(); }
  const updated = new DatabaseSync(join(path, "access.sqlite"));
  updated.prepare("UPDATE project_members SET role='viewer' WHERE project_id=? AND subject='bob'").run(id);
  updated.close();
  const secondBackup = join(tmpdir(), `overposter-access-backup-${randomUUID()}`);
  directories.push(secondBackup);
  const second = spawnSync(process.execPath, ["--import", "tsx", "scripts/access-migrate.ts", "--data", path, "--backup", secondBackup], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  expect(second.status, second.stderr).toBe(0);
  expect(JSON.parse(await readFile(join(secondBackup, "manifest.json"), "utf8")) as { hadDatabase: boolean }).toMatchObject({ hadDatabase: true });
  const backedUp = new DatabaseSync(join(secondBackup, "access.sqlite"), { readOnly: true });
  try { expect((backedUp.prepare("SELECT role FROM project_members WHERE project_id=? AND subject='bob'").get(id) as { role: string }).role).toBe("viewer"); }
  finally { backedUp.close(); }
});

it("stops when legacy grants conflict with an existing database row", async () => {
  const path = await directory();
  const id = randomUUID();
  const access = await load(path);
  await access.initAccess();
  await access.createAccess(id, "alice");
  access.closeAccess();
  await mkdir(join(path, "access"));
  const legacy = join(path, "access", `${id}.json`);
  await writeFile(legacy, JSON.stringify({ owner: "bob", members: {} }));
  const reopened = await load(path);
  await expect(reopened.initAccess({ allowLegacyMigration: true })).rejects.toThrow("conflicts with database");
  const check = new DatabaseSync(join(path, "access.sqlite"), { readOnly: true });
  try { expect((check.prepare("SELECT owner_subject FROM project_access WHERE project_id=?").get(id) as { owner_subject: string }).owner_subject).toBe("alice"); }
  finally { check.close(); }
  expect(await readFile(legacy, "utf8")).toContain("bob");
});
