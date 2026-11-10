import { expect, test } from "@playwright/test";

test("two authorized editors share source, presence, and permissions", async ({ browser }) => {
  const owner = await browser.newContext();
  const collaborator = await browser.newContext();
  const viewer = await browser.newContext();
  const outsider = await browser.newContext();
  try {
    for (const [context, subject] of [[owner, "alice"], [collaborator, "bob"], [viewer, "carol"], [outsider, "dave"]] as const) {
      expect((await context.request.post("/api/test-session", { data: { subject } })).ok()).toBe(true);
    }
    const created = await owner.request.post("/api/projects", { data: { name: `Browser shared ${Date.now()}` } });
    expect(created.ok()).toBe(true);
    const project = await created.json() as { id: string; name: string };
    const alice = await owner.newPage();
    await alice.goto("/");
    await alice.getByRole("button", { name: new RegExp(project.name) }).click();
    await expect(alice.getByText("Shared changes saved")).toBeVisible();
    await alice.getByRole("button", { name: "Share project" }).click();
    await alice.getByRole("textbox", { name: "Account ID" }).fill("bob");
    await alice.getByRole("button", { name: "Add person" }).click();
    await expect(alice.getByRole("listitem").filter({ hasText: "bob" })).toBeVisible();
    await alice.getByRole("textbox", { name: "Account ID" }).fill("carol");
    await alice.getByRole("combobox", { name: "Role" }).selectOption("viewer");
    await alice.getByRole("button", { name: "Add person" }).click();
    await alice.getByRole("button", { name: "Close sharing" }).click();
    const bob = await collaborator.newPage();
    await bob.goto("/");
    await bob.getByRole("button", { name: new RegExp(project.name) }).click();
    await expect(bob.getByText("Shared changes saved")).toBeVisible();
    await expect(alice.getByText("Editing with bob")).toBeVisible();
    const aliceSource = alice.locator(".cm-content");
    await aliceSource.click();
    await aliceSource.press("Control+Home");
    await alice.keyboard.insertText("Alice shared line.\n");
    await expect(bob.locator(".cm-content")).toContainText("Alice shared line.");
    await expect(bob.locator(".remote-cursor").first()).toBeVisible();
    const bobSource = bob.locator(".cm-content");
    await bobSource.click();
    await bobSource.press("Control+Home");
    await bob.keyboard.insertText("Bob shared line.\n");
    await expect(alice.locator(".cm-content")).toContainText("Bob shared line.");
    await expect(alice.getByText("Shared changes saved")).toBeVisible();
    await alice.getByRole("button", { name: "Projects" }).click();
    const source = await owner.request.get(`/api/projects/${project.id}/file?path=poster.tex`);
    expect(await source.text()).toContain("Alice shared line.");
    expect(await source.text()).toContain("Bob shared line.");
    await alice.getByRole("button", { name: new RegExp(project.name) }).click();
    await alice.getByRole("button", { name: "Share project" }).click();
    await alice.getByRole("button", { name: "Remove bob" }).click();
    await expect(bob.getByText("Access changed — reopen project")).toBeVisible();
    await alice.getByRole("button", { name: "Close sharing" }).click();
    const carol = await viewer.newPage();
    await carol.goto("/");
    await carol.getByRole("button", { name: new RegExp(project.name) }).click();
    await expect(carol.getByText("view only")).toBeVisible();
    expect(await outsider.request.get(`/api/projects/${project.id}/file?path=poster.tex`).then((response) => response.status())).toBe(403);
    await bob.close(); await carol.close(); await alice.close();
  } finally {
    await Promise.all([owner.close(), collaborator.close(), viewer.close(), outsider.close()]);
  }
});
