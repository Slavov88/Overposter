import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileCode2,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Moon,
  Play,
  Plus,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import PdfPreview from "./PdfPreview";
import {
  api,
  fileUrl,
  json,
  pdfUrl,
  type Build,
  type Config,
  type Project,
} from "./api";

const templates = [
  {
    id: "academic-classic",
    name: "Academic Classic",
    description: "Quiet hierarchy for traditional research",
    swatch: "classic",
  },
  {
    id: "modern-ml",
    name: "Modern ML",
    description: "Strong title and highlighted findings",
    swatch: "modern",
  },
  {
    id: "visual-results",
    name: "Visual Results",
    description: "Figures lead the scientific story",
    swatch: "visual",
  },
] as const;
const defaultConfig: Config = {
  title: "Untitled research poster",
  subtitle: "",
  authors: "",
  affiliation: "",
  contact: "",
  paperUrl: "",
  size: "A1",
  orientation: "landscape",
  theme: "modern-ml",
  columns: 3,
  fontScale: 1,
};
const friendly = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";
function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [active, setActive] = useState<Project | null>(null),
    [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState("poster.tex"),
    [content, setContent] = useState(""),
    [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Build | null>(null),
    [pdfVersion, setPdfVersion] = useState(0),
    [hasPdf, setHasPdf] = useState(false),
    [showCreate, setShowCreate] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showLog, setShowLog] = useState(false),
    [dark, setDark] = useState(
      localStorage.getItem("overposter-theme") === "dark",
    ),
    [draft, setDraft] = useState<Config>(defaultConfig),
    [name, setName] = useState("New research poster");
  const contentRef = useRef(""),
    selectedRef = useRef("poster.tex"),
    activeRef = useRef<Project | null>(null),
    dirtyRef = useRef(false),
    saving = useRef<Promise<void> | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("overposter-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    api<Project[]>("/projects")
      .then(setProjects)
      .catch((e) => setError(friendly(e)))
      .finally(() => setLoading(false));
  }, []);
  async function refresh() {
    setProjects(await api<Project[]>("/projects"));
  }
  async function open(project: Project) {
    setError("");
    setActive(project);
    activeRef.current = project;
    setResult(null);
    setSelected("poster.tex");
    selectedRef.current = "poster.tex";
    setDirty(false);
    dirtyRef.current = false;
    const [list, text] = await Promise.all([
      api<string[]>(`/projects/${project.id}/files`),
      fetch(fileUrl(project.id, "poster.tex")).then((r) => r.text()),
    ]);
    setFiles(list);
    setContent(text);
    contentRef.current = text;
    const head = await fetch(pdfUrl(project.id), { method: "HEAD" });
    setHasPdf(head.ok);
    setPdfVersion((v) => v + 1);
  }
  async function save() {
    const project = activeRef.current;
    if (!project || !dirtyRef.current) return;
    if (saving.current) await saving.current;
    const text = contentRef.current,
      path = selectedRef.current;
    saving.current = fetch(fileUrl(project.id, path), {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: text,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Save failed");
        if (
          activeRef.current?.id === project.id &&
          contentRef.current === text &&
          selectedRef.current === path
        ) {
          dirtyRef.current = false;
          setDirty(false);
        }
      })
      .finally(() => {
        saving.current = null;
      });
    await saving.current;
  }
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(
      () => save().catch((e) => setError(friendly(e))),
      750,
    );
    return () => clearTimeout(timer);
  }, [content, dirty]);
  async function selectFile(path: string) {
    try {
      await save();
      const project = activeRef.current!;
      if (!/\.(tex|bib|txt|md)$/i.test(path)) {
        window.open(fileUrl(project.id, path), "_blank");
        return;
      }
      const response = await fetch(fileUrl(project.id, path));
      if (!response.ok) throw new Error("Could not open file");
      const text = await response.text();
      selectedRef.current = path;
      setSelected(path);
      contentRef.current = text;
      setContent(text);
      setDirty(false);
      dirtyRef.current = false;
    } catch (e) {
      setError(friendly(e));
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const project = await api<Project>(
        "/projects",
        json("POST", { name, config: draft }),
      );
      await refresh();
      setShowCreate(false);
      await open(project);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/import", {
        method: "POST",
        body: form,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Import failed");
      const project = (await response.json()) as Project;
      await refresh();
      await open(project);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function compile() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await save();
      const r = await api<Build>(
        `/projects/${active.id}/build`,
        json("POST", {}),
      );
      setResult(r);
      if (r.ok) {
        setHasPdf(true);
        setPdfVersion((v) => v + 1);
      } else setShowLog(true);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function updateConfig() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await save();
      const updated = await api<Project>(
        `/projects/${active.id}`,
        json("PATCH", draft),
      );
      setActive(updated);
      activeRef.current = updated;
      setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
      setShowSettings(false);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !active ||
      !confirm(
        `Delete “${active.name}” and its source files? This cannot be undone.`,
      )
    )
      return;
    try {
      await api(`/projects/${active.id}`, { method: "DELETE" });
      setActive(null);
      activeRef.current = null;
      await refresh();
    } catch (e) {
      setError(friendly(e));
    }
  }
  async function addFile() {
    if (!active) return;
    const path = prompt("New file path (for example sections/discussion.tex)");
    if (!path) return;
    try {
      const response = await fetch(fileUrl(active.id, path), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "% New section\n",
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setFiles(await api<string[]>(`/projects/${active.id}/files`));
      await selectFile(path);
    } catch (e) {
      setError(friendly(e));
    }
  }
  async function uploadAsset(file: File) {
    if (!active) return;
    const path = `figures/${file.name}`;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(
        `/api/projects/${active.id}/upload?path=${encodeURIComponent(path)}`,
        { method: "POST", body: form },
      );
      if (!response.ok)
        throw new Error((await response.json()).error || "Upload failed");
      setFiles(await api<string[]>(`/projects/${active.id}/files`));
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  const configFields = (value: Config, onChange: (v: Config) => void) => (
    <div className="config-grid">
      <label>
        Poster title
        <input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        Subtitle
        <input
          value={value.subtitle}
          onChange={(e) => onChange({ ...value, subtitle: e.target.value })}
        />
      </label>
      <label>
        Authors
        <input
          value={value.authors}
          onChange={(e) => onChange({ ...value, authors: e.target.value })}
        />
      </label>
      <label>
        Affiliation
        <input
          value={value.affiliation}
          onChange={(e) => onChange({ ...value, affiliation: e.target.value })}
        />
      </label>
      <label>
        Paper size
        <select
          value={value.size}
          onChange={(e) =>
            onChange({ ...value, size: e.target.value as Config["size"] })
          }
        >
          <option>A1</option>
          <option>A0</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>
        Orientation
        <select
          value={value.orientation}
          onChange={(e) =>
            onChange({
              ...value,
              orientation: e.target.value as Config["orientation"],
            })
          }
        >
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      {value.size === "custom" && (
        <>
          <label>
            Width (mm)
            <input
              type="number"
              min="200"
              max="3000"
              value={value.widthMm || ""}
              onChange={(e) =>
                onChange({ ...value, widthMm: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Height (mm)
            <input
              type="number"
              min="200"
              max="3000"
              value={value.heightMm || ""}
              onChange={(e) =>
                onChange({ ...value, heightMm: Number(e.target.value) })
              }
            />
          </label>
        </>
      )}
      <label>
        Contact
        <input
          value={value.contact}
          onChange={(e) => onChange({ ...value, contact: e.target.value })}
        />
      </label>
      <label>
        Paper or project URL
        <input
          value={value.paperUrl}
          onChange={(e) => onChange({ ...value, paperUrl: e.target.value })}
        />
      </label>
    </div>
  );
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            <strong>Overposter</strong>
            <small>RESEARCH POSTER STUDIO</small>
          </div>
        </div>
        <div className="top-actions">
          {active && (
            <button
              className="text-button"
              onClick={() => {
                save().catch((e) => setError(friendly(e)));
                setActive(null);
                activeRef.current = null;
                refresh();
              }}
            >
              <ArrowLeft size={17} />
              Projects
            </button>
          )}
          <IconButton
            title={dark ? "Light theme" : "Dark theme"}
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
        </div>
      </header>
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!active ? (
        <main className="dashboard">
          <div className="hero">
            <div>
              <p className="eyebrow">FROM RESEARCH TO THE WALL</p>
              <h1>
                Make the work
                <br />
                <em>impossible to miss.</em>
              </h1>
              <p>
                Design, write, and compile publication-ready research posters in
                one local workspace.
              </p>
              <div className="hero-actions">
                <button
                  className="primary"
                  onClick={() => {
                    setDraft(defaultConfig);
                    setName("New research poster");
                    setShowCreate(true);
                  }}
                >
                  <Plus size={18} />
                  New poster
                </button>
                <button
                  className="secondary"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={18} />
                  Import ZIP
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div className="hero-art">
              <div className="art-page">
                <div className="art-head" />
                <div className="art-title" />
                <div className="art-lines" />
                <div className="art-columns">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
          <section className="projects-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR WORKSPACE</p>
                <h2>Poster projects</h2>
              </div>
              <span>
                {projects.length} project{projects.length === 1 ? "" : "s"}
              </span>
            </div>
            {loading ? (
              <div className="empty">Loading projects…</div>
            ) : projects.length === 0 ? (
              <div className="empty">
                <FolderOpen size={32} />
                <h3>Your first poster starts here.</h3>
                <p>
                  Choose a layout, set the print size, then edit the modular
                  LaTeX source.
                </p>
              </div>
            ) : (
              <div className="project-grid">
                {projects.map((p) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={() => open(p).catch((e) => setError(friendly(e)))}
                  >
                    <div className={"project-thumb " + p.config.theme}>
                      <span />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="project-info">
                      <small>
                        {p.config.size} · {p.config.orientation} ·{" "}
                        {p.config.theme.replaceAll("-", " ")}
                      </small>
                      <h3>{p.name}</h3>
                      <p>
                        Updated {new Date(p.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="files-panel">
            <div className="panel-top">
              <span>SOURCE FILES</span>
              <IconButton title="New file" onClick={addFile}>
                <FilePlus2 size={17} />
              </IconButton>
            </div>
            <div className="file-list">
              {files
                .filter((f) => f !== "poster.json" && f !== "config.tex")
                .map((f) => (
                  <button
                    key={f}
                    className={selected === f ? "selected" : ""}
                    onClick={() => selectFile(f)}
                  >
                    <FileCode2 size={15} />
                    <span>{f}</span>
                  </button>
                ))}
            </div>
            <div className="file-footer">
              <button onClick={() => assetInput.current?.click()}>
                <Upload size={16} />
                Upload figure
              </button>
              <input
                ref={assetInput}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAsset(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => {
                  setDraft(active.config);
                  setShowSettings(true);
                }}
              >
                <Settings2 size={16} />
                Poster settings
              </button>
              <button
                onClick={() =>
                  (location.href = `/api/projects/${active.id}/export`)
                }
              >
                <Download size={16} />
                Export source ZIP
              </button>
              <button className="danger" onClick={remove}>
                <Trash2 size={16} />
                Delete project
              </button>
            </div>
          </aside>
          <section className="work-main">
            <div className="workspace-heading">
              <div>
                <p className="eyebrow">POSTER WORKSPACE</p>
                <h2>{active.name}</h2>
                <span>
                  {active.config.size} · {active.config.orientation} ·{" "}
                  {active.config.theme.replaceAll("-", " ")}
                </span>
              </div>
              <div className="workspace-actions">
                <span className={"save-state " + (dirty ? "unsaved" : "")}>
                  {dirty ? "Unsaved changes" : "Saved"}
                </span>
                <button
                  className="secondary"
                  onClick={() => {
                    setDraft(active.config);
                    setShowSettings(true);
                  }}
                >
                  <Settings2 size={17} />
                  Configure
                </button>
                <button className="primary" disabled={busy} onClick={compile}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Play size={17} />
                  )}{" "}
                  {busy ? "Compiling…" : "Compile poster"}
                </button>
              </div>
            </div>
            <div className="work-split">
              <div className="editor-pane">
                <div className="pane-heading">
                  <span>
                    <FileCode2 size={16} />
                    {selected}
                  </span>
                  <button onClick={() => setShowLog((v) => !v)}>
                    Build log <ChevronDown size={14} />
                  </button>
                </div>
                <CodeMirror
                  value={content}
                  height="100%"
                  theme={dark ? "dark" : "light"}
                  editable={!busy}
                  onChange={(value) => {
                    if (value === contentRef.current) return;
                    contentRef.current = value;
                    setContent(value);
                    dirtyRef.current = true;
                    setDirty(true);
                  }}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
                <div className="editor-status">
                  LaTeX source · edits save automatically
                </div>
              </div>
              <PdfPreview
                url={hasPdf ? pdfUrl(active.id) : null}
                version={pdfVersion}
              />
            </div>
            {result && (
              <div
                className={
                  "build-summary " + (result.ok ? "success" : "failure")
                }
              >
                <strong>{result.ok ? "Build complete" : "Build failed"}</strong>
                <span>
                  {(result.durationMs / 1000).toFixed(1)}s
                  {result.report &&
                    ` · ${result.report.widthMm} × ${result.report.heightMm} mm · ${result.report.pageCount} page`}
                </span>
                {result.report?.issues.map((i, n) => (
                  <span key={n} className="issue">
                    {i.level}: {i.message}
                  </span>
                ))}
                <button onClick={() => setShowLog(true)}>View log</button>
              </div>
            )}
            {showLog && (
              <div className="log-panel">
                <div>
                  <strong>Compiler log</strong>
                  <button onClick={() => setShowLog(false)}>
                    <X size={16} />
                  </button>
                </div>
                <pre>{result?.log || "Compile the poster to see its log."}</pre>
              </div>
            )}
          </section>
        </main>
      )}
      {showCreate && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="modal create-modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">NEW PROJECT</p>
                <h2>Start a poster</h2>
              </div>
              <IconButton title="Close" onClick={() => setShowCreate(false)}>
                <X size={19} />
              </IconButton>
            </div>
            <label className="project-name">
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <h3>Choose a layout</h3>
            <div className="template-list">
              {templates.map((t) => (
                <button
                  className={draft.theme === t.id ? "active" : ""}
                  key={t.id}
                  onClick={() => setDraft({ ...draft, theme: t.id })}
                >
                  <span className={"template-swatch " + t.swatch} />
                  <span>
                    <strong>{t.name}</strong>
                    <small>{t.description}</small>
                  </span>
                </button>
              ))}
            </div>
            {configFields(draft, setDraft)}
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={create}>
                Create project
              </button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">PRINT SETUP</p>
                <h2>Poster settings</h2>
              </div>
              <IconButton title="Close" onClick={() => setShowSettings(false)}>
                <X size={19} />
              </IconButton>
            </div>
            <p className="hint">
              Changes to size or title apply to the next compilation.
            </p>
            {configFields(draft, setDraft)}
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={updateConfig}
              >
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
