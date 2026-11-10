import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { extractWorkerBundle } from "../scripts/isolated-worker.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function bundle(entries: [string, string][]) {
  const writer = new BlobWriter();
  const zip = new ZipWriter(writer);
  for (const [name, content] of entries) await zip.add(name, new TextReader(content));
  await zip.close();
  return new Uint8Array(await (await writer.getData()).arrayBuffer());
}
async function unpack(entries: [string, string][]) {
  const dir = await mkdtemp(join(tmpdir(), "worker-test-"));
  dirs.push(dir);
  return extractWorkerBundle(await bundle(entries), dir);
}
const valid: [string, string][] = [["poster.tex", "example"], ["poster.json", "{}"]];
test("accepts a bounded source bundle", async () => {
  await expect(unpack(valid)).resolves.toBeUndefined();
});
test("rejects traversal and Git internals", async () => {
  await expect(unpack([...valid, ["../escape.tex", "bad"]])).rejects.toThrow("Unsafe");
  await expect(unpack([...valid, [".git/config", "bad"]])).rejects.toThrow("Unsafe");
});
test("rejects case-folded duplicate names", async () => {
  await expect(unpack([...valid, ["POSTER.TEX", "bad"]])).rejects.toThrow("Duplicate");
});
test("requires root poster files", async () => {
  await expect(unpack([["nested/poster.tex", "example"], ["poster.json", "{}"]])).rejects.toThrow("needs poster.tex");
});
