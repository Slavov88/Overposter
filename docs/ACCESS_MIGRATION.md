# Project membership migration

This migration applies to the guarded loopback `test-hosted` mode. Public hosted mode is still disabled. Node.js 24.12 or newer is required for the built-in SQLite API used here. The current runtime labels that API experimental; validate the exact Node release before a production deployment.

## From JSON to SQLite

1. Stop the Overposter test server. Record the absolute `OVERPOSTER_DATA` path. A new server refuses to import unmigrated legacy grants without this backed-up command.
2. Run `pnpm access:migrate -- --data <absolute-data-directory> --backup <new-separate-backup-directory>`. If `--backup` is omitted, the tool creates a timestamped sibling directory. It refuses a backup inside the data directory or an existing backup directory.
3. The tool copies the entire old `access/` directory and uses SQLite's online backup API for an existing `access.sqlite`. It writes a manifest stating whether each existed before migration. Then it opens the database, migrates any unprocessed JSON files in a transaction, runs `PRAGMA quick_check`, and reports the schema version and project/member counts.
4. Keep the backup and old `access/*.json` files. The SQLite database becomes authoritative after migration. A migration marker prevents retained JSON from reviving a project or role after removal. Later role changes are not copied back to JSON.
5. Restart the guarded test server and verify an owner, editor, viewer, and outsider using the role and WebSocket tests. Back up the whole data directory, including the SQLite database, project source, Yjs state, and Git versions, as one consistency set for further work.

An invalid legacy record, symlinked JSON file, or conflict with an existing database owner fails the migration rather than silently dropping access. The source JSON remains untouched. A newer unknown schema version also fails startup.

## Rollback

Stop the service first and retain a copy of the post-migration `access.sqlite` and its WAL files for investigation. Use the manifest to identify the pre-migration state. If a database existed, restore the backed-up `access.sqlite` while the service is stopped. If none existed, switch back to the prior application release, which reads the retained JSON records. Role edits made after migration require a separate reconciliation before rollback; restoring a backup does not preserve those later edits. Never copy a database file over a live SQLite connection.

For a future hosted deployment, this test-mode migration is a rehearsal only. Production requires Toni's confirmed immutable subject and service-grant contract, a new account adapter, a staged backup/restore test, and a reviewed mapping from existing test subjects to real accounts. Do not merge identities by display name or email.
