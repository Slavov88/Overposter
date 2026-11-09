import { afterAll, describe, expect, it } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  defaults,
  dimensions,
  mmToPt,
  posterConfigSchema,
  safePath,
} from "../apps/server/src/model.js";
import {
  createProject,
  dataDir,
  exportZip,
  importZip,
  listFiles,
  readProjectFile,
  writeProjectFile,
} from "../apps/server/src/projects.js";
import { buildProject, runCommand } from "../apps/server/src/compiler.js";

const ids: string[] = [];
afterAll(async () => {
  for (const id of ids)
    await rm(join(dataDir, "projects", id), { recursive: true, force: true });
});
describe("poster model and files", () => {
  it("converts standard and custom sizes", () => {
    expect(dimensions(defaults)).toEqual({ widthMm: 841, heightMm: 594 });
    expect(
      dimensions({ ...defaults, size: "A0", orientation: "portrait" }),
    ).toEqual({ widthMm: 841, heightMm: 1189 });
    expect(mmToPt(25.4)).toBeCloseTo(72);
  });
  it("rejects incomplete custom settings and unsafe paths", () => {
    expect(() =>
      posterConfigSchema.parse({ ...defaults, size: "custom" }),
    ).toThrow();
    expect(() =>
      posterConfigSchema.parse({ ...defaults, columns: 4 }),
    ).toThrow();
    for (const path of ["../x", "/etc/passwd", "C:\\evil", "a/../../b"])
      expect(() => safePath(path)).toThrow();
  });
  it("creates a modular project and safely round trips a binary asset", async () => {
    const p = await createProject("Test poster", { theme: "visual-results" });
    ids.push(p.id);
    const files = await listFiles(p.id);
    expect(files).toContain("poster.tex");
    expect(files).toContain("sections/results.tex");
    await writeProjectFile(
      p.id,
      "figures/pixels.bin",
      Buffer.from([0, 255, 128]),
    );
    const zip = await exportZip(p.id);
    const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(zip)])));
    const entries = await reader.getEntries();
    expect(entries.map((e) => e.filename)).toContain("poster.json");
    expect(entries.map((e) => e.filename)).toContain("figures/pixels.bin");
    await reader.close();
    const imported = await importZip("Imported", zip);
    ids.push(imported.id);
    expect(await readProjectFile(imported.id, "figures/pixels.bin")).toEqual(
      Buffer.from([0, 255, 128]),
    );
  });
  it("rejects ZIP traversal before creating a project", async () => {
    const writer = new BlobWriter();
    const zip = new ZipWriter(writer);
    await zip.add("poster.tex", new TextReader("test"));
    await zip.add("../escape.txt", new TextReader("bad"));
    await zip.close();
    const bytes = new Uint8Array(await (await writer.getData()).arrayBuffer());
    await expect(importZip("Unsafe", bytes)).rejects.toThrow("Unsafe");
  });
  it("imports only the files present in a minimal ZIP", async () => {
    const writer = new BlobWriter();
    const zip = new ZipWriter(writer);
    await zip.add(
      "poster.tex",
      new TextReader(
        String.raw`\documentclass{article}\begin{document}Hello\end{document}`,
      ),
    );
    await zip.close();
    const bytes = new Uint8Array(await (await writer.getData()).arrayBuffer());
    const project = await importZip("Minimal", bytes);
    ids.push(project.id);
    expect(await listFiles(project.id)).not.toContain(
      "sections/introduction.tex",
    );
  });
});
describe("real compiler and preflight", () => {
  it("compiles an A1 poster and checks page metadata", async () => {
    const p = await createProject("Build test");
    ids.push(p.id);
    const result = await buildProject(p.id);
    expect(result.ok, result.log).toBe(true);
    expect(result.report?.pageCount).toBe(1);
    expect(result.report?.widthMm).toBeCloseTo(841, 0);
    expect(result.report?.heightMm).toBeCloseTo(594, 0);
    expect((await readFile(result.pdfPath!)).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
  });
  it("compiles an A0 portrait poster", async () => {
    const p = await createProject("A0 test", {
      size: "A0",
      orientation: "portrait",
    });
    ids.push(p.id);
    const result = await buildProject(p.id);
    expect(result.ok, result.log).toBe(true);
    expect(result.report?.pageCount).toBe(1);
    expect(result.report?.widthMm).toBeCloseTo(841, 0);
    expect(result.report?.heightMm).toBeCloseTo(1189, 0);
  });
  it("compiles A1 portrait and A0 landscape sizes", async () => {
    for (const [size, orientation, width, height] of [
      ["A1", "portrait", 594, 841],
      ["A0", "landscape", 1189, 841],
    ] as const) {
      const p = await createProject(`${size} ${orientation}`, {
        size,
        orientation,
      });
      ids.push(p.id);
      const result = await buildProject(p.id);
      expect(result.ok, result.log).toBe(true);
      expect(result.report?.pageCount).toBe(1);
      expect(result.report?.widthMm).toBeCloseTo(width, 0);
      expect(result.report?.heightMm).toBeCloseTo(height, 0);
    }
  });
  it("compiles a custom physical size", async () => {
    const p = await createProject("Custom test", {
      size: "custom",
      widthMm: 900,
      heightMm: 600,
    });
    ids.push(p.id);
    const result = await buildProject(p.id);
    expect(result.ok, result.log).toBe(true);
    expect(result.report?.widthMm).toBeCloseTo(900, 0);
    expect(result.report?.heightMm).toBeCloseTo(600, 0);
  });
  it("reports missing images and preserves the previous PDF", async () => {
    const p = await createProject("Broken test");
    ids.push(p.id);
    const first = await buildProject(p.id);
    expect(first.ok, first.log).toBe(true);
    const old = await readFile(first.pdfPath!);
    await writeProjectFile(
      p.id,
      "sections/results.tex",
      "\\includegraphics{figures/does-not-exist.pdf}",
    );
    const second = await buildProject(p.id);
    expect(second.ok).toBe(false);
    expect(second.log).toMatch(/does-not-exist|not found|unable/i);
    expect(await readFile(first.pdfPath!)).toEqual(old);
  });
  it("limits command execution time", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "setTimeout(()=>{},10000)"],
      100,
    );
    expect(result.timedOut).toBe(true);
  });
});
