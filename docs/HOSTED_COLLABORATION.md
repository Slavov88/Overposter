# Hosted collaboration design and current state

Hosted collaboration is not implemented. `OVERPOSTER_MODE=hosted` fails startup deliberately, and the local API has no public listener, account sessions, memberships, or WebSockets. The local editor's ETag protection does not make it a real-time collaborative editor.

The planned service needs an accounts adapter based on the actual site-owned contract, with a separate `overposter` service grant, validated issuer and immutable subject, server-side sessions, state/PKCE where required, and CSRF protection. Membership belongs to each Overposter project independently: owner manages access and deletion, editor changes source and versions, viewer reads. Every REST route, PDF/download route, and WebSocket join/update must check that membership. Revocation must disconnect affected sockets.

A persistent Yjs document per editable file can provide concurrent editing. The server must define one authoritative flush path from CRDT state to source, checkpoint and compile a pinned revision, reload after restart, and reject updates from viewers. Two simulated identities restricted to a loopback test harness should prove concurrent edits, reconnect, persistence, and revocation before any public service is enabled.

Hosted TeX needs a separate unprivileged VM or restricted Linux worker with no network, only per-job mounts, CPU/RAM/time quotas, cancellation, limited concurrency, secret-free environment, redacted logs, pinned source revision, and authenticated artifact delivery. The web server must have no fallback to direct local XeLaTeX. This isolation and its adversarial tests are not yet implemented.
