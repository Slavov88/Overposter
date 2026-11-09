export type Config = {
  title: string;
  subtitle: string;
  authors: string;
  affiliation: string;
  contact: string;
  paperUrl: string;
  size: "A0" | "A1" | "custom";
  orientation: "landscape" | "portrait";
  widthMm?: number;
  heightMm?: number;
  theme: "academic-classic" | "modern-ml" | "visual-results";
  columns: number;
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
