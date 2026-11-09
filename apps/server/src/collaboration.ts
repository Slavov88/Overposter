import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type WebSocket from "ws";
import * as Y from "yjs";
import { requireRole, roleFor, testHosted, testSubject } from "./access.js";
import { dataDir, readProjectFile, writeProjectFile } from "./projects.js";
import { safePath } from "./model.js";

type Client = { socket: WebSocket; subject: string };
type Document = { id: string; path: string; doc: Y.Doc; clients: Set<Client>; pending: Promise<void> };
const documents = new Map<string, Promise<Document>>();
const key = (id: string, path: string) => `${id}:${path}`;

function statePath(id: string, path: string): string {
  const digest = createHash("sha256").update(path).digest("hex");
  return join(dataDir, "collaboration", id, digest + ".bin");
}

function textPath(input: string): string {
  const path = safePath(input);
  if (!/\.(tex|bib|txt|md)$/i.test(path) || path === "config.tex")
    throw new Error("Only editable text files support shared editing");
  return path;
}

async function loadDocument(id: string, path: string): Promise<Document> {
  const doc = new Y.Doc();
  const source = (await readProjectFile(id, path)).toString("utf8");
  try { Y.applyUpdate(doc, await readFile(statePath(id, path))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    doc.getText("source").insert(0, source);
  }
  const state: Document = { id, path, doc, clients: new Set(), pending: Promise.resolve() };
  if (doc.getText("source").toString() !== source) await writeProjectFile(id, path, doc.getText("source").toString());
  return state;
}

async function documentFor(id: string, path: string): Promise<Document> {
  const k = key(id, path);
  let current = documents.get(k);
  if (!current) {
    current = loadDocument(id, path);
    documents.set(k, current);
    current.catch(() => { if (documents.get(k) === current) documents.delete(k); });
  }
  return current;
}

function queuePersist(state: Document): Promise<void> {
  state.pending = state.pending.catch(() => {}).then(async () => {
    const destination = statePath(state.id, state.path);
    await mkdir(join(dataDir, "collaboration", state.id), { recursive: true });
    const temp = destination + ".tmp";
    await writeFile(temp, Buffer.from(Y.encodeStateAsUpdate(state.doc)));
    await rename(temp, destination);
    await writeProjectFile(state.id, state.path, state.doc.getText("source").toString());
  });
  return state.pending;
}

function broadcast(state: Document, data: Uint8Array | string, except?: WebSocket): void {
  for (const client of state.clients)
    if (client.socket !== except && client.socket.readyState === client.socket.OPEN)
      client.socket.send(data);
}

export async function flushProject(id: string): Promise<void> {
  const active = [...documents.values()].map(async (promise) => {
    const state = await promise;
    if (state.id === id) await state.pending;
  });
  await Promise.all(active);
}

export async function replaceFromRest(id: string, input: string, content: string): Promise<void> {
  if (!testHosted) return;
  const path = textPath(input);
  const state = await documentFor(id, path);
  const text = state.doc.getText("source");
  if (text.toString() === content) return;
  state.doc.transact(() => { text.delete(0, text.length); text.insert(0, content); });
  const update = Y.encodeStateAsUpdate(state.doc);
  await queuePersist(state);
  broadcast(state, update);
}

export async function reloadAfterRestore(id: string): Promise<void> {
  if (!testHosted) return;
  for (const promise of documents.values()) {
    const state = await promise;
    if (state.id !== id) continue;
    await replaceFromRest(id, state.path, (await readProjectFile(id, state.path)).toString("utf8"));
  }
}

export function closeRevoked(id: string, subject: string): void {
  for (const promise of documents.values())
    promise.then((state) => {
      if (state.id === id)
        for (const client of state.clients)
          if (client.subject === subject) client.socket.close(1008, "Access changed");
    }).catch(() => {});
}

export async function closeProject(id: string): Promise<void> {
  for (const [name, promise] of documents) {
    const state = await promise;
    if (state.id !== id) continue;
    for (const client of state.clients) client.socket.close(1008, "Project deleted");
    await state.pending;
    documents.delete(name);
  }
}

export async function registerCollaboration(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/api/projects/:id/collab",
    { websocket: true },
    (socket, request: FastifyRequest<{ Params: { id: string }; Querystring: { path: string } }>) => {
      if (!testHosted) { socket.close(1008, "Shared editing is unavailable in local mode"); return; }
      const ready = (async () => {
        const subject = testSubject(request);
        await requireRole(request.params.id, subject, "viewer");
        const path = textPath(request.query.path);
        const state = await documentFor(request.params.id, path);
        const client: Client = { socket, subject };
        state.clients.add(client);
        socket.send(Y.encodeStateAsUpdate(state.doc));
        broadcast(state, JSON.stringify({ type: "presence", subject, connected: true }), socket);
        return { state, client };
      })();
      ready.catch(() => socket.close(1008, "Project access denied"));
      socket.on("message", async (data, isBinary) => {
        try {
          const { state, client } = await ready;
          const role = await roleFor(state.id, client.subject);
          if (!role) { socket.close(1008, "Project access denied"); return; }
          if (!isBinary) {
            const message = JSON.parse(data.toString()) as { type?: string; cursor?: number };
            if (message.type === "presence" && Number.isInteger(message.cursor) && message.cursor! >= 0 && message.cursor! <= state.doc.getText("source").length)
              broadcast(state, JSON.stringify({ type: "presence", subject: client.subject, cursor: message.cursor }), socket);
            return;
          }
          if (role === "viewer") { socket.close(1008, "Read-only project"); return; }
          const bytes = new Uint8Array(data as Buffer);
          if (bytes.length > 1_000_000) { socket.close(1009, "Update too large"); return; }
          Y.applyUpdate(state.doc, bytes);
          await queuePersist(state);
          broadcast(state, bytes, socket);
        } catch { socket.close(1008, "Invalid shared update"); }
      });
      socket.on("close", () => {
        ready.then(({ state, client }) => {
          state.clients.delete(client);
          broadcast(state, JSON.stringify({ type: "presence", subject: client.subject, connected: false }));
        }).catch(() => {});
      });
    },
  );
}
