import { spawn } from "node:child_process";
import { join } from "node:path";
import { root } from "./projects.js";
export type Issue = {
  level: "error" | "warning";
  code: string;
  message: string;
};
export type PreflightReport = {
  valid: boolean;
  pageCount: number;
  widthMm: number;
  heightMm: number;
  issues: Issue[];
  fonts?: unknown[];
  images?: unknown[];
};
export async function preflight(
  pdf: string,
  config: string,
  log = "",
): Promise<PreflightReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [join(root, "scripts", "preflight.py"), pdf, config],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(err || out || "Preflight failed or timed out"));
      try {
        const report = JSON.parse(out) as PreflightReport;
        if (/not found|cannot find|missing file/i.test(log))
          report.issues.push({
            level: "warning",
            code: "build-log",
            message: "Check compiler log for missing assets.",
          });
        if (/Overfull \\hbox|Overfull \\vbox/i.test(log))
          report.issues.push({
            level: "warning",
            code: "overflow",
            message:
              "TeX reported an overfull box. Inspect the layout at print size.",
          });
        resolve(report);
      } catch (e) {
        reject(e);
      }
    });
  });
}
