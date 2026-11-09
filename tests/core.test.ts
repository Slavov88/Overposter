import { afterAll, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
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
  posterConfigPatchSchema,
  safePath,
  configTex,
  parsePosterConfig,
  normalizeOrcid,
  templateIds,
} from "../apps/server/src/model.js";
import {
  createProject,
  dataDir,
  deleteProject,
  exportZip,
  importZip,
  listFiles,
  readProjectFile,
  trustImportedProject,
  writeProjectFile,
  getProject,
  updateProject,
} from "../apps/server/src/projects.js";
import { buildProject, runCommand } from "../apps/server/src/compiler.js";
import { checkpoint, listVersions, restoreVersion, versionDiff } from "../apps/server/src/versions.js";

const ids: string[] = [];
afterAll(async () => {
  for (const id of ids) await deleteProject(id);
});
describe("poster model and files", () => {
  it("migrates flat metadata deterministically without dropping names", () => {
    const legacy = { ...defaults, authors: "Dr. Ana & Bob", affiliation: "Physics Lab, University X", paperUrl: "" };
    const first = parsePosterConfig(legacy);
    const second = parsePosterConfig(legacy);
    expect(first).toEqual(second);
    expect(first.authors[0].name).toBe("Dr. Ana & Bob");
    expect(first.affiliations[0].institution).toBe("Physics Lab, University X");
    expect(configTex(first)).toContain("Dr. Ana \\& Bob\\textsuperscript{1}");
    expect(parsePosterConfig({ ...legacy, paperUrl: "example.org/paper" }).paperUrl).toBe("https://example.org/paper");
  });
  it("numbers multiple affiliations and validates ORCID", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const authors = [
      { id: "11111111-1111-4111-8111-111111111111", name: "Alice", email: "alice@example.org", orcid: "0000-0002-1825-0097", affiliationIds: [a], corresponding: true },
      { id: "22222222-2222-4222-8222-222222222222", name: "Bob", email: "", orcid: "", affiliationIds: [a, b] },
      { id: "33333333-3333-4333-8333-333333333333", name: "Carol", email: "", orcid: "", affiliationIds: [b] },
    ];
    const affiliations = [
      { id: a, institution: "University X" },
      { id: b, institution: "Institute Y" },
    ];
    const config = posterConfigSchema.parse({ ...defaults, authors, affiliations });
    const tex = configTex(config);
    expect(tex).toContain("Alice\\textsuperscript{1,*}");
    expect(tex).toContain("Bob\\textsuperscript{1,2}");
    expect(tex).toContain("Carol\\textsuperscript{2}");
    expect(tex).toContain("mailto:alice@example.org");
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(() => normalizeOrcid("0000-0002-1825-0098")).toThrow();
    expect(() => posterConfigSchema.parse({ ...defaults, authors, affiliations: [affiliations[0]] })).toThrow();
  });
  it("converts standard and custom sizes", () => {
    expect(dimensions(defaults)).toEqual({ widthMm: 841, heightMm: 594 });
    expect(
      dimensions({ ...defaults, size: "A0", orientation: "portrait" }),
    ).toEqual({ widthMm: 841, heightMm: 1189 });
    expect(mmToPt(25.4)).toBeCloseTo(72);
  });
  it("rejects incomplete custom settings and unsafe paths", () => {
    expect(posterConfigPatchSchema.parse({ theme: "visual-results" })).toMatchObject({
      theme: "visual-results",
    });
    expect(() => posterConfigPatchSchema.parse({ theme: "invalid" })).toThrow();
    expect(() =>
      posterConfigSchema.parse({ ...defaults, size: "custom" }),
    ).toThrow();
    expect(posterConfigSchema.parse({ ...defaults, columns: 4 }).columns).toBe(4);
    expect(() => posterConfigSchema.parse({ ...defaults, columns: 5 })).toThrow();
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
    expect(imported.imported).toBe(true);
    const blocked = await buildProject(imported.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.log).toContain("approve local compilation");
    await trustImportedProject(imported.id);
    const built = await buildProject(imported.id);
    expect(built.ok, built.log).toBe(true);
    expect(built.report?.pageCount).toBe(1);
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
  it("deletes source and generated artifacts together", async () => {
    const project = await createProject("Delete test");
    const result = await buildProject(project.id);
    expect(result.ok, result.log).toBe(true);
    await checkpoint(project.id, "Before deletion");
    await deleteProject(project.id);
    await expect(stat(result.pdfPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(dataDir, "projects", project.id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(join(dataDir, "versions", `${project.id}.git`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
describe("real compiler and preflight", () => {
  it("builds every layout across standard sizes, orientations, columns, and font scales", async () => {
    const cases = [
      { size: "A1", orientation: "landscape", columns: 2, fontScale: 0.8 },
      { size: "A1", orientation: "portrait", columns: 3, fontScale: 1 },
      { size: "A0", orientation: "landscape", columns: 4, fontScale: 1.25 },
      { size: "A0", orientation: "portrait", columns: 2, fontScale: 1 },
    ] as const;
    for (const theme of templateIds) for (const config of cases) {
      const project = await createProject("Matrix " + theme, { theme, ...config });
      ids.push(project.id);
      const built = await buildProject(project.id);
      expect(built.ok, `${theme} ${config.size} ${config.orientation} c${config.columns}: ${built.log}`).toBe(true);
      expect(built.report?.pageCount).toBe(1);
      const expected = dimensions(project.config);
      expect(built.report?.widthMm).toBeCloseTo(expected.widthMm, 0);
      expect(built.report?.heightMm).toBeCloseTo(expected.heightMm, 0);
    }
  }, 120000);
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
describe("Git-backed project versions", () => {
  it("checkpoints, compares, and restores without erasing history", async () => {
    const p = await createProject("Version test");
    ids.push(p.id);
    const first = await checkpoint(p.id, "First draft");
    const named = await checkpoint(p.id, "Reviewed draft");
    expect(named).not.toBe(first);
    expect((await listVersions(p.id)).versions[0].message).toBe("Reviewed draft");
    const original = (await readProjectFile(p.id, "sections/results.tex")).toString();
    await writeProjectFile(p.id, "sections/results.tex", "Second draft\\n");
    await updateProject(p.id, { title: "Changed title" });
    const second = await checkpoint(p.id, "Second draft");
    expect(await versionDiff(p.id, first, second)).toContain("Second draft");
    await expect(restoreVersion(p.id, first, first)).rejects.toThrow("changed");
    const restored = await restoreVersion(p.id, first, second);
    expect(restored).not.toBe(first);
    expect(restored).not.toBe(second);
    expect((await readProjectFile(p.id, "sections/results.tex")).toString()).toBe(original);
    expect((await getProject(p.id)).config.title).toBe(p.config.title);
    const history = await listVersions(p.id);
    expect(history.versions.map((v) => v.id)).toEqual(expect.arrayContaining([first, named, second, restored]));
  });
});
