export function safeRenderScale(width: number, height: number): number {
  const maxSide = 4096;
  const maxPixels = 12_000_000;
  return Math.min(
    1,
    maxSide / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );
}
