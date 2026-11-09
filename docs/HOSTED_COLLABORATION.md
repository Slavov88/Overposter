# Hosted collaboration boundary

Public hosted collaboration is not enabled. `OVERPOSTER_MODE=hosted` fails startup. The local API still binds to loopback, and it has no site account sessions or isolated compiler worker.

## Test-only foundation

A loopback test harness is available with `NODE_ENV=test`, `OVERPOSTER_MODE=test-hosted`, and `OVERPOSTER_TEST_IDENTITIES=1`. The `X-Overposter-Test-Subject` header supplies an exact simulated identity. This header is **not authentication** and must never be trusted on a public interface. The startup guard rejects this mode without both test flags.

Membership is stored outside editable project source in `.overposter/access/<id>.json`. Owners manage members and deletion; editors can write source and checkpoints; viewers can read. Every project REST route checks membership. A viewer's WebSocket updates are rejected, and revocation closes affected sockets. A `PUT` to existing shared source requires its current ETag.

The `/api/projects/:id/collab?path=...` WebSocket accepts Yjs binary updates for editable text files. The server persists Yjs state under `.overposter/collaboration/` and flushes text to source. It sends the full document state on connect; later binary frames are Yjs updates. JSON `presence` frames carry the server-validated subject and optional character cursor. Checkpoints, restores, source reads and exports wait for queued document writes. The test suite verifies two editors converging, a viewer write rejection, revocation, restart recovery, source history and role enforcement.

This is a server-side foundation. The browser editor is not yet bound to Yjs and does not display remote cursors. It has no invitation or sharing UI. The test header is not an account provider adapter. Production still needs the documented site account contract, server-side sessions, durable user/membership migrations, cross-process transaction and reconnection design, and a separate isolated TeX worker. The test harness is not a deployable multiuser service.

## Production acceptance gates

The planned account adapter needs a separate `overposter` grant, validated issuer and immutable subject, server-side sessions, state/PKCE where required, and CSRF protection. Membership remains project specific; every REST route, PDF/download route and WebSocket join/update must check it. Revocation must disconnect affected sockets.

Hosted TeX needs a separate unprivileged VM or restricted Linux worker with no network, per-job mounts, CPU/RAM/time quotas, cancellation, limited concurrency, a secret-free environment, redacted logs, pinned source revision and authenticated artifact delivery. The web server must have no fallback to direct local XeLaTeX. This isolation and its adversarial tests are not yet implemented.
