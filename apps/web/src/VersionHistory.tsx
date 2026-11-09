import { useEffect, useState } from "react";
import { api, json } from "./api";
type Version = { id: string; author: string; timestamp: string; message: string; files: string[] };
type History = { head: string | null; versions: Version[] };
export default function VersionHistory({ projectId, onClose, onBeforeAction, onRestored }: {
  projectId: string; onClose: () => void; onBeforeAction: () => Promise<void>; onRestored: () => Promise<void>;
}) {
  const [history, setHistory] = useState<History>({ head: null, versions: [] });
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Version | null>(null);
  const [preview, setPreview] = useState("");
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = "/projects/" + projectId + "/versions";
  async function refresh() { setHistory(await api<History>(base)); }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [projectId]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Version operation failed"); }
    finally { setBusy(false); }
  }
  function show(version: Version) {
    setSelected(version); setPreview(""); setDiff("");
    run(async () => { setDiff((await api<{ diff: string }>(base + "/" + version.id + "/diff")).diff); });
  }
  return <div className="modal-backdrop"><div className="modal history-modal" role="dialog" aria-modal="true" aria-label="Version history">
    <div className="modal-head"><div><p className="eyebrow">SOURCE HISTORY</p><h2>Version history</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <p className="hint">Checkpoints preserve source and settings. Restoring creates a new version and keeps earlier history.</p>
    <div className="history-create"><label>Checkpoint name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Before layout change" /></label><button className="primary" disabled={busy || !name.trim()} onClick={() => run(async () => { await onBeforeAction(); await api(base, json("POST", { message: name })); setName(""); await refresh(); })}>Create checkpoint</button></div>
    <div className="history-list">{history.versions.map((version) => <button key={version.id} className={selected?.id === version.id ? "active" : ""} onClick={() => show(version)}><strong>{version.message}</strong><span>{version.id.slice(0, 10)} · {new Date(version.timestamp).toLocaleString()} · {version.author}</span><small>{version.files.join(", ") || "No source changes"}</small></button>)}</div>
    {!history.versions.length && <p className="hint">No checkpoints yet.</p>}
    {selected && <section className="history-detail"><h3>{selected.message}</h3><div className="history-files">{selected.files.filter((f) => /\.(tex|bib|txt|md|json)$/i.test(f)).map((path) => <button key={path} onClick={() => run(async () => { setPreview((await api<{ content: string }>(base + "/" + selected.id + "/file?path=" + encodeURIComponent(path))).content); })}>{path}</button>)}</div>
      <h3>{preview ? "File at this version" : "Changes from this version to current source"}</h3><pre>{preview || diff || "No text changes"}</pre>
      <button className="secondary" disabled={busy || !history.head || selected.id === history.head} onClick={() => {
        if (!confirm("Restore this version? A new checkpoint will record the restore and retain all prior versions.")) return;
        run(async () => { await onBeforeAction(); await api(base + "/" + selected.id + "/restore", json("POST", { expectedHead: history.head })); await onRestored(); });
      }}>Restore this version</button>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button></div>
  </div></div>;
}
