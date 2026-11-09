import { spawn } from "node:child_process";
import {
  mkdtemp,
  cp,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { sourceDir, listFiles, getProject, dataDir, root } from "./projects.js";
import { preflight, type PreflightReport } from "./preflight.js";
import { configTex, parsePosterConfig } from "./model.js";

export type BuildResult = {
  ok: boolean;
  log: string;
  durationMs: number;
  pdfPath?: string;
  report?: PreflightReport;
  cached?: boolean;
};
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
export async function buildSource(
  source: string,
  output: string,
  configFile?: string,
): Promise<BuildResult> {
  const start = Date.now();
  const staging = await mkdtemp(join(tmpdir(), "overposter-"));
  try {
    await cp(source, staging, { recursive: true });
    try {
      await stat(join(staging, "poster-layout.tex"));
    } catch {
      await copyFile(join(root, "templates", "shared", "poster-layout.tex"), join(staging, "poster-layout.tex"));
    }
    try {
      const c = parsePosterConfig(JSON.parse(await readFile(join(staging, "poster.json"), "utf8")));
      await writeFile(join(staging, "config.tex"), configTex(c));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(join(staging, "out"));
    const xelatexArgs = [
          "-no-pdf",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-file-line-error",
          "-no-shell-escape",
          "-output-directory=out",
          "poster.tex",
        ];
    let run = await runCommand("xelatex", xelatexArgs, 120000, staging);
    if (run.code !== 0 && !run.timedOut &&
        run.log.includes("Sorry, but xelatex did not succeed") &&
        run.log.includes("unsupported version of Windows") &&
        !run.log.includes("poster.tex:")) {
      const retry = await runCommand("xelatex", xelatexArgs, 120000, staging);
      run = { ...retry, log: "MiKTeX startup failed once; retried real XeLaTeX.\n" + retry.log };
    }
    if (run.code === 0) {
        const final = await runCommand(
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
    if (run.timedOut)
      return {
        ok: false,
        log: "Compilation timed out.\n" + run.log,
        durationMs: Date.now() - start,
      };
    if (run.code !== 0)
      return {
        ok: false,
        log: run.log.includes("ENOENT")
          ? "XeLaTeX or xdvipdfmx is missing. Install MiKTeX (Windows) or TeX Live and add both commands to PATH.\n" + run.log
          : run.log || "Compiler failed",
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
  if (process.env.OVERPOSTER_MODE === "hosted")
    return {
      ok: false,
      log: "Hosted compilation is disabled until an isolated TeX worker is configured and verified.",
      durationMs: 0,
    };
  if (project.imported && !project.trusted)
    return {
      ok: false,
      log: "Review this imported project and approve local compilation before building it.",
      durationMs: 0,
    };
  const source = await sourceDir(id);
  const output = join(dataDir, "builds", `${id}.pdf`);
  await writeFile(
    join(source, "poster.json"),
    JSON.stringify(project.config, null, 2),
  );
  await writeFile(join(source, "config.tex"), configTex(project.config));
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
