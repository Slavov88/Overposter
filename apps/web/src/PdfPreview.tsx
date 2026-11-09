import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Download, Expand, Maximize2, Minus, Plus, Scan } from "lucide-react";
import { visibleTiles, type PdfTile } from "./previewScale";
GlobalWorkerOptions.workerSrc = worker;

function Tile({ page, tile, zoom }: { page: PDFPageProxy; tile: PdfTile; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.ceil(tile.width * ratio);
    element.height = Math.ceil(tile.height * ratio);
    const context = element.getContext("2d");
    if (!context) return;
    const task = page.render({
      canvas: element,
      canvasContext: context,
      viewport: page.getViewport({ scale: zoom * ratio }),
      transform: [1, 0, 0, 1, -tile.x * ratio, -tile.y * ratio],
    });
    task.promise.catch(() => {});
    return () => { task.cancel(); };
  }, [page, tile.x, tile.y, tile.width, tile.height, zoom]);
  return <canvas ref={canvas} aria-hidden="true" style={{ position: "absolute", left: tile.x, top: tile.y, width: tile.width, height: tile.height }} />;
}
export default function PdfPreview({ url, version }: { url: string | null; version: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const previousZoom = useRef(1);
  const scroll = useRef({ x: 0, y: 0 });
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("Compile to see your poster");
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!url) { setPage(null); return; }
    let cancelled = false;
    setPage(null);
    setStatus("Rendering preview…");
    const task = getDocument({ url: url + "?v=" + version });
    task.promise.then(async (document) => {
      const loaded = await document.getPage(1);
      if (cancelled) return;
      const viewport = loaded.getViewport({ scale: 1 });
      setPage(loaded);
      setSize({ width: viewport.width, height: viewport.height });
      setStatus("");
    }).catch(() => { if (!cancelled) setStatus("Preview unavailable. The PDF can still be downloaded."); });
    return () => { cancelled = true; task.destroy(); };
  }, [url, version]);
  useEffect(() => { initialized.current = false; }, [url]);
  function updateVisible() {
    const el = wrap.current, poster = pageElement.current;
    if (!el || !poster) return;
    scroll.current = { x: el.scrollLeft, y: el.scrollTop };
    setView({ x: el.scrollLeft - poster.offsetLeft, y: el.scrollTop - poster.offsetTop, width: el.clientWidth, height: el.clientHeight });
  }
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(updateVisible);
    observer.observe(el);
    updateVisible();
    return () => observer.disconnect();
  }, [page, zoom, full]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || !page) return;
    if (!initialized.current) {
      initialized.current = true;
      setZoom(Math.max(0.08, Math.min((el.clientWidth - 40) / size.width, (el.clientHeight - 40) / size.height)));
    } else {
      const factor = zoom / previousZoom.current;
      el.scrollLeft = scroll.current.x * factor;
      el.scrollTop = scroll.current.y * factor;
      updateVisible();
    }
    previousZoom.current = zoom;
  }, [page, size, zoom]);
  useEffect(() => {
    const el = wrap.current;
    if (el && page) { el.scrollLeft = scroll.current.x; el.scrollTop = scroll.current.y; updateVisible(); }
  }, [version, page]);
  function fit(mode: "all" | "width") {
    const el = wrap.current;
    if (!el) return;
    const next = mode === "all" ? Math.min((el.clientWidth - 40) / size.width, (el.clientHeight - 40) / size.height) : (el.clientWidth - 40) / size.width;
    setZoom(Math.max(0.08, Math.min(2.5, next)));
  }
  const width = size.width * zoom, height = size.height * zoom;
  const tiles = page ? visibleTiles(width, height, view.x, view.y, view.width, view.height) : [];
  return <div className={"preview " + (full ? "preview-full" : "")}>
    <div className="preview-bar"><span>POSTER PREVIEW</span><div className="preview-tools">
      <button title="Fit poster" onClick={() => fit("all")}><Scan size={16} /></button>
      <button title="Fit width" onClick={() => fit("width")}><Expand size={16} /></button>
      <button title="Zoom out" onClick={() => setZoom((z) => Math.max(0.08, z / 1.25))}><Minus size={16} /></button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button title="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, z * 1.25))}><Plus size={16} /></button>
      <button title="Fullscreen" onClick={() => setFull((f) => !f)}><Maximize2 size={16} /></button>
      {url && <a title="Download PDF" href={url} download="poster.pdf"><Download size={16} /></a>}
    </div></div>
    <div className="preview-scroll" ref={wrap} onScroll={updateVisible}>
      {page ? <div className="pdf-page" ref={pageElement} style={{ width, height }} aria-label="Poster PDF preview">{tiles.map((tile) => <Tile key={tile.key} page={page} tile={tile} zoom={zoom} />)}</div> : <div className="preview-empty">{status}</div>}
      {status && page && <div className="preview-overlay">{status}</div>}
    </div>
  </div>;
}
