import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("create, edit, compile, checkpoint, export, and trust an imported poster", async ({ page }) => {
  page.on("pageerror", (error) => console.error("Browser page error:", error));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Poster projects" })).toBeVisible();
  await page.getByRole("button", { name: "New poster" }).click();
  await page.getByLabel("Project name").fill("Browser acceptance poster");
  await page.getByLabel("Scientific title").fill("A testable research poster");
  await page.getByRole("button", { name: /Visual Results/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("How many authors?").fill("3");
  await page.getByLabel("Full display name").nth(0).fill("Alice Smith");
  await page.getByLabel("Email (optional)").nth(0).fill("alice@example.org");
  await page.getByLabel("Full display name").nth(1).fill("Bob Jones");
  await page.getByLabel("Full display name").nth(2).fill("Carol Lee");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("How many affiliations?").fill("2");
  await page.getByLabel("Institution").nth(0).fill("Test University");
  await page.getByLabel("Institution").nth(1).fill("Research Institute");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("group", { name: "Alice Smith" }).getByRole("checkbox", { name: /1\. Test University/ }).check();
  await page.getByRole("group", { name: "Bob Jones" }).getByRole("checkbox", { name: /1\. Test University/ }).check();
  await page.getByRole("group", { name: "Bob Jones" }).getByRole("checkbox", { name: /2\. Research Institute/ }).check();
  await page.getByRole("group", { name: "Carol Lee" }).getByRole("checkbox", { name: /2\. Research Institute/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Alice Smith 1.*Bob Jones 1,2.*Carol Lee 2/)).toBeVisible();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Browser acceptance poster", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "sections/results.tex" }).click();
  await page.locator(".cm-content").fill("Illustrative browser test result.\n");
  await page.getByRole("button", { name: "sections/introduction.tex" }).click();
  await page.getByRole("button", { name: "sections/results.tex" }).click();
  await expect(page.locator(".cm-content")).toContainText("Illustrative browser test result.");
  await page.getByRole("button", { name: "Compile poster" }).click();
  await expect(page.getByText("Build complete")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".pdf-page")).toBeVisible();
  const initialWidth = await page.locator(".pdf-page").evaluate((el) => el.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => page.locator(".pdf-page").evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
  await expect(page.locator(".pdf-page canvas").first()).toBeVisible();
  await expect.poll(() => page.locator(".pdf-page canvas").count()).toBeLessThanOrEqual(24);

  await page.getByRole("button", { name: "Version history" }).click();
  await page.getByLabel("Checkpoint name").fill("Browser checkpoint");
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(page.getByRole("button", { name: /Browser checkpoint/ })).toBeVisible();
  await page.getByRole("dialog", { name: "Version history" }).getByRole("button", { name: "Close" }).last().click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export source ZIP" }).click();
  const download = await downloadPromise;
  const sourceZip = await download.path();
  expect(sourceZip).toBeTruthy();
  await page.getByRole("button", { name: "Projects" }).click();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/zip",
    buffer: await readFile(sourceZip!),
  });
  await expect(page.getByRole("heading", { name: "poster-source", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Compile poster" }).click();
  await expect(page.getByText("Build complete")).toBeVisible({ timeout: 60_000 });
});

test("rejects a concurrent stale source save", async ({ request }) => {
  const created = await request.post("/api/projects", { data: { name: "Concurrent save test" } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json() as { id: string };
  try {
    const path = `/api/projects/${id}/file?path=sections/results.tex`;
    const original = await request.get(path);
    const etag = original.headers().etag;
    expect(etag).toBeTruthy();
    const first = await request.put(path, {
      headers: { "Content-Type": "text/plain", "If-Match": etag },
      data: "First editor's result.\n",
    });
    expect(first.ok()).toBe(true);
    const stale = await request.put(path, {
      headers: { "Content-Type": "text/plain", "If-Match": etag },
      data: "Stale editor's result.\n",
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).conflict).toBe(true);
    expect(await (await request.get(path)).text()).toBe("First editor's result.\n");
  } finally {
    await request.delete(`/api/projects/${id}`);
  }
});
