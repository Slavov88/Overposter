# Project versions

Each project has a bare Git repository under `.overposter/versions/<id>.git`, separate from editable source. Create a named checkpoint in the version history panel, inspect its changed files and diff, or preview a text file at that version. A successful compile also creates a checkpoint when source changed.

Restore checks the expected history head, first records a `Before restore` checkpoint, then writes the selected version to source and commits a restore event. Earlier commits remain reachable. Browser drafts and ETag conflicts are separate from Git history; resolve an unsaved conflict before restoring.

Back up the project directory and its matching version repository together while the app is stopped. A source ZIP exports poster source but not version history. Restoring an external backup should replace both parts as a pair.
