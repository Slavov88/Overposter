import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { root } from "../apps/server/src/projects.js";
import { runIsolatedWorker, runWorkerSandbox } from "./isolated-worker.js";

// Linux CI exercise: build an actual scientific poster through the isolated path.
const temp = await mkdtemp(join(tmpdir(), "overposter-worker-check-"));
try {
  const source = join(root, "examples", "sample-ml-poster");
  const writer = new BlobWriter();
  const zip = new ZipWriter(writer);
  async function addTree(dir: string, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Example source contains a symlink");
      const name = prefix + entry.name;
      if (entry.isDirectory()) await addTree(join(dir, entry.name), name + "/");
      else await zip.add(name, new Uint8ArrayReader(await readFile(join(dir, entry.name))));
    }
  }
  await addTree(source);
  await zip.add("poster-layout.tex", new Uint8ArrayReader(await readFile(join(root, "templates", "shared", "poster-layout.tex"))));
  await zip.close();
  const bytes = new Uint8Array(await (await writer.getData()).arrayBuffer());
  const bundle = join(temp, "source.zip");
  const revision = createHash("sha256").update(bytes).digest("hex");
  await writeFile(bundle, bytes);
  const artifacts = join(temp, "artifacts");
  const probeSource = join(temp, "probe-source");
  const probeOutput = join(temp, "probe-output");
  await mkdir(probeSource);
  await mkdir(probeOutput);
  for (const [name, command] of [
    ["host passwd", "test ! -e /etc/passwd"],
    ["host home", "test ! -e /home"],
    ["network route", "test $(wc -l </proc/net/route) -eq 1"],
  ]) {
    const code = await runWorkerSandbox("sh", ["-c", command], probeSource, probeOutput, undefined,
      (text) => process.stderr.write(text));
    if (code !== 0) throw new Error(`Sandbox ${name} probe failed (exit ${code})`);
  }
  const controller = new AbortController();
  const cancelled = runWorkerSandbox("sleep", ["30"], probeSource, probeOutput, controller.signal);
  setTimeout(() => controller.abort(), 100);
  await cancelled.then(() => { throw new Error("Cancellation did not stop job"); }, (error: unknown) => {
    if (!String(error).includes("cancelled")) throw error;
  });
  const result = await runIsolatedWorker(bundle, revision, artifacts);
  if (!result.ok) throw new Error(result.error || "Worker build failed");
  const report = JSON.parse(await readFile(join(artifacts, `${revision}.preflight.json`), "utf8"));
  if (!report.valid || report.pageCount !== 1) throw new Error("Worker preflight failed");
  const pdf = await readFile(join(artifacts, `${revision}.pdf`));
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Missing PDF artifact");
  let rejected = false;
  try { await runIsolatedWorker(bundle, "0".repeat(64), artifacts); }
  catch (error) { rejected = String(error).includes("revision mismatch"); }
  if (!rejected) throw new Error("Modified source revision was accepted");
  console.log(`Isolated worker built one-page PDF for ${revision}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

