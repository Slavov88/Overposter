import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import * as Y from "yjs";

let server: ChildProcess;
let data: string;
let base: string;
let projectId: string;
const subject = (name: string) => ({ "X-Overposter-Test-Subject": name });
async function port(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port;
}
async function start(): Promise<void> {
  const number = await port();
  base = `http://127.0.0.1:${number}`;
  server = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(number), OVERPOSTER_DATA: data, OVERPOSTER_MODE: "test-hosted", OVERPOSTER_TEST_IDENTITIES: "1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  for (const stream of [server.stdout, server.stderr]) stream?.on("data", (chunk) => { output = (output + String(chunk)).slice(-3000); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Test server did not start: ${output}`);
}
async function stop(): Promise<void> {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await new Promise<void>((done) => server.once("exit", () => done()));
}
async function api(path: string, name: string, init: RequestInit = {}): Promise<Response> {
  return fetch(base + path, { ...init, headers: { ...subject(name), ...(init.headers || {}) } });
}
type Peer = { socket: WebSocket; doc: Y.Doc };
async function connect(name: string, path = "sections/results.tex"): Promise<Peer> {
  const socket = new WebSocket(base.replace("http", "ws") + `/api/projects/${projectId}/collab?path=${encodeURIComponent(path)}`, { headers: subject(name) });
  const doc = new Y.Doc();
  await new Promise<void>((done, fail) => {
    socket.once("error", fail);
    socket.on("message", (raw, binary) => {
      if (!binary) return;
      Y.applyUpdate(doc, new Uint8Array(raw as Buffer), "remote");
      done();
    });
  });
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote" && socket.readyState === WebSocket.OPEN) socket.send(update);
  });
  return { socket, doc };
}
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("Timed out waiting for shared state");
}

beforeAll(async () => { data = await mkdtemp(join(tmpdir(), "overposter-collab-")); await start(); }, 20_000);
afterAll(async () => { await stop(); await rm(data, { recursive: true, force: true }); });

