import { backup, DatabaseSync } from "node:sqlite";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
const suppliedData = option("--data");
if (!suppliedData || !suppliedData.trim()) throw new Error("Usage: pnpm access:migrate -- --data <absolute data directory> [--backup <new backup directory>]");
const data = resolve(suppliedData);
if (!(await stat(data)).isDirectory()) throw new Error("Data path must be a directory");
const destination = resolve(option("--backup") || join(dirname(data), `${basename(data)}-access-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`));
if (destination === data || destination.startsWith(data + sep) || data.startsWith(destination + sep))
  throw new Error("Backup directory must be separate from the data directory");
await mkdir(destination);
const legacy = join(data, "access");
const oldDatabase = join(data, "access.sqlite");
const hadLegacy = await exists(legacy);
const hadDatabase = await exists(oldDatabase);
if (hadLegacy) await cp(legacy, join(destination, "access"), { recursive: true, dereference: false });
if (hadDatabase) {
  const source = new DatabaseSync(oldDatabase, { readOnly: true });
  try { await backup(source, join(destination, "access.sqlite")); }
  finally { source.close(); }
}
await writeFile(join(destination, "manifest.json"), JSON.stringify({ source: data, createdAt: new Date().toISOString(), hadLegacy, hadDatabase }, null, 2) + "\n");
process.env.OVERPOSTER_DATA = data;
process.env.OVERPOSTER_MODE = "test-hosted";
const access = await import("../apps/server/src/access.js");
try { await access.initAccess({ allowLegacyMigration: true }); }
finally { access.closeAccess(); }
const check = new DatabaseSync(oldDatabase, { readOnly: true });
try {
  const integrity = (check.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
  if (integrity !== "ok") throw new Error(`Membership database integrity check failed: ${integrity}`);
  const version = (check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const projects = (check.prepare("SELECT COUNT(*) AS count FROM project_access").get() as { count: number }).count;
  const members = (check.prepare("SELECT COUNT(*) AS count FROM project_members").get() as { count: number }).count;
  console.log(`Membership migration verified: schema ${version}, ${projects} projects, ${members} members. Backup: ${destination}`);
} finally { check.close(); }
