import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileCode2,
  FilePlus2,
  FolderOpen,
  History,
  LoaderCircle,
  Moon,
  Play,
  Plus,
  Settings2,
  Users,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import PdfPreview from "./PdfPreview";
import PosterForm, { blankAuthor, blankAffiliation } from "./PosterForm";
import VersionHistory from "./VersionHistory";
import SharedEditor, { type SharedHandle, type SharedState } from "./SharedEditor";
import SharePanel from "./SharePanel";
import {
  api,
  fileUrl,
  json,
  pdfUrl,
  type Build,
  type Config,
  type Project,
} from "./api";

const defaultConfig: Config = {
  formatVersion: 2,
  title: "Untitled research poster",
  subtitle: "",
  authors: [],
  affiliations: [],
  contact: "",
  paperUrl: "",
  size: "A1",
  orientation: "landscape",
  theme: "modern-ml",
  columns: 2,
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
    [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "error" | "conflict">("clean"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Build | null>(null),
    [pdfVersion, setPdfVersion] = useState(0),
    [hasPdf, setHasPdf] = useState(false),
    [showCreate, setShowCreate] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showLog, setShowLog] = useState(false),
    [showVersions, setShowVersions] = useState(false),
    [showShare, setShowShare] = useState(false),
    [session, setSession] = useState<{ mode: string; subject: string } | null>(null),
    [projectRole, setProjectRole] = useState<"owner" | "editor" | "viewer">("owner"),
    [sharedState, setSharedState] = useState<SharedState>("connecting"),
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
    etagRef = useRef<string | null>(null),
    requestId = useRef(0),
    fileInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null);
  const sharedHandle = useRef<SharedHandle | null>(null);
  const setSharedHandle = useCallback((handle: SharedHandle | null) => { sharedHandle.current = handle; }, []);
  const updateSharedState = useCallback((state: SharedState) => { setSharedState(state); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("overposter-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    Promise.all([api<{ mode: string; subject: string }>("/session"), api<Project[]>("/projects")])
      .then(([currentSession, currentProjects]) => { setSession(currentSession); setProjects(currentProjects); })
      .catch((e) => setError(friendly(e)))
      .finally(() => setLoading(false));
  }, []);
  async function refresh() {
    setProjects(await api<Project[]>("/projects"));
  }
  async function open(project: Project) {
    await save();
    const request = ++requestId.current;
    setError("");
    const [list, response, role] = await Promise.all([
      api<string[]>(`/projects/${project.id}/files`),
      fetch(fileUrl(project.id, "poster.tex")),
      session?.mode === "test-hosted" ? api<{ role: "owner" | "editor" | "viewer" }>(`/projects/${project.id}/role`) : Promise.resolve({ role: "owner" as const }),
    ]);
    if (!response.ok) throw new Error("Could not open poster source");
    const text = await response.text();
    if (request !== requestId.current) return;
    setActive(project);
    setProjectRole(role.role);
    activeRef.current = project;
    setResult(null);
    setSelected("poster.tex");
    selectedRef.current = "poster.tex";
    setDirty(false);
    dirtyRef.current = false;
    setSaveState("clean");
    etagRef.current = response.headers.get("ETag");
    setFiles(list);
    const recovered = session?.mode === "test-hosted" ? null : localStorage.getItem(`overposter-draft:${project.id}:poster.tex`);
    const restore = recovered !== null && recovered !== text && confirm("A locally saved draft is available for this poster. Restore it?");
    setContent(restore ? recovered! : text);
    contentRef.current = restore ? recovered! : text;
    if (restore) {
      dirtyRef.current = true;
      setDirty(true);
      setSaveState("dirty");
    }
    const head = await fetch(pdfUrl(project.id), { method: "HEAD" });
    if (request !== requestId.current) return;
    setHasPdf(head.ok);
    setPdfVersion((v) => v + 1);
  }
  async function save() {
    if (session?.mode === "test-hosted") {
      if (activeRef.current) {
        if (!sharedHandle.current) throw new Error("Shared editor is still opening. Try again in a moment.");
        await sharedHandle.current.flush();
      }
      return;
    }
    const project = activeRef.current;
    if (!project) return;
    while (dirtyRef.current || saving.current) {
      if (saving.current) {
        await saving.current;
        continue;
      }
      const text = contentRef.current,
        path = selectedRef.current,
        expected = etagRef.current;
      setSaveState("saving");
      saving.current = fetch(fileUrl(project.id, path), {
      method: "PUT",
      headers: { "Content-Type": "text/plain", ...(expected ? { "If-Match": expected } : {}) },
      body: text,
    })
      .then(async (r) => {
        const result = await r.json();
        if (result.conflict) {
          setSaveState("conflict");
          throw new Error("This file changed elsewhere. Your draft is preserved; copy it before resolving the conflict.");
        }
        if (!r.ok) throw new Error(result.error || "Save failed");
        etagRef.current = result.etag;
        if (
          activeRef.current?.id === project.id &&
          contentRef.current === text &&
          selectedRef.current === path
        ) {
          dirtyRef.current = false;
          setDirty(false);
          setSaveState("clean");
          localStorage.removeItem(`overposter-draft:${project.id}:${path}`);
        }
      })
      .catch((e) => {
        if (!(e instanceof Error && e.message.startsWith("This file changed elsewhere"))) setSaveState("error");
        throw e;
      })
      .finally(() => {
        saving.current = null;
      });
      await saving.current;
    }
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || saving.current || (session?.mode === "test-hosted" && sharedState === "saving")) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session?.mode, sharedState]);
  useEffect(() => {
    if (session?.mode === "test-hosted") return;
    if (!dirty) return;
    const timer = setTimeout(
      () => save().catch((e) => setError(friendly(e))),
      750,
    );
    return () => clearTimeout(timer);
  }, [content, dirty, session?.mode]);
  async function selectFile(path: string) {
    try {
      await save();
      const request = ++requestId.current;
      const project = activeRef.current!;
      if (!/\.(tex|bib|txt|md)$/i.test(path)) {
        window.open(fileUrl(project.id, path), "_blank");
        return;
      }
      const response = await fetch(fileUrl(project.id, path));
      if (!response.ok) throw new Error("Could not open file");
      const text = await response.text();
      if (request !== requestId.current || project.id !== activeRef.current?.id) return;
      etagRef.current = response.headers.get("ETag");
      selectedRef.current = path;
      setSelected(path);
    const recovered = session?.mode === "test-hosted" ? null : localStorage.getItem(`overposter-draft:${project.id}:${path}`);
      const restore = recovered !== null && recovered !== text && confirm("A locally saved draft is available for this file. Restore it?");
      contentRef.current = restore ? recovered! : text;
      setContent(restore ? recovered! : text);
      setDirty(restore);
      dirtyRef.current = restore;
      setSaveState(restore ? "dirty" : "clean");
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
      if (active.imported && !active.trusted) {
        if (!confirm("Imported LaTeX can read local files. Review the source first. Trust this project for local compilation?")) return;
        const approved = await api<Project>(`/projects/${active.id}/trust`, json("POST", {}));
        setActive(approved);
        activeRef.current = approved;
      }
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
      await save();
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
      await save();
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
                save().then(() => {
                  ++requestId.current;
                  setActive(null);
                  activeRef.current = null;
                  refresh();
                }).catch((e) => setError(friendly(e)));
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
                    setDraft({ ...defaultConfig, authors: [blankAuthor()], affiliations: [blankAffiliation()] });
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
              {(session?.mode !== "test-hosted" || projectRole !== "viewer") && <IconButton title="New file" onClick={addFile}>
                <FilePlus2 size={17} />
              </IconButton>}
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
              {(session?.mode !== "test-hosted" || projectRole !== "viewer") && <button onClick={() => assetInput.current?.click()}>
                <Upload size={16} />
                Upload figure
              </button>}
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
              {(session?.mode !== "test-hosted" || projectRole !== "viewer") && <button
                onClick={() => {
                  setDraft(active.config);
                  setShowSettings(true);
                }}
              >
                <Settings2 size={16} />
                Poster settings
              </button>}
              <button onClick={() => setShowVersions(true)}><History size={16} />Version history</button>
              {session?.mode === "test-hosted" && projectRole === "owner" && <button onClick={() => setShowShare(true)}><Users size={16} />Share project</button>}
              <button onClick={() => save().then(() => { location.href = `/api/projects/${active.id}/export`; }).catch((e) => setError(friendly(e)))}>
                <Download size={16} />
                Export source ZIP
              </button>
              {(session?.mode !== "test-hosted" || projectRole === "owner") && <button className="danger" onClick={remove}>
                <Trash2 size={16} />
                Delete project
              </button>}
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
                  {session?.mode === "test-hosted" ? sharedState === "saved" ? "Shared changes saved" : sharedState === "saving" ? "Saving shared changes…" : sharedState === "offline" ? "Disconnected — reconnecting" : sharedState === "denied" ? "Access changed — reopen project" : "Connecting to shared source…" : saveState === "clean" ? "Saved" : saveState === "dirty" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Save conflict — draft preserved" : "Save failed — retry"}
                </span>
                {(saveState === "error" || saveState === "conflict") && <button className="secondary" onClick={() => save().catch((e) => setError(friendly(e)))}>Retry save</button>}
                {(session?.mode !== "test-hosted" || projectRole !== "viewer") && <button
                  className="secondary"
                  onClick={() => {
                    setDraft(active.config);
                    setShowSettings(true);
                  }}
                >
                  <Settings2 size={17} />
                  Configure
                </button>}
                {(session?.mode !== "test-hosted" || projectRole !== "viewer") && <button className="primary" disabled={busy} onClick={compile}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Play size={17} />
                  )}{" "}
                  {busy ? "Compiling…" : "Compile poster"}
                </button>}
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
                {session?.mode === "test-hosted" ? <SharedEditor key={`${active.id}:${selected}`} projectId={active.id} path={selected} subject={session.subject} readOnly={projectRole === "viewer"} dark={dark} onState={updateSharedState} onHandle={setSharedHandle} /> : <><CodeMirror
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
                    setSaveState("dirty");
                    if (activeRef.current) localStorage.setItem(`overposter-draft:${activeRef.current.id}:${selectedRef.current}`, value);
                  }}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
                <div className="editor-status">
                  LaTeX source · edits save automatically
                </div>
                </>}
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
      {showCreate && <PosterForm mode="create" value={draft} onChange={setDraft} name={name} onNameChange={setName} busy={busy} onSubmit={create} onClose={() => setShowCreate(false)} />}
      {showSettings && <PosterForm mode="settings" value={draft} onChange={setDraft} busy={busy} onSubmit={updateConfig} onClose={() => setShowSettings(false)} />}
      {showVersions && active && <VersionHistory projectId={active.id} readOnly={session?.mode === "test-hosted" && projectRole === "viewer"} onClose={() => setShowVersions(false)} onBeforeAction={save} onRestored={async () => { const current = await api<Project>(`/projects/${active.id}`); setShowVersions(false); await open(current); }} />}
      {showShare && active && <SharePanel projectId={active.id} onClose={() => setShowShare(false)} />}
    </div>
  );
}
