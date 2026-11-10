import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BlobReader, ZipReader } from "@zip.js/zip.js";
import { configTex, parsePosterConfig, safePath } from "../apps/server/src/model.js";
import { preflight } from "../apps/server/src/preflight.js";

// This is an independent Linux worker entry point. The web API never invokes it.
// Run it only on a dedicated, unprivileged host with a private job directory.
const MAX_ZIP = 30_000_000;
const MAX_FILE = 8_000_000;
const MAX_SOURCE = 40_000_000;
const MAX_OUTPUT = 100_000_000;
const LIMIT_MS = 120_000;

export type WorkerResult = { ok: boolean; revision: string; error?: string; report?: unknown };

export async function extractWorkerBundle(bytes: Uint8Array, source: string) {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(bytes)])));
  let count = 0;
  let total = 0;
  const names = new Set<string>();
  const originalNames = new Set<string>();
  try {
    const entries = await reader.getEntries();
    if (entries.length > 150) throw new Error("Too many ZIP entries");
    for (const entry of entries) {
      // Reject all nonregular Unix entries, including links and devices.
      const mode = entry.unixMode ? entry.unixMode & 0o170000 : 0;
      if (mode && mode !== (entry.directory ? 0o040000 : 0o100000))
        throw new Error("Unsupported ZIP entry type");
      if (entry.directory) continue;
      const name = safePath(entry.filename);
      if (/[\x00-\x1f\x7f]/.test(name)) throw new Error("Unsafe ZIP filename");
      const key = name.normalize("NFC").toLowerCase();
      if (names.has(key)) throw new Error("Duplicate ZIP filename");
      names.add(key);
      originalNames.add(name);
      if (entry.uncompressedSize > MAX_FILE || total + entry.uncompressedSize > MAX_SOURCE)
        throw new Error("ZIP expands too large");
      const target = join(source, ...name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const file = await open(target, "wx", 0o600);
      let actual = 0;
      try {
        await entry.getData(new WritableStream<Uint8Array>({
          async write(chunk) {
            actual += chunk.byteLength;
            if (actual > MAX_FILE || total + actual > MAX_SOURCE)
              throw new Error("ZIP expands too large");
            let offset = 0;
            while (offset < chunk.byteLength) {
              const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
              if (!bytesWritten) throw new Error("ZIP write failed");
              offset += bytesWritten;
            }
          },
        }));
      } finally {
        await file.close();
      }
      if (actual !== entry.uncompressedSize) throw new Error("ZIP size mismatch");
      total += actual;
      count++;
    }
  } finally {
    await reader.close();
  }
  if (!count || !originalNames.has("poster.tex") || !originalNames.has("poster.json"))
    throw new Error("ZIP needs poster.tex and poster.json at its root");
}

async function requireTool(name: string) {
  return new Promise<void>((resolveTool, reject) => {
    const child = spawn(name, ["--version"], { env: { PATH: "/usr/bin:/bin" }, stdio: "ignore" });
    child.once("error", () => reject(new Error(`Missing ${name}; install the Linux worker prerequisites`)));
    child.once("close", (code) => code === 0 ? resolveTool() : reject(new Error(`${name} is unavailable`)));
  });
}

export async function runWorkerSandbox(executable: string, args: string[], source: string, output: string, signal?: AbortSignal) {
  // Bind only TeX's system tree and the current job. Never bind /, /home, /etc or application data.
  const mounts = ["/usr", "/bin", "/lib", "/lib64", "/etc/texmf", "/etc/fonts", "/var/lib/texmf"];
  const bwrap = ["--die-with-parent", "--new-session", "--unshare-all", "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/tmp", "--dir", "/work", "--dir", "/out"];
  for (const mount of mounts) {
    try { await stat(mount); bwrap.push("--ro-bind", mount, mount); } catch { /* absent on this distribution */ }
  }
  bwrap.push("--ro-bind", source, "/work", "--bind", output, "/out",
    "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "TEXMFOUTPUT", "/out", "--chdir", "/work", "--",
    executable, ...args);
  return new Promise<number>((finish, reject) => {
    const child = spawn("prlimit", ["--as=2147483648", "--cpu=90", "--fsize=104857600", "--nofile=256", "--", "bwrap", ...bwrap], {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "ignore", "pipe"], detached: true,
    });
    let ended = false;
    let reason: Error | undefined;
    // Do not return raw TeX logs: source text and filesystem details can be sensitive.
    child.stderr.on("data", () => {});
    const kill = () => {
      reason = new Error(signal?.aborted ? "Job cancelled" : "Worker time limit exceeded");
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    };
    const timer = setTimeout(kill, LIMIT_MS);
    signal?.addEventListener("abort", kill, { once: true });
    child.once("error", (error) => { if (!ended) { ended = true; clearTimeout(timer); signal?.removeEventListener("abort", kill); reject(error); } });
    child.once("close", (code) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (reason) reject(reason);
      else finish(code ?? -1);
    });
  });
}

