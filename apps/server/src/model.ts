import { createHash } from "node:crypto";
import { z } from "zod";

export const templateIds = ["academic-classic", "modern-ml", "visual-results"] as const;
const uuid = z.string().uuid();
const optionalText = (limit: number) => z.string().trim().max(limit).default("");
const affiliationSchema = z.object({
  id: uuid,
  institution: z.string().trim().min(1).max(180),
  department: optionalText(180),
  city: optionalText(120),
  country: optionalText(120),
  address: optionalText(240),
});
const orcidPattern = /^(?:https:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-[\dX]{4})$/i;
export function normalizeOrcid(value: string): string {
  if (!value.trim()) return "";
  const match = value.trim().match(orcidPattern);
  if (!match) throw new Error("Enter an ORCID as 0000-0000-0000-0000 or its orcid.org URL");
  const id = match[1].toUpperCase();
  const digits = id.replaceAll("-", "");
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  if (digits[15] !== (check === 10 ? "X" : String(check))) throw new Error("ORCID checksum is invalid");
  return id;
}
const authorSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(160),
  email: z.union([z.email(), z.literal("")]).default(""),
  orcid: z.string().default("").transform(normalizeOrcid),
  affiliationIds: z.array(uuid).max(30),
  corresponding: z.boolean().default(false),
  equalContribution: z.boolean().default(false),
});
export type Author = z.infer<typeof authorSchema>;
export type Affiliation = z.infer<typeof affiliationSchema>;
const posterConfigFields = z.object({
  formatVersion: z.literal(2).default(2),
  title: z.string().trim().min(1).max(180),
  subtitle: optionalText(240),
  authors: z.array(authorSchema).max(50).default([]),
  affiliations: z.array(affiliationSchema).max(30).default([]),
  contact: optionalText(200),
  paperUrl: optionalText(500),
  size: z.enum(["A0", "A1", "custom"]).default("A1"),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  widthMm: z.number().min(200).max(3000).optional(),
  heightMm: z.number().min(200).max(3000).optional(),
  theme: z.enum(templateIds).default("modern-ml"),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  fontScale: z.number().min(0.8).max(1.25).refine((v) => Math.abs(v * 20 - Math.round(v * 20)) < 1e-8, "Use 0.05 increments").default(1),
});
export const posterConfigPatchSchema = posterConfigFields.partial();
export const posterConfigSchema = posterConfigFields.superRefine((v, ctx) => {
  if (v.size === "custom" && (!v.widthMm || !v.heightMm))
    ctx.addIssue({ code: "custom", message: "Custom size needs widthMm and heightMm" });
  const ids = new Set<string>();
  for (const affiliation of v.affiliations) {
    if (ids.has(affiliation.id)) ctx.addIssue({ code: "custom", message: "Duplicate affiliation ID" });
    ids.add(affiliation.id);
  }
  const authorIds = new Set<string>();
  for (const author of v.authors) {
    if (authorIds.has(author.id)) ctx.addIssue({ code: "custom", message: "Duplicate author ID" });
    authorIds.add(author.id);
    if (new Set(author.affiliationIds).size !== author.affiliationIds.length)
      ctx.addIssue({ code: "custom", message: `Duplicate affiliation for ${author.name}` });
    if (author.affiliationIds.some((id) => !ids.has(id)))
      ctx.addIssue({ code: "custom", message: `Unknown affiliation for ${author.name}` });
  }
  if (v.paperUrl && !/^https:\/\/[^\s]+$/i.test(v.paperUrl) && !/^10\.\d{4,9}\/\S+$/i.test(v.paperUrl))
    ctx.addIssue({ code: "custom", message: "Paper link must be an HTTPS URL or DOI" });
});
export type PosterConfig = z.infer<typeof posterConfigSchema>;
export const defaults: PosterConfig = {
  formatVersion: 2, title: "Untitled research poster", subtitle: "", authors: [], affiliations: [],
  contact: "", paperUrl: "", size: "A1", orientation: "landscape", theme: "modern-ml", columns: 2, fontScale: 1,
};
function legacyUuid(label: string): string {
  const h = createHash("sha256").update(`overposter-legacy:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function parsePosterConfig(input: unknown): PosterConfig {
  const source = input as Record<string, unknown>;
  if (!source || typeof source !== "object") throw new Error("Invalid poster configuration");
  if (Array.isArray(source.authors)) return posterConfigSchema.parse(source);
  const oldAuthor = typeof source.authors === "string" ? source.authors.trim() : "";
  const oldAffiliation = typeof source.affiliation === "string" ? source.affiliation.trim() : "";
  const oldPaperUrl = typeof source.paperUrl === "string" ? source.paperUrl.trim() : "";
  const normalizedPaperUrl = /^https:\/\//i.test(oldPaperUrl) || /^10\.\d{4,9}\//i.test(oldPaperUrl)
    ? oldPaperUrl : /^[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i.test(oldPaperUrl) ? "https://" + oldPaperUrl : "";
  const affiliationId = legacyUuid(`affiliation:${oldAffiliation}`);
  return posterConfigSchema.parse({
    ...source,
    formatVersion: 2,
    paperUrl: normalizedPaperUrl,
    contact: oldPaperUrl && !normalizedPaperUrl ? [typeof source.contact === "string" ? source.contact : "", "Legacy paper link: " + oldPaperUrl].filter(Boolean).join(" · ") : source.contact,
    authors: oldAuthor ? [{ id: legacyUuid(`author:${oldAuthor}`), name: oldAuthor, email: "", orcid: "", affiliationIds: oldAffiliation ? [affiliationId] : [], corresponding: false, equalContribution: false }] : [],
    affiliations: oldAffiliation ? [{ id: affiliationId, institution: oldAffiliation, department: "", city: "", country: "", address: "" }] : [],
  });
}
export function dimensions(config: PosterConfig): { widthMm: number; heightMm: number } {
  if (config.size === "custom") return { widthMm: config.widthMm!, heightMm: config.heightMm! };
  const short = config.size === "A0" ? 841 : 594;
  const long = config.size === "A0" ? 1189 : 841;
  return config.orientation === "landscape" ? { widthMm: long, heightMm: short } : { widthMm: short, heightMm: long };
}
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export function texEscape(s: string): string {
  return s.replace(/[\\{}%$&#_^~]/g, (x) => ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", $: "\\$", "&": "\\&", "#": "\\#", _: "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" })[x]!);
}
export function posterLink(input: string): string {
  return /^10\.\d{4,9}\//i.test(input) ? `https://doi.org/${input}` : input;
}
export function configTex(c: PosterConfig): string {
  const d = dimensions(c);
  const affiliationNumbers = new Map(c.affiliations.map((a, i) => [a.id, i + 1]));
  const authors = c.authors.map((a) => {
    const marks = [...a.affiliationIds.map((id) => affiliationNumbers.get(id)!), ...(a.corresponding ? ["*"] : []), ...(a.equalContribution ? ["†"] : [])];
    return `${texEscape(a.name)}${marks.length ? `\\textsuperscript{${marks.join(",")}}` : ""}`;
  }).join(" \\quad · \\quad ");
  const affiliations = c.affiliations.map((a, i) => `\\textsuperscript{${i + 1}} ${texEscape([a.department, a.institution, a.city, a.country, a.address].filter(Boolean).join(", "))}`).join("\\par ");
  const contacts = c.authors.filter((a) => a.email).map((a) => `${texEscape(a.name)}: \\href{mailto:${a.email}}{${texEscape(a.email)}}`).join("\\quad ");
  const link = posterLink(c.paperUrl);
  const num = (base: number) => (base * c.fontScale).toFixed(2);
  return `\\def\\PosterWidth{${d.widthMm}}\n\\def\\PosterHeight{${d.heightMm}}\n\\def\\PosterTitle{${texEscape(c.title)}}\n\\def\\PosterSubtitle{${texEscape(c.subtitle)}}\n\\def\\PosterAuthors{${authors}}\n\\def\\PosterAffiliation{${affiliations}}\n\\def\\PosterContact{${contacts || texEscape(c.contact)}}\n\\def\\PosterPaperURL{${texEscape(link)}}\n\\def\\PosterColumns{${c.columns}}\n\\def\\PosterFontScale{${c.fontScale}}\n\\def\\PosterBodySize{${num(27)}}\n\\def\\PosterBodyLeading{${num(35)}}\n\\def\\PosterHeadingSize{${num(40)}}\n\\def\\PosterTitleSize{${num(68)}}\n`;
}
export function safePath(value: string): string {
  const path = value.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((p) => !p || p === "." || p === ".." || [".git", ".gitattributes", ".gitmodules"].includes(p.toLowerCase())) || path.includes("\0"))
    throw new Error("Unsafe project path");
  return path;
}
