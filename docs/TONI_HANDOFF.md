# Overposter hosting handoff

Overposter is a separate MIT-licensed poster application. Its current release is a loopback-only, single-user service. The hosted mode is deliberately disabled at startup. This document separates working local features from the contracts and infrastructure needed before a public service can be enabled.

## Status on 10 November 2026

| Capability | Status | Evidence or remaining work |
| --- | --- | --- |
| Local project editor, structured authors and affiliations, template settings, PDF preview, import/export | Implemented locally | React and Fastify code; local tests and browser flow cover the main path. |
| Local XeLaTeX build, print preflight, QR, three templates | Implemented locally | `pnpm test` and `pnpm examples:build` run actual TeX. Generated PDFs and reports remain local build artifacts. |
| ETag conflict detection, recoverable browser draft, Git checkpoints and restore | Implemented locally | REST file writes reject stale ETags; project history is stored outside source. Multiuser transaction semantics remain to be built. |
| Site account login and service approval | Requires Toni | No credentials or confirmed provider contract have been supplied. No production login is claimed. |
| Test identity provider | Implemented in test mode | A guarded loopback header simulates exact subjects. It is not public authentication. |
| Project membership and role enforcement | Implemented in test mode | Owner/editor/viewer checks cover project REST routes and WebSockets. An owner can assign exact simulated subjects in a browser sharing panel; real account lookup and invitations are absent. |
| Shared editing and durable CRDT state | Implemented in test mode, partial product | Two browser editors converge through Yjs, show presence/cursors, and wait for persistence acknowledgment before navigation. Restart recovery is tested. Production session and cross-process semantics remain open. |
| Isolated hosted TeX worker | Not implemented | Hosted startup and compilation fail closed. Native TeX in the web server is unsuitable for arbitrary hosted source. |
| Overroot project links and scoped sync | Not implemented | Source ZIP import/export is the manual handoff. No automatic cross-app permission or sync exists. |

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
2. Replace the guarded test identity with real site account sessions and a durable user/member database with migrations. Back up `.overposter` before migration; test upgrade and rollback on a copy. Re-run owner/editor/viewer route and WebSocket tests using real provider subjects and revocation.
3. Replace the test browser subject cookie and header with real authenticated sessions. Define cross-process serialization and source revision pinning before moving beyond a single process. Repeat two-editor, reconnect, revocation, conflict, presence and attribution tests against the production identity adapter.
4. Provision the TeX worker on a separate unprivileged VM or verified OS sandbox. Give each job a fresh source directory and output directory, no network, no writable shared mounts, no secrets, bounded process tree, CPU, memory, disk, file count and wall time, limited concurrency, cancellation, and log redaction. Accept only authenticated jobs pinned to an immutable source revision. Return artifacts by controlled transfer. Do not provide a native web-server fallback.
5. Add audit events for login, membership, file changes, compile, checkpoint, restore and export. Restrict and rotate logs, retain database and project/version backups, and test restore. Verify health, readiness, quotas and failure behavior before enabling ingress.
6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm examples:build`, and the isolated-worker adversarial suite in CI. Check actual generated PDF pages and preflight JSON. Deploy behind a staged origin; verify login, logout/revocation, owner/editor/viewer access, presence, history, compile and rollback with test accounts. Enable the public origin only after those checks.

## Cross-app link proposal

The working exchange is source ZIP export/import with explicit local trust review. A future link should store stable Overroot and Overposter project IDs plus provenance and an explicit grant approved in **both** services. A read-only deep link is a safe first step. If Overroot exposes a scoped project API, negotiate a separate integration credential and revision-token contract; report conflicts and require an explicit user action to overwrite. Overroot changes, if any, should be proposals to Toni: register a distinct service and optional link endpoint or UI affordance. Do not change the Overroot repository or silently share memberships.

## Paste-ready request

> Overposter is working locally with real XeLaTeX builds, print preflight, structured poster metadata and Git source history. A guarded loopback test harness now exercises project roles and persistent two-user browser Yjs editing, including presence and a sharing panel for exact simulated subjects. Public hosting remains gated: it has no site account adapter or isolated compile worker. Please register an independent `overposter` service with the site account authority, provide the issuer/claim/callback/logout and approved-handle lookup contract, and provision a separate secret store, persistent volume and isolated TeX worker environment. We will migrate identity and membership, define cross-process source transactions, and test worker isolation and rollback before enabling a public origin. No Overroot credential or membership will be reused.
