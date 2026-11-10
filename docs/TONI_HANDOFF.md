# Overposter hosting handoff

Overposter is a separate MIT-licensed poster application. Its current release is a loopback-only, single-user service. The hosted mode is deliberately disabled at startup. This document separates working local features from the contracts and infrastructure needed before a public service can be enabled.

## Status on 10 November 2026

| Capability | Status | Evidence or remaining work |
| --- | --- | --- |
| Local project editor, structured authors and affiliations, template settings, PDF preview, import/export | Implemented locally | React and Fastify code; local tests and browser flow cover the main path. |
| Local XeLaTeX build, print preflight, QR, three templates | Implemented locally | `pnpm test` and `pnpm examples:build` run actual TeX. Generated PDFs and reports remain local build artifacts. |
| ETag conflict detection, recoverable browser draft, Git checkpoints and restore | Implemented locally | REST file writes reject stale ETags; project history is stored outside source. Multiuser transaction semantics remain to be built. |
| Site account login and service approval | Requires Toni | No credentials or confirmed provider contract have been supplied. No production login is claimed. |
| Identity provider boundary | Local and test implementations | A provider interface resolves the local or guarded test subject. No site account adapter, real service grant, or public session exists. |
| Project membership and role enforcement | Implemented in test mode | Owner/editor/viewer checks cover project REST routes and WebSockets. Test-mode membership uses versioned SQLite with a backup and non-destructive JSON migration. An owner can assign exact simulated subjects; real account lookup and invitations are absent. |
| Shared editing and durable CRDT state | Implemented in test mode, partial product | Two browser editors converge through Yjs, show presence/cursors, and wait for persistence acknowledgment before navigation. Restart recovery is tested. Production session and cross-process semantics remain open. |
| Isolated hosted TeX worker | Standalone Linux prototype; production not integrated | SHA-256 pinned ZIP, bounded extraction and a bubblewrap/prlimit XeLaTeX path are configured for Linux CI verification. The web app still fails closed. Authentication, job transport, host quotas and deployment validation remain. |
| Overroot project links and scoped sync | Manual link implemented locally; sync unavailable | Owners can save a stable Overroot project ID and validated read-only URL; viewers can open it with separate Overroot access. Source ZIP is the manual handoff. No permission transfer or sync exists. |

## Proposed topology

Use a distinct Overposter origin, for example `overposter.toni.foo` **only after registration**, backed by an Overposter web/API service, a separate persistent data volume, and an isolated TeX worker on another unprivileged VM or restrictive Linux sandbox. Keep the account authority at `accounts.toni.foo` and register a new `overposter` service identity. Do not reuse Overroot's service grant, client secret, sessions, project database, or membership. Terminate TLS at the ingress and expose only the authenticated web/API origin. The worker must not receive account secrets or database access.

The current Fastify process binds to `127.0.0.1`. Do not change its bind address or set `OVERPOSTER_MODE=hosted` in production until the missing identity, authorization, shared editing, and worker pieces are implemented and tested. The hosted guard in `apps/server/src/index.ts` is a deliberate release gate.

## Account provider contract to obtain

Please register the exact service ID `overposter` with an agreed public origin and callback URL. Supply credentials through the secret store, never through this repository. Confirm the provider's issuer URL and discovery/JWKS mechanism, immutable subject identifier, service-grant claim or introspection method, approved-handle lookup/invitation method, token expiry/revocation semantics, callback and logout endpoints, state/PKCE requirements, and allowed cookie domain/SameSite policy. Overposter must validate issuer, audience/service ID, expiry, callback origin and CSRF state; use server-side sessions; and key user records by immutable subject. A user approved for Overroot must not gain Overposter access automatically.

Environment contract; production account and worker variables are **not yet implemented**:

