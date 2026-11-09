import { z } from "zod";

export const templateIds = [
  "academic-classic",
  "modern-ml",
  "visual-results",
] as const;
export const posterConfigSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    subtitle: z.string().max(240).default(""),
    authors: z.string().max(300).default(""),
    affiliation: z.string().max(300).default(""),
    contact: z.string().max(200).default(""),
    paperUrl: z.string().max(500).default(""),
    size: z.enum(["A0", "A1", "custom"]).default("A1"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    widthMm: z.number().min(200).max(3000).optional(),
    heightMm: z.number().min(200).max(3000).optional(),
    theme: z.enum(templateIds).default("modern-ml"),
    columns: z.literal(3).default(3),
    fontScale: z.literal(1).default(1),
  })
  .superRefine((v, ctx) => {
    if (v.size === "custom" && (!v.widthMm || !v.heightMm))
      ctx.addIssue({
        code: "custom",
        message: "Custom size needs widthMm and heightMm",
      });
  });
export type PosterConfig = z.infer<typeof posterConfigSchema>;
export const defaults: PosterConfig = {
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

export function dimensions(config: PosterConfig): {
  widthMm: number;
  heightMm: number;
} {
  if (config.size === "custom")
    return { widthMm: config.widthMm!, heightMm: config.heightMm! };
  const short = config.size === "A0" ? 841 : 594;
  const long = config.size === "A0" ? 1189 : 841;
  return config.orientation === "landscape"
    ? { widthMm: long, heightMm: short }
    : { widthMm: short, heightMm: long };
}
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export function texEscape(s: string): string {
  return s.replace(
    /[\\{}%$&#_^~]/g,
    (x) =>
      ({
        "\\": "\\textbackslash{}",
        "{": "\\{",
        "}": "\\}",
        "%": "\\%",
        $: "\\$",
        "&": "\\&",
        "#": "\\#",
        _: "\\_",
        "^": "\\textasciicircum{}",
        "~": "\\textasciitilde{}",
      })[x]!,
  );
}
export function configTex(c: PosterConfig): string {
  const d = dimensions(c);
  return `\\def\\PosterWidth{${d.widthMm}}\n\\def\\PosterHeight{${d.heightMm}}\n\\def\\PosterTitle{${texEscape(c.title)}}\n\\def\\PosterSubtitle{${texEscape(c.subtitle)}}\n\\def\\PosterAuthors{${texEscape(c.authors)}}\n\\def\\PosterAffiliation{${texEscape(c.affiliation)}}\n\\def\\PosterContact{${texEscape(c.contact)}}\n\\def\\PosterPaperURL{${texEscape(c.paperUrl)}}\n\\def\\PosterFontScale{${c.fontScale}}\n`;
}
export function safePath(value: string): string {
  const path = value.replaceAll("\\", "/");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.includes("\0")
  )
    throw new Error("Unsafe project path");
  return path;
}
