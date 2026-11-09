import { rm, mkdir, writeFile, cp, copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildSource, buildProject } from "../apps/server/src/compiler.js";
import {
  createProject,
  exportZip,
  root,
  dataDir,
} from "../apps/server/src/projects.js";
import {
  posterConfigSchema,
  parsePosterConfig,
  configTex,
  defaults,
  templateIds,
} from "../apps/server/src/model.js";
import { preflight } from "../apps/server/src/preflight.js";

const [verb, ...args] = process.argv.slice(2);
function option(key: string) {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? undefined : args[i + 1];
}
async function main() {
  if (verb === "new") {
    const p = await createProject(option("name") || "New research poster", {
      ...defaults,
      theme: (option("theme") || defaults.theme) as typeof defaults.theme,
    });
    console.log(
      `Created ${p.name}\nID: ${p.id}\nSource: ${join(dataDir, "projects", p.id, "source")}`,
    );
    return;
  }
  if (verb === "clean") {
    await rm(join(dataDir, "builds"), { recursive: true, force: true });
    console.log("Build artifacts removed.");
    return;
  }
  if (verb === "export") {
    const id = option("id");
    if (!id) throw new Error("Provide --id");
    const out = resolve(option("out") || `${id}.zip`);
    await writeFile(out, await exportZip(id));
    console.log(out);
    return;
  }
  if (verb === "examples") {
    const sample = join(root, "examples", "sample-ml-poster");
    const targets = [
      ...templateIds.map((t) => ({
        name: t,
        source: join(root, "templates", t),
      })),
      { name: "sample-ml-poster", source: sample },
      ...templateIds.map((t) => ({ name: `gallery-${t}`, source: sample, theme: t })),
    ];
    for (const target of targets) {
      const temp = join(dataDir, "examples", target.name);
      await rm(temp, { recursive: true, force: true });
      await mkdir(temp, { recursive: true });
      await cp(target.source, temp, { recursive: true });
      if ("theme" in target && target.theme) {
        await copyFile(join(root, "templates", target.theme, "poster.tex"), join(temp, "poster.tex"));
        const c = parsePosterConfig(JSON.parse(await readFile(join(sample, "poster.json"), "utf8")));
        await writeFile(join(temp, "poster.json"), JSON.stringify({ ...c, theme: target.theme, columns: target.theme === "modern-ml" ? 2 : 3 }, null, 2));
      }
      if (target.name !== "sample-ml-poster" && !("theme" in target)) {
        const c = posterConfigSchema.parse({
          ...defaults,
          theme: target.name,
          title: `${target.name.replaceAll("-", " ")} template`,
        });
        await writeFile(join(temp, "poster.json"), JSON.stringify(c));
        await writeFile(join(temp, "config.tex"), configTex(c));
      }
      const out = join(dataDir, "builds", `${target.name}.pdf`);
      const r = await buildSource(temp, out);
      console.log(
        `${target.name}: ${r.ok ? "OK" : "FAILED"} ${r.report?.widthMm || ""} x ${r.report?.heightMm || ""} mm, ${r.durationMs} ms`,
      );
      if (!r.ok) {
        console.error(r.log);
        process.exitCode = 1;
      }
    }
    return;
  }
  if (verb === "build") {
    const id = option("id");
    const source = resolve(
      option("source") || join(root, "examples", "sample-ml-poster"),
    );
    const out = resolve(
      option("out") || join(dataDir, "builds", "sample-ml-poster.pdf"),
    );
    const r = id ? await buildProject(id) : await buildSource(source, out);
    console.log(
      `${r.ok ? "Build succeeded" : "Build failed"} in ${r.durationMs} ms`,
    );
    if (r.report) console.log(JSON.stringify(r.report, null, 2));
    if (!r.ok) {
      console.error(r.log);
      process.exitCode = 1;
    } else console.log(r.pdfPath);
    return;
  }
  if (verb === "check") {
    const pdf = resolve(
      option("pdf") || join(dataDir, "builds", "sample-ml-poster.pdf"),
    );
    const config = resolve(
      option("config") ||
        join(root, "examples", "sample-ml-poster", "poster.json"),
    );
    const r = await preflight(pdf, config);
    if (option("out"))
      await writeFile(
        resolve(option("out")!),
        JSON.stringify(r, null, 2) + "\n",
      );
    if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(
        `${r.valid ? "PASS" : "FAIL"}: ${r.pageCount} page, ${r.widthMm} × ${r.heightMm} mm`,
      );
      for (const issue of r.issues)
        console.log(
          `${issue.level.toUpperCase()} ${issue.code}: ${issue.message}`,
        );
    }
    if (!r.valid) process.exitCode = 1;
    return;
  }
  throw new Error(
    "Usage: pnpm poster:new|poster:build|poster:check|poster:clean|poster:export|examples:build [options]",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
