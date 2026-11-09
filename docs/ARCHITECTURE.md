# Architecture

`apps/web` is the React/Vite interface, `apps/server` is a loopback Fastify API and local compiler, `scripts/poster.ts` is the CLI, and `templates` contains the three LaTeX layouts plus shared macros. The API stores project metadata in `.overposter/projects/<id>/project.json`, editable source in `source/`, generated PDFs in `.overposter/builds/`, and bare Git version repositories in `.overposter/versions/`.

The editor sends file writes with an ETag. A stale ETag produces a conflict, retaining the browser draft for recovery. Compile first saves the active editor buffer, then stages source into a temporary directory and runs local XeLaTeX and `xdvipdfmx` without shell escape. A successful build replaces the PDF and creates a checkpoint; failure preserves the previous PDF. Preflight checks page count, dimensions, fonts, and image DPI.

Local mode is for a single trusted user on loopback. ZIP imports are untrusted until explicitly approved after source inspection. XeLaTeX is not an isolation boundary. Hosted mode fails at startup and must remain disabled until an authenticated API, project authorization, persistent collaboration, and separate isolated compiler worker have passed integration tests.
