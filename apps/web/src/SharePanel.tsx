import { useEffect, useState } from "react";
import { api, json } from "./api";

type Members = { owner: string; members: Record<string, "editor" | "viewer"> };

export default function SharePanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Members | null>(null);
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => api<Members>(`/projects/${projectId}/members`).then(setMembers);
  useEffect(() => { reload().catch(() => setError("Could not load project access")); }, [projectId]);
  async function add() {
    setBusy(true); setError("");
    try {
      const exact = subject.trim();
      if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(exact)) throw new Error("Enter an exact approved account ID");
      await api(`/projects/${projectId}/members/${encodeURIComponent(exact)}`, json("PUT", { role }));
      setSubject("");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update access"); }
    finally { setBusy(false); }
  }
  async function remove(subjectId: string) {
    setBusy(true); setError("");
    try {
      await api(`/projects/${projectId}/members/${encodeURIComponent(subjectId)}`, { method: "DELETE" });
      await reload();
    } catch { setError("Could not remove access"); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="share-panel" role="dialog" aria-modal="true" aria-label="Share project" onClick={(event) => event.stopPropagation()}>
      <div className="share-heading"><div><p className="eyebrow">PROJECT ACCESS</p><h2>Share project</h2></div><button onClick={onClose} aria-label="Close sharing">×</button></div>
      <p>Enter an exact test account ID. Access applies only to this poster.</p>
      {members ? <ul className="member-list">
        <li><strong>{members.owner}</strong><span>Owner</span></li>
        {Object.entries(members.members).map(([id, memberRole]) => <li key={id}><strong>{id}</strong><span>{memberRole}</span><button disabled={busy} onClick={() => remove(id)} aria-label={`Remove ${id}`}>Remove</button></li>)}
      </ul> : <p>Loading members…</p>}
      <div className="share-form"><label>Account ID<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Exact account ID" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button className="primary" disabled={busy || !subject.trim()} onClick={add}>Add person</button></div>
      {error && <p className="share-error" role="alert">{error}</p>}
    </section>
  </div>;
}