describe("loopback collaborative test mode", () => {
  it("enforces membership, merges edits, persists state, and closes revoked connections", async () => {
    const created = await api("/api/projects", "alice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Shared poster" }) });
    expect(created.status).toBe(200);
    projectId = ((await created.json()) as { id: string }).id;
    expect((await api(`/api/projects/${projectId}`, "outsider")).status).toBe(403);
    expect((await fetch(base + `/api/projects/${projectId}`)).status).toBe(401);
    const login = await fetch(base + "/api/test-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "alice" }) });
    expect(login.ok).toBe(true);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toContain("overposter_test_subject=alice");
    expect((await fetch(base + "/api/session", { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await fetch(base + `/api/projects/${projectId}/role`, { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await fetch(base + "/api/test-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "../bob" }) })).status).toBe(400);
    expect((await (await api("/api/projects", "outsider")).json()) as unknown[]).toHaveLength(0);
    expect((await api(`/api/projects/${projectId}/file?path=poster.tex`, "outsider")).status).toBe(403);
    expect((await api(`/api/projects/${projectId}/export`, "outsider")).status).toBe(403);
    expect((await api(`/api/projects/${projectId}/versions`, "outsider")).status).toBe(403);
    expect((await api(`/api/projects/${projectId}/pdf`, "outsider")).status).toBe(403);
    const deniedSocket = new WebSocket(base.replace("http", "ws") + `/api/projects/${projectId}/collab?path=sections/results.tex`, { headers: subject("outsider") });
    await new Promise<void>((done) => { deniedSocket.once("close", () => done()); deniedSocket.once("error", () => done()); });
    const put = (name: string, role: string) => api(`/api/projects/${projectId}/members/${name}`, "alice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    expect((await put("bob", "editor")).ok).toBe(true);
    expect((await put("carol", "viewer")).ok).toBe(true);
    const linkPath = `/api/projects/${projectId}/overroot-link`;
    const linked = await api(linkPath, "alice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "research-42", url: "https://overroot.toni.foo/projects/research-42", expectedVersion: null }) });
    expect(linked.ok).toBe(true);
    const firstLink = await linked.json() as { version: string; link: { projectId: string; linkedBy: string } };
    expect(firstLink.link).toMatchObject({ projectId: "research-42", linkedBy: "alice" });
    expect((await (await api(linkPath, "carol")).json() as { version: string }).version).toBe(firstLink.version);
    expect((await api(linkPath, "bob", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "other", url: "https://overroot.toni.foo/projects/other", expectedVersion: firstLink.version }) })).status).toBe(403);
    expect((await api(linkPath, "alice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "other", url: "https://evil.example/projects/other", expectedVersion: firstLink.version }) })).status).toBe(400);
    expect((await api(linkPath, "alice", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: null }) })).status).toBe(409);
    expect((await api(`/api/projects/${projectId}/build`, "carol", { method: "POST" })).status).toBe(403);
    expect((await api(`/api/projects/${projectId}/versions`, "carol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "No" }) })).status).toBe(403);
    const blockedBuild = await (await api(`/api/projects/${projectId}/build`, "bob", { method: "POST" })).json() as { ok: boolean; log: string };
    expect(blockedBuild.ok).toBe(false);
    expect(blockedBuild.log).toContain("Hosted compilation is disabled");
    const alice = await connect("alice");
    const bob = await connect("bob");
    const carol = await connect("carol");
    const original = alice.doc.getText("source").toString();
    const originalEtag = (await api(`/api/projects/${projectId}/file?path=sections/results.tex`, "alice")).headers.get("ETag");
    const before = await api(`/api/projects/${projectId}/versions`, "alice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Before shared edits" }) });
    const beforeId = ((await before.json()) as { id: string }).id;
    alice.doc.getText("source").insert(0, "Alice says hello.\n");
    bob.doc.getText("source").insert(0, "Bob says hello.\n");
    await until(() => [alice, bob, carol].every((peer) => peer.doc.getText("source").toString().includes("Alice says hello.") && peer.doc.getText("source").toString().includes("Bob says hello.")));
    const merged = alice.doc.getText("source").toString();
    expect(bob.doc.getText("source").toString()).toBe(merged);
    expect(carol.doc.getText("source").toString()).toBe(merged);
    await until(async () => (await (await api(`/api/projects/${projectId}/file?path=sections/results.tex`, "alice")).text()) === merged);
    const sourcePath = `/api/projects/${projectId}/file?path=sections/results.tex`;
    const figure = new FormData();
    figure.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "plot.png");
    expect((await api(`/api/projects/${projectId}/upload?path=poster.tex`, "bob", { method: "POST", body: figure })).status).toBe(400);
    expect((await api(`/api/projects/${projectId}/upload?path=figures/plot.png`, "bob", { method: "POST", body: figure })).status).toBe(200);
    expect((await api(`/api/projects/${projectId}/upload?path=figures/plot.png`, "bob", { method: "POST", body: figure })).status).toBe(409);
    expect((await api(`/api/projects/${projectId}/upload?path=figures/../poster.tex`, "bob", { method: "POST", body: figure })).status).toBe(400);
    expect((await api(sourcePath, "bob", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "Overwrite" })).status).toBe(428);
    expect((await api(sourcePath, "bob", { method: "PUT", headers: { "Content-Type": "text/plain", "If-Match": originalEtag! }, body: "Overwrite" })).status).toBe(409);
    const after = await api(`/api/projects/${projectId}/versions`, "alice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "After shared edits" }) });
    const afterId = ((await after.json()) as { id: string }).id;
    expect(afterId).not.toBe(beforeId);
    const historical = await api(`/api/projects/${projectId}/versions/${afterId}/file?path=sections/results.tex`, "carol");
    expect((await historical.json() as { content: string }).content).toBe(merged);
    const viewerClosed = new Promise<void>((done) => carol.socket.once("close", () => done()));
    carol.doc.getText("source").insert(0, "Viewer injection.\n");
    await viewerClosed;
    expect((await (await api(`/api/projects/${projectId}/file?path=sections/results.tex`, "alice")).text())).toBe(merged);
    const bobClosed = new Promise<void>((done) => bob.socket.once("close", () => done()));
    expect((await api(`/api/projects/${projectId}/members/bob`, "alice", { method: "DELETE" })).ok).toBe(true);
    await bobClosed;
    expect((await api(`/api/projects/${projectId}`, "bob")).status).toBe(403);
    alice.socket.close();
    await stop();
    await start();
    const reopened = await connect("alice");
    expect(reopened.doc.getText("source").toString()).toBe(merged);
    expect((await (await api(`/api/projects/${projectId}/overroot-link`, "alice")).json() as { version: string }).version).toBe(firstLink.version);
    expect((await api(`/api/projects/${projectId}/overroot-link`, "alice", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: firstLink.version }) })).ok).toBe(true);
    reopened.socket.close();
    const history = await (await api(`/api/projects/${projectId}/versions`, "alice")).json() as { head: string };
    const restored = await api(`/api/projects/${projectId}/versions/${beforeId}/restore`, "alice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedHead: history.head }) });
    expect(restored.ok).toBe(true);
    expect((await (await api(`/api/projects/${projectId}/file?path=sections/results.tex`, "alice")).text())).toBe(original);
  }, 40_000);

  it("refuses public hosted startup, unguarded tests, and unknown identity modes", async () => {
    for (const mode of ["hosted", "test-hosted", "unknown"]) {
      const child = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, OVERPOSTER_MODE: mode, OVERPOSTER_TEST_IDENTITIES: "", NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const code = await new Promise<number | null>((done, fail) => {
        const timer = setTimeout(() => { child.kill(); fail(new Error("Hosted startup did not fail closed")); }, 5000);
        child.once("exit", (value) => { clearTimeout(timer); done(value); });
        child.once("error", fail);
      });
      expect(code).not.toBe(0);
    }
  }, 15_000);
});
