// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
vi.mock("./PdfPreview", () => ({ default: () => null }));
import App from "./App";
import { safeRenderScale, visibleTiles } from "./previewScale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("opens project creation, selects a layout, and exposes custom dimensions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", { headers: { "Content-Type": "application/json" } }),
    ),
  );
  render(createElement(App));
  await waitFor(() => expect(screen.getByText("Poster projects")).toBeTruthy());
  fireEvent.click(screen.getByText("New poster"));
  expect(screen.getByText("Start a poster")).toBeTruthy();
  fireEvent.click(screen.getByText("Visual Results"));
  expect(
    screen.getByText("Visual Results").closest("button")?.className,
  ).toContain("active");
  fireEvent.change(screen.getByLabelText("Paper size"), {
    target: { value: "custom" },
  });
  expect(screen.getByLabelText("Width (mm)")).toBeTruthy();
  expect(screen.getByLabelText("Height (mm)")).toBeTruthy();
});
it("caps large poster canvases to a bounded pixel budget", () => {
  const scale = safeRenderScale(8500, 8500);
  expect(8500 * scale).toBeLessThanOrEqual(4096);
  expect(8500 * 8500 * scale * scale).toBeLessThanOrEqual(12_000_000);
});
it("renders only bounded visible tiles at high zoom", () => {
  const tiles = visibleTiles(12000, 9000, 5300, 3800, 1100, 800);
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.length).toBeLessThanOrEqual(24);
  expect(tiles.every((tile) => tile.width <= 512 && tile.height <= 512)).toBe(true);
  expect(tiles.every((tile) => tile.x + tile.width >= 4788 && tile.x <= 6912)).toBe(true);
});
