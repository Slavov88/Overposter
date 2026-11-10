import { useEffect, useState } from "react";
import { api, json } from "./api";

type Link = { projectId: string; url: string; linkedAt: string; linkedBy: string };
type State = { link: Link | null; version: string | null };

export default function OverrootLinkPanel({ projectId, canEdit, onClose }: { projectId: string; canEdit: boolean; onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}/overroot-link`;
  const load = async () => {
    const current = await api<State>(base);
    setState(current);
    setIdentifier(current.link?.projectId || "");
    setUrl(current.link?.url || "");
  };
  useEffect(() => { load().catch(() => setError("Could not load project link")); }, [projectId]);
  async function save() {
    if (!state) return;
    setBusy(true); setError("");
    try { await api<State>(base, json("PUT", { projectId: identifier.trim(), url: url.trim(), expectedVersion: state.version })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save project link"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!state?.link || !confirm("Remove this manual project link? Source and memberships will not change.")) return;
    setBusy(true); setError("");
    try { await api<State>(base, json("DELETE", { expectedVersion: state.version })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove project link"); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="share-panel" role="dialog" aria-modal="true" aria-label="Overroot project link" onClick={(event) => event.stopPropagation()}>
      <div className="share-heading"><div><p className="eyebrow">MANUAL HANDOFF</p><h2>Overroot project link</h2></div><button onClick={onClose} aria-label="Close project link">×</button></div>
      <p>This is a reference to a separate project. Opening it requires your own Overroot access. Source and memberships are never synchronized by this link.</p>
      {state?.link && <div className="linked-project"><strong>Linked project: {state.link.projectId}</strong><a href={state.link.url} target="_blank" rel="noopener noreferrer">Open in Overroot</a><small>Added by {state.link.linkedBy} on {new Date(state.link.linkedAt).toLocaleString()}. This reference is user supplied and has not been verified against Overroot.</small></div>}
      {!state && !error && <p>Loading link...</p>}
      {canEdit && state && <div className="link-form"><label>Stable Overroot project ID<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Project ID" /></label><label>Overroot project URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://overroot.toni.foo/..." /></label><div className="link-actions"><button className="primary" disabled={busy || !identifier.trim() || !url.trim()} onClick={save}>{state.link ? "Update link" : "Save link"}</button>{state.link && <button className="secondary" disabled={busy} onClick={remove}>Remove link</button>}</div></div>}
      {error && <div className="share-error" role="alert">{error}<button onClick={() => load().then(() => setError("")).catch(() => {})}>Reload link</button></div>}
    </section>
  </div>;
}
