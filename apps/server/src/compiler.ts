import { spawn } from "node:child_process";
import {
  mkdtemp,
  cp,
  mkdir,
  chmod,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { root, sourceDir, listFiles, getProject, dataDir } from "./projects.js";
import { preflight, type PreflightReport } from "./preflight.js";

export type BuildResult = {
  ok: boolean;
  log: string;
  durationMs: number;
  pdfPath?: string;
  report?: PreflightReport;
  cached?: boolean;
};
const image = "overposter-tectonic:0.16.9";
const useDocker = () => process.env.OVERPOSTER_COMPILER === "docker";
export async function runCommand(
  exe: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ code: number; log: string; timedOut: boolean }> {
  return new Promise((done) => {
    const child = spawn(exe, args, { windowsHide: true, cwd });
    let log = "";
    let timedOut = false;
    let settled = false;
    child.stdout.on("data", (d) => {
      log = (log + String(d)).slice(-60000);
    });
    child.stderr.on("data", (d) => {
      log = (log + String(d)).slice(-60000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ code: -1, log: String(e), timedOut });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ code: code ?? -1, log: log.slice(-60000), timedOut });
    });
  });
}
const command = runCommand;
let imagePromise: Promise<void> | undefined;
async function ensureImage() {
  if (!imagePromise)
    imagePromise = (async () => {
      const daemon = await command(
        "docker",
        ["info", "--format", "{{.ServerVersion}}"],
        15000,
      );
      if (daemon.code !== 0)
        throw new Error(
          "Docker Engine is not responding. Start Docker Desktop or Docker Engine and retry. " +
            daemon.log,
        );
      const check = await command("docker", ["image", "inspect", image], 15000);
      if (check.code === 0) return;
      const built = await command(
        "docker",
        [
          "build",
          "-t",
          image,
          "-f",
          join(root, "docker", "tectonic", "Dockerfile"),
          root,
        ],
        900000,
      );
      if (built.code !== 0)
        throw new Error("Docker image build failed: " + built.log);
    })().catch((e) => {
      imagePromise = undefined;
      throw e;
    });
  return imagePromise;
}
export async function buildSource(
  source: string,
  output: string,
  configFile?: string,
): Promise<BuildResult> {
  const start = Date.now();
  const staging = await mkdtemp(join(tmpdir(), "overposter-"));
  try {
    await cp(source, staging, { recursive: true });
    await mkdir(join(staging, "out"));
    if (useDocker()) {
      await chmod(staging, 0o777);
      await chmod(join(staging, "out"), 0o777);
    }
    let run: { code: number; log: string; timedOut: boolean };
    if (!useDocker()) {
      run = await command(
        "xelatex",
        [
          "-no-pdf",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-no-shell-escape",
          "-output-directory=out",
          "poster.tex",
        ],
        120000,
        staging,
      );
      if (run.code === 0) {
        const final = await command(
          "xdvipdfmx",
          ["-o", "out/poster.pdf", "out/poster.xdv"],
          120000,
          staging,
        );
        run = {
          code: final.code,
          log: run.log + "\n" + final.log,
          timedOut: run.timedOut || final.timedOut,
        };
      }
    } else {
      await ensureImage();
      const mount = resolve(staging).replaceAll("\\", "/");
      run = await command(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--cpus=2",
          "--memory=1g",
          "--pids-limit=128",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=256m",
          "-v",
          `${mount}:/work:rw`,
          "-w",
          "/work",
          image,
          "tectonic",
          "-X",
          "compile",
          "--only-cached",
          "--untrusted",
          "--keep-logs",
          "--outdir",
          "out",
          "poster.tex",
        ],
        150000,
      );
    }
    if (run.timedOut)
      return {
        ok: false,
        log: "Compilation timed out.\n" + run.log,
        durationMs: Date.now() - start,
      };
    if (run.code !== 0)
      return {
        ok: false,
        log: run.log || "Compiler failed",
        durationMs: Date.now() - start,
      };
    const pdf = join(staging, "out", "poster.pdf");
    if ((await stat(pdf)).size > 100_000_000)
      throw new Error("Compiled PDF exceeds 100 MB");
    const report = await preflight(
      pdf,
      configFile || join(source, "poster.json"),
      run.log,
    );
    if (!report.valid)
      return {
        ok: false,
        log:
          run.log +
          "\n" +
          report.issues
            .filter((i) => i.level === "error")
            .map((i) => i.message)
            .join("\n"),
        report,
        durationMs: Date.now() - start,
      };
    await mkdir(resolve(output, ".."), { recursive: true });
    const temp = output + ".tmp";
    await cp(pdf, temp);
    await rename(temp, output);
    await writeFile(
      output + ".preflight.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    return {
      ok: true,
      log: run.log,
      durationMs: Date.now() - start,
      pdfPath: output,
      report,
    };
  } catch (e) {
    return {
      ok: false,
      log: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function buildProject(id: string): Promise<BuildResult> {
  const project = await getProject(id);
  if (project.imported && !useDocker())
    return {
      ok: false,
      log: "Imported projects require the Docker compiler. Set OVERPOSTER_COMPILER=docker to build this project.",
      durationMs: 0,
    };
  const source = await sourceDir(id);
  const output = join(dataDir, "builds", `${id}.pdf`);
  await writeFile(
    join(source, "poster.json"),
    JSON.stringify(project.config, null, 2),
  );
  const hash = createHash("sha256").update(JSON.stringify(project.config));
  for (const file of await listFiles(id))
    hash.update(file).update(await readFile(join(source, file)));
  const digest = hash.digest("hex");
  const digestFile = output + ".sha256";
  try {
    if ((await readFile(digestFile, "utf8")) === digest) {
      await stat(output);
      const report = await preflight(output, join(source, "poster.json"));
      return {
        ok: report.valid,
        log: "Unchanged source; using previous build.",
        durationMs: 0,
        pdfPath: output,
        report,
        cached: true,
      };
    }
  } catch {}
  const result = await buildSource(source, output, join(source, "poster.json"));
  if (result.ok) await writeFile(digestFile, digest);
  return result;
}
