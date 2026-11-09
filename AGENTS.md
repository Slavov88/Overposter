# Working in Overposter

Overposter has a React/Vite interface in `apps/web`, a local API and compiler in `apps/server`, reusable LaTeX layouts in `templates`, and a CLI in `scripts/poster.ts`. Project source files live under `.overposter/projects/<id>/source` when created in the app. Project version repositories live under `.overposter/versions/`. Examples are committed under `examples/`.

To edit a poster:

1. Read `poster.json`, `poster.tex`, and the affected `sections/*.tex` files.
2. Change the smallest relevant source file. Keep the scientific claims tied to supplied evidence; label illustrative data.
3. Put vector PDFs in `figures/` and reference them with relative paths. Convert SVG to PDF before compilation.
4. Run `pnpm poster:build -- --source <project directory> --out <output.pdf>` or `pnpm poster:build -- --id <project id>`.
5. Inspect the compiler log and preflight JSON. Correct errors and rebuild.
6. Confirm one page and the requested dimensions in the report. Review the visible PDF at poster scale.
7. Report changed source files and the final PDF path.

Do not edit generated `config.tex` in an app project; change poster settings. Do not overwrite concurrent changes: inspect `git diff` and file timestamps before writing, save focused changes, and re-read a file if someone else may have edited it. Keep generated PDFs out of commits unless deliberately publishing an example. In local mode, review imported LaTeX and explicitly approve it before compilation. Hosted compilation must use a separately isolated worker; never run untrusted TeX directly as the web server user.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm examples:build` after code or template changes. Avoid claiming a compiler check passed unless the real toolchain completed it.
