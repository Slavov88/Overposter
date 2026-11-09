export type Affiliation = { id: string; institution: string; department: string; city: string; country: string; address: string };
export type Author = { id: string; name: string; email: string; orcid: string; affiliationIds: string[]; corresponding: boolean; equalContribution: boolean };
export type Config = {
  formatVersion: 2;
  title: string;
  subtitle: string;
  authors: Author[];
  affiliations: Affiliation[];
  contact: string;
  paperUrl: string;
  size: "A0" | "A1" | "custom";
  orientation: "landscape" | "portrait";
  widthMm?: number;
  heightMm?: number;
  theme: "academic-classic" | "modern-ml" | "visual-results";
  columns: 2 | 3 | 4;
  fontScale: number;
};
export type Project = {
  id: string;
  name: string;
  config: Config;
  updatedAt: string;
  imported?: boolean;
  trusted?: boolean;
};
export type Report = {
  valid: boolean;
  pageCount: number;
  widthMm: number;
  heightMm: number;
  issues: { level: "error" | "warning"; code: string; message: string }[];
};
export type Build = {
  ok: boolean;
  log: string;
  durationMs: number;
  pdfPath?: string;
  report?: Report;
  cached?: boolean;
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new Error(body.error || "Request failed");
  }
  return response.json() as Promise<T>;
}
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const fileUrl = (id: string, path: string) =>
  `/api/projects/${id}/file?path=${encodeURIComponent(path)}`;
export const pdfUrl = (id: string) => `/api/projects/${id}/pdf`;