| Variable | Status and meaning |
| --- | --- |
| `PORT` | Implemented: local API port, default `4318`. |
| `OVERPOSTER_WEB_PORT` | Implemented: allowed local Vite origin port, default `5173`. |
| `OVERPOSTER_DATA` | Implemented: project, build and version storage root. Back up the entire directory together. |
| `OVERPOSTER_MODE` | `local` or unset works; `hosted` currently refuses startup. |
| `OVERPOSTER_OVERROOT_ORIGIN` | Implemented, optional: HTTPS origin for validating manual Overroot deep links; defaults to `https://overroot.toni.foo`. No API calls or credentials are used. |
| `OVERPOSTER_TEST_IDENTITIES` | Test harness only: `1` plus `NODE_ENV=test` and `OVERPOSTER_MODE=test-hosted`; never deploy. |
| `OVERPOSTER_PUBLIC_ORIGIN` | Proposed: canonical HTTPS origin for redirects and CSRF checks. |
| `OVERPOSTER_ACCOUNTS_ISSUER` | Proposed: provider issuer from Toni's contract. |
| `OVERPOSTER_ACCOUNTS_CLIENT_ID` | Proposed: distinct `overposter` client ID. |
| `OVERPOSTER_ACCOUNTS_CLIENT_SECRET` | Proposed: secret-store reference only, if a confidential client is required. |
| `OVERPOSTER_SESSION_SECRET` | Proposed: independent rotating session key from the secret store. |
| `OVERPOSTER_WORKER_ENDPOINT` | Proposed: authenticated private worker endpoint; never a public TeX command. |

Do not set the proposed variables expecting them to enable hosted operation in this revision. `.env.example` contains only working local settings.

## Implementation and deployment sequence

1. Agree on the account contract and register the `overposter` service and callback. Implement a provider adapter and server-side sessions, then test with two approved and one unapproved test accounts. Reject startup when any required value is absent.
2. Replace the guarded test identity with real site account sessions. Rehearse the [membership migration](ACCESS_MIGRATION.md) on a copy, map only confirmed immutable subjects, and test backup and rollback before production. Re-run owner/editor/viewer route and WebSocket tests using real provider subjects and revocation.
3. Replace the test browser subject cookie and header with real authenticated sessions. Define cross-process serialization and source revision pinning before moving beyond a single process. Repeat two-editor, reconnect, revocation, conflict, presence and attribution tests against the production identity adapter.
4. Provision a separate unprivileged VM with `bubblewrap`, `util-linux`, TeX Live, Python and the preflight dependencies. Run `pnpm worker:verify` there; the Linux CI job runs the same real poster build, isolation probes and cancellation check. The standalone `pnpm worker:run <source.zip> <sha256> <private-artifact-dir>` verifies an immutable ZIP revision before bounded extraction, runs XeLaTeX in bubblewrap without network or host account mounts, and returns a private PDF and report. Do not run it as the API user or on a machine with account secrets or project data. Add authenticated transport, bounded queue/concurrency, per-job filesystem and process limits, resource exhaustion tests, hostile PDF parsing tests, audit events, and controlled artifact delivery before connecting the API. Preflight currently runs outside bubblewrap on the worker host, so isolate the entire VM. Keep the hosted startup gate closed until these controls and account integration pass on the actual deployment host.
5. Add audit events for login, membership, file changes, compile, checkpoint, restore and export. Restrict and rotate logs, retain database and project/version backups, and test restore. Verify health, readiness, quotas and failure behavior before enabling ingress.
6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm examples:build`, and `pnpm worker:verify` in CI. Check actual generated PDF pages and preflight JSON. Deploy behind a staged origin; verify login, logout/revocation, owner/editor/viewer access, presence, history, compile and rollback with test accounts. Enable the public origin only after those checks.

## Cross-app link proposal

The working exchange is source ZIP export/import with explicit local trust review. Overposter now stores a user-supplied Overroot project ID and read-only HTTPS deep link alongside the Overposter project. The UI shows who recorded the link and when, and states that the reference is unverified. It never fetches Overroot data or transfers permissions. The project ID in each service remains independent. For an authenticated link or sync, obtain an explicit grant approved in **both** services. If Overroot exposes a scoped project API, negotiate a separate integration credential and revision-token contract; report conflicts and require an explicit user action to overwrite. Overroot changes, if any, should be proposals to Toni: register a distinct service and optional link endpoint or UI affordance. Do not change the Overroot repository or silently share memberships.

## Paste-ready request

> Overposter is working locally with real XeLaTeX builds, print preflight, structured poster metadata and Git source history. A guarded loopback test harness now exercises project roles in SQLite and persistent two-user browser Yjs editing, including presence and a sharing panel for exact simulated subjects. Public hosting remains gated: it has no site account adapter or production worker integration. A standalone sandbox worker prototype has a Linux CI verification step; host quotas, authenticated transport and production isolation remain to be validated. Please register an independent `overposter` service with the site account authority, provide the issuer/claim/callback/logout and approved-handle lookup contract, and provision a separate secret store, persistent volume and isolated TeX worker environment. We will migrate identity and membership, define cross-process source transactions, and test worker isolation and rollback before enabling a public origin. No Overroot credential or membership will be reused.