export async function runIsolatedWorker(bundle: string, revision: string, artifactDir: string, signal?: AbortSignal): Promise<WorkerResult> {
  if (process.platform !== "linux") throw new Error("Isolated worker requires Linux");
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Expected a SHA-256 source revision");
  const bytes = await readFile(bundle);
  if (bytes.byteLength > MAX_ZIP) throw new Error("ZIP is too large");
  if (createHash("sha256").update(bytes).digest("hex") !== revision)
    throw new Error("Source revision mismatch");
  await Promise.all(["prlimit", "bwrap", "xelatex", "xdvipdfmx"].map(requireTool));
  const staging = await mkdtemp(join(tmpdir(), "overposter-worker-"));
  const source = join(staging, "source");
  const output = join(staging, "output");
  try {
    await mkdir(source, { mode: 0o700 });
    await mkdir(output, { mode: 0o700 });
    await extractWorkerBundle(bytes, source);
    // A worker needs a complete immutable bundle; no host template fallback.
    await stat(join(source, "poster-layout.tex"));
    const config = parsePosterConfig(JSON.parse(await readFile(join(source, "poster.json"), "utf8")));
    await writeFile(join(source, "config.tex"), configTex(config), { mode: 0o600 });
    const tex = ["-no-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "-output-directory=/out", "poster.tex"];
    if (await runWorkerSandbox("xelatex", tex, source, output, signal) !== 0)
      return { ok: false, revision, error: "Isolated XeLaTeX failed; inspect the worker's restricted diagnostics" };
    if (await runWorkerSandbox("xdvipdfmx", ["-o", "/out/poster.pdf", "/out/poster.xdv"], source, output, signal) !== 0)
      return { ok: false, revision, error: "Isolated PDF conversion failed" };
    const pdf = join(output, "poster.pdf");
    if ((await stat(pdf)).size > MAX_OUTPUT) throw new Error("Compiled PDF exceeds 100 MB");
    if ((await readdir(output)).length > 100) throw new Error("Worker produced too many files");
    const report = await preflight(pdf, join(source, "poster.json"));
    if (!report.valid) return { ok: false, revision, error: "PDF preflight failed", report };
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    const target = resolve(artifactDir);
    const pdfTemp = join(target, `${revision}.pdf.tmp`);
    const reportTemp = join(target, `${revision}.preflight.json.tmp`);
    try {
      await writeFile(pdfTemp, await readFile(pdf), { mode: 0o600 });
      await writeFile(reportTemp, JSON.stringify({ revision, ...report }, null, 2) + "\n", { mode: 0o600 });
      await rename(pdfTemp, join(target, `${revision}.pdf`));
      await rename(reportTemp, join(target, `${revision}.preflight.json`));
    } finally {
      await rm(pdfTemp, { force: true });
      await rm(reportTemp, { force: true });
    }
    return { ok: true, revision, report };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [bundle, revision, artifactDir] = process.argv.slice(2);
  if (!bundle || !revision || !artifactDir) {
    console.error("Usage: pnpm worker:run <source.zip> <sha256> <private-artifact-dir>");
    process.exitCode = 2;
  } else {
    const controller = new AbortController();
    process.once("SIGTERM", () => controller.abort());
    process.once("SIGINT", () => controller.abort());
    runIsolatedWorker(bundle, revision, artifactDir, controller.signal).then((result) => {
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
