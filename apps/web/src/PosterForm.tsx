import { useEffect, useRef, useState } from "react";
import type { Affiliation, Author, Config } from "./api";

const steps = ["Basics", "Authors", "Affiliations", "Assignments", "Review"] as const;
const themes = [
  { id: "academic-classic", name: "Academic Classic", detail: "Dense research and readable references", swatch: "classic" },
  { id: "modern-ml", name: "Modern ML", detail: "Methods, charts, and a clear main finding", swatch: "modern" },
  { id: "visual-results", name: "Visual Results", detail: "A figure-led narrative with large evidence", swatch: "visual" },
] as const;
const newId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
};
export const blankAuthor = (): Author => ({ id: newId(), name: "", email: "", orcid: "", affiliationIds: [], corresponding: false, equalContribution: false });
export const blankAffiliation = (): Affiliation => ({ id: newId(), institution: "", department: "", city: "", country: "", address: "" });
type Props = { mode: "create" | "settings"; value: Config; onChange: (next: Config) => void; name?: string; onNameChange?: (next: string) => void; busy: boolean; onSubmit: () => void; onClose: () => void };

export default function PosterForm({ mode, value, onChange, name = "", onNameChange, busy, onSubmit, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const updateAuthor = (id: string, changes: Partial<Author>) => onChange({ ...value, authors: value.authors.map((a) => a.id === id ? { ...a, ...changes } : a) });
  const updateAffiliation = (id: string, changes: Partial<Affiliation>) => onChange({ ...value, affiliations: value.affiliations.map((a) => a.id === id ? { ...a, ...changes } : a) });
  function resizeAuthors(count: number) {
    if (count < 1 || count > 50) return;
    if (count < value.authors.length && value.authors.slice(count).some((a) => a.name || a.email || a.orcid) && !confirm("Remove the last populated author card?")) return;
    onChange({ ...value, authors: count > value.authors.length ? [...value.authors, ...Array.from({ length: count - value.authors.length }, blankAuthor)] : value.authors.slice(0, count) });
  }
  function resizeAffiliations(count: number) {
    if (count < 1 || count > 30) return;
    const removed = value.affiliations.slice(count);
    if (removed.some((a) => a.institution || value.authors.some((author) => author.affiliationIds.includes(a.id))) && !confirm("Remove these affiliations and their author assignments?")) return;
    const ids = new Set(removed.map((a) => a.id));
    onChange({ ...value, affiliations: count > value.affiliations.length ? [...value.affiliations, ...Array.from({ length: count - value.affiliations.length }, blankAffiliation)] : value.affiliations.slice(0, count), authors: value.authors.map((a) => ({ ...a, affiliationIds: a.affiliationIds.filter((id) => !ids.has(id)) })) });
  }
  function move<T>(items: T[], index: number, offset: number): T[] {
    const next = [...items]; const other = index + offset;
    if (other < 0 || other >= next.length) return next;
    [next[index], next[other]] = [next[other], next[index]];
    return next;
  }
  function validate(index: number): string {
    if (index === 0) {
      if (mode === "create" && !name.trim()) return "Enter a project name.";
      if (!value.title.trim()) return "Enter a poster title.";
      if (value.size === "custom" && (!value.widthMm || !value.heightMm)) return "Enter both custom dimensions.";
      if (value.paperUrl && !/^https:\/\/\S+$/i.test(value.paperUrl) && !/^10\.\d{4,9}\/\S+$/i.test(value.paperUrl)) return "Use an HTTPS URL or DOI.";
    }
    if (index === 1) {
      if (!value.authors.length || value.authors.some((a) => !a.name.trim())) return "Enter a name for every author.";
      if (value.authors.some((a) => a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email))) return "Correct the author email address.";
    }
    if (index === 2 && (!value.affiliations.length || value.affiliations.some((a) => !a.institution.trim()))) return "Enter an institution for every affiliation.";
    if (index === 3 && value.authors.some((a) => !a.affiliationIds.length)) return "Assign each author at least one affiliation.";
    return "";
  }
  function next() {
    const issue = step === 4 ? [0, 1, 2, 3].map(validate).find(Boolean) || "" : validate(step); setMessage(issue);
    if (!issue) { if (step === 4) onSubmit(); else setStep(step + 1); }
  }
  const authorPreview = value.authors.map((a) => {
    const numbers = a.affiliationIds.map((id) => value.affiliations.findIndex((item) => item.id === id) + 1).filter((n) => n > 0);
    return (a.name || "Author name") + (numbers.length ? " " + numbers.join(",") : "") + (a.corresponding ? "*" : "") + (a.equalContribution ? "†" : "");
  }).join(" · ");
  return <div className="modal-backdrop"><div className="modal create-modal poster-form" role="dialog" aria-modal="true" aria-labelledby="poster-form-title">
    <div className="modal-head"><div><p className="eyebrow">{mode === "create" ? "NEW PROJECT" : "POSTER SETTINGS"}</p><h2 id="poster-form-title" tabIndex={-1} ref={heading}>{mode === "create" ? "Start a poster" : "Edit poster settings"}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <nav className="form-steps" aria-label="Poster setup">{steps.map((item, index) => <button key={item} className={step === index ? "active" : ""} onClick={() => { const issue = index > step ? Array.from({ length: index }, (_, i) => validate(i)).find(Boolean) || "" : ""; setMessage(issue); if (!issue) setStep(index); }} aria-current={step === index ? "step" : undefined}>{index + 1}. {item}</button>)}</nav>
    {step === 0 && <div className="form-section">
      {mode === "create" && <label>Project name<input value={name} onChange={(e) => onNameChange?.(e.target.value)} required /></label>}
      <label>Scientific title<input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} required /></label>
      <label>Subtitle (optional)<input value={value.subtitle} onChange={(e) => onChange({ ...value, subtitle: e.target.value })} /></label>
      <label>Paper URL or DOI (optional)<input value={value.paperUrl} onChange={(e) => onChange({ ...value, paperUrl: e.target.value })} /></label>
      {mode === "create" && <><h3>Choose a layout</h3><div className="template-list">{themes.map((theme) => <button key={theme.id} className={value.theme === theme.id ? "active" : ""} onClick={() => onChange({ ...value, theme: theme.id, columns: theme.id === "modern-ml" ? 2 : 3 })}><img className="template-preview" src={"/template-previews/" + theme.id + ".png"} alt={theme.name + " illustrative poster preview"} /><span><strong>{theme.name}</strong><small>{theme.detail}</small></span></button>)}</div></>}
      <div className="config-grid"><label>Paper size<select value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value as Config["size"] })}><option>A1</option><option>A0</option><option value="custom">Custom</option></select></label>
      <label>Orientation<select value={value.orientation} onChange={(e) => onChange({ ...value, orientation: e.target.value as Config["orientation"] })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
      {value.size === "custom" && <><label>Width (mm)<input type="number" min="200" max="3000" value={value.widthMm || ""} onChange={(e) => onChange({ ...value, widthMm: Number(e.target.value) })} /></label><label>Height (mm)<input type="number" min="200" max="3000" value={value.heightMm || ""} onChange={(e) => onChange({ ...value, heightMm: Number(e.target.value) })} /></label></>}
      <label>Columns<select value={value.columns} onChange={(e) => onChange({ ...value, columns: Number(e.target.value) as Config["columns"] })}><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
      <label>Font scale <span>{Math.round(value.fontScale * 100)}%</span><input type="range" min="0.8" max="1.25" step="0.05" value={value.fontScale} onChange={(e) => onChange({ ...value, fontScale: Number(e.target.value) })} /></label></div>
    </div>}
    {step === 1 && <div className="form-section"><label>How many authors?<input type="number" min="1" max="50" value={value.authors.length} onChange={(e) => resizeAuthors(Number(e.target.value))} /></label>
      {value.authors.map((a, i) => <fieldset className="form-card" key={a.id}><legend>Author {i + 1}</legend><div className="card-actions"><button onClick={() => onChange({ ...value, authors: move(value.authors, i, -1) })} disabled={i === 0}>Move up</button><button onClick={() => onChange({ ...value, authors: move(value.authors, i, 1) })} disabled={i === value.authors.length - 1}>Move down</button></div>
        <div className="config-grid"><label>Full display name<input value={a.name} onChange={(e) => updateAuthor(a.id, { name: e.target.value })} required /></label><label>Email (optional)<input type="email" value={a.email} onChange={(e) => updateAuthor(a.id, { email: e.target.value })} /></label><label>ORCID (optional)<input value={a.orcid} onChange={(e) => updateAuthor(a.id, { orcid: e.target.value })} /></label></div>
        <label className="check"><input type="checkbox" checked={a.corresponding} onChange={(e) => updateAuthor(a.id, { corresponding: e.target.checked })} /> Corresponding author (*)</label><label className="check"><input type="checkbox" checked={a.equalContribution} onChange={(e) => updateAuthor(a.id, { equalContribution: e.target.checked })} /> Equal contribution (†)</label>
      </fieldset>)}</div>}
    {step === 2 && <div className="form-section"><label>How many affiliations?<input type="number" min="1" max="30" value={value.affiliations.length} onChange={(e) => resizeAffiliations(Number(e.target.value))} /></label>
      {value.affiliations.map((a, i) => <fieldset className="form-card" key={a.id}><legend>Affiliation {i + 1}</legend><div className="card-actions"><button onClick={() => onChange({ ...value, affiliations: move(value.affiliations, i, -1) })} disabled={i === 0}>Move up</button><button onClick={() => onChange({ ...value, affiliations: move(value.affiliations, i, 1) })} disabled={i === value.affiliations.length - 1}>Move down</button></div><div className="config-grid"><label>Institution<input value={a.institution} onChange={(e) => updateAffiliation(a.id, { institution: e.target.value })} required /></label><label>Department or lab<input value={a.department} onChange={(e) => updateAffiliation(a.id, { department: e.target.value })} /></label><label>City<input value={a.city} onChange={(e) => updateAffiliation(a.id, { city: e.target.value })} /></label><label>Country<input value={a.country} onChange={(e) => updateAffiliation(a.id, { country: e.target.value })} /></label><label>Address<input value={a.address} onChange={(e) => updateAffiliation(a.id, { address: e.target.value })} /></label></div></fieldset>)}</div>}
    {step === 3 && <div className="form-section"><p className="hint">Authors can share institutions or have several. Numbers follow the affiliation order.</p>{value.authors.map((a) => <fieldset className="form-card" key={a.id}><legend>{a.name || "Unnamed author"}</legend>{value.affiliations.map((affiliation, i) => <label className="check" key={affiliation.id}><input type="checkbox" checked={a.affiliationIds.includes(affiliation.id)} onChange={(e) => updateAuthor(a.id, { affiliationIds: e.target.checked ? [...a.affiliationIds, affiliation.id] : a.affiliationIds.filter((id) => id !== affiliation.id) })} /> {i + 1}. {affiliation.institution || "Unnamed institution"}</label>)}</fieldset>)}</div>}
    {step === 4 && <div className="form-section review-header"><p className="eyebrow">{value.size} · {value.orientation} · {value.columns} columns · {Math.round(value.fontScale * 100)}% type</p><h3>{value.title}</h3><p>{value.subtitle}</p><strong>{authorPreview}</strong>{value.affiliations.map((a, i) => <p key={a.id}><sup>{i + 1}</sup> {[a.department, a.institution, a.city, a.country].filter(Boolean).join(", ")}</p>)}{value.authors.filter((a) => a.email).map((a) => <p key={a.id}>{a.name}: {a.email}</p>)}{value.paperUrl && <p>Paper: {value.paperUrl}</p>}</div>}
    {message && <p className="form-error" role="alert">{message}</p>}
    <div className="modal-actions"><button className="secondary" onClick={step ? () => { setMessage(""); setStep(step - 1); } : onClose}>{step ? "Back" : "Cancel"}</button><button className="primary" disabled={busy} onClick={next}>{step === 4 ? (mode === "create" ? "Create project" : "Save settings") : "Continue"}</button></div>
  </div></div>;
}
