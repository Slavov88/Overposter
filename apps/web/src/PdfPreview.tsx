import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Download, Expand, Maximize2, Minus, Plus, Scan } from "lucide-react";
import { safeRenderScale } from "./previewScale";
GlobalWorkerOptions.workerSrc = worker;
export default function PdfPreview({
  url,
  version,
}: {
  url: string | null;
  version: number;
}) {
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    pageRef = useRef<any>(null),
    job = useRef<any>(null),
    fitInitialized = useRef(false),
    scroll = useRef({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1, height: 1 }),
    [zoom, setZoom] = useState(1),
    [status, setStatus] = useState("Compile to see your poster"),
    [full, setFull] = useState(false);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setStatus("Rendering preview…");
    const task = getDocument({ url: `${url}?v=${version}` });
    task.promise
      .then(async (pdf) => {
        const page = await pdf.getPage(1);
        if (cancelled) return;
        pageRef.current = page;
        const view = page.getViewport({ scale: 1 });
        setSize({ width: view.width, height: view.height });
        setStatus("");
      })
      .catch(() => {
        if (!cancelled)
          setStatus(
            "Preview unavailable. The last PDF can still be downloaded.",
          );
      });
    return () => {
      cancelled = true;
      job.current?.cancel();
      task.destroy();
    };
  }, [url, version]);
  useEffect(() => {
    const page = pageRef.current,
      element = canvas.current;
    if (!page || !element) return;
    job.current?.cancel();
    const ratio = safeRenderScale(size.width, size.height);
    const viewport = page.getViewport({ scale: ratio });
    element.width = Math.max(1, Math.floor(viewport.width));
    element.height = Math.max(1, Math.floor(viewport.height));
    const context = element.getContext("2d");
    if (!context) return;
    const render = page.render({
      canvas: element,
      canvasContext: context,
      viewport,
    });
    job.current = render;
    render.promise.catch(() => {});
  }, [size, version]);
  useEffect(() => {
    const el = wrap.current;
    if (el) {
      el.scrollLeft = scroll.current.x;
      el.scrollTop = scroll.current.y;
    }
  }, [version, zoom]);
  const fit = (mode: "all" | "width") => {
    const el = wrap.current;
    if (!el) return;
    setZoom(
      Math.max(
        0.08,
        Math.min(
          2.5,
          mode === "all"
            ? Math.min(
                (el.clientWidth - 40) / size.width,
                (el.clientHeight - 40) / size.height,
              )
            : (el.clientWidth - 40) / size.width,
        ),
      ),
    );
  };
  useEffect(() => {
    if (size.width > 1 && !fitInitialized.current) {
      fitInitialized.current = true;
      fit("all");
    }
  }, [size]);
  return (
    <div className={"preview " + (full ? "preview-full" : "")}>
      <div className="preview-bar">
        <span>POSTER PREVIEW</span>
        <div className="preview-tools">
          <button title="Fit poster" onClick={() => fit("all")}>
            <Scan size={16} />
          </button>
          <button title="Fit width" onClick={() => fit("width")}>
            <Expand size={16} />
          </button>
          <button
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.08, z / 1.25))}
          >
            <Minus size={16} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(2.5, z * 1.25))}
          >
            <Plus size={16} />
          </button>
          <button title="Fullscreen" onClick={() => setFull((f) => !f)}>
            <Maximize2 size={16} />
          </button>
          {url && (
            <a title="Download PDF" href={url} download="poster.pdf">
              <Download size={16} />
            </a>
          )}
        </div>
      </div>
      <div
        className="preview-scroll"
        ref={wrap}
        onScroll={(e) => {
          scroll.current = {
            x: e.currentTarget.scrollLeft,
            y: e.currentTarget.scrollTop,
          };
        }}
      >
        {url ? (
          <canvas
            ref={canvas}
            style={{ width: size.width * zoom, height: size.height * zoom }}
            aria-label="Poster PDF preview"
          />
        ) : (
          <div className="preview-empty">{status}</div>
        )}
        {status && url && <div className="preview-overlay">{status}</div>}
      </div>
    </div>
  );
}
