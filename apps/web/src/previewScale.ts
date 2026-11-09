export function safeRenderScale(width: number, height: number): number {
  const maxSide = 4096;
  const maxPixels = 12_000_000;
  return Math.min(
    1,
    maxSide / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );
}
export type PdfTile = { x: number; y: number; width: number; height: number; key: string };
export function visibleTiles(
  width: number, height: number, scrollX: number, scrollY: number,
  viewportWidth: number, viewportHeight: number, tileSize = 512,
): PdfTile[] {
  const result: PdfTile[] = [];
  const firstX = Math.max(0, Math.floor((scrollX - tileSize) / tileSize));
  const firstY = Math.max(0, Math.floor((scrollY - tileSize) / tileSize));
  const lastX = Math.min(Math.ceil(width / tileSize) - 1, Math.floor((scrollX + viewportWidth + tileSize) / tileSize));
  const lastY = Math.min(Math.ceil(height / tileSize) - 1, Math.floor((scrollY + viewportHeight + tileSize) / tileSize));
  for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
    if (result.length >= 24) return result;
    result.push({ x: x * tileSize, y: y * tileSize, width: Math.min(tileSize, width - x * tileSize), height: Math.min(tileSize, height - y * tileSize), key: `${x}:${y}` });
  }
  return result;
}
