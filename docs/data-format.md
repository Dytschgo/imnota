# Data format

The on-disk format is intentionally transparent.

```text
project.json
screenshots/001-login-screen.png
annotations/001-login-screen.png.json
notes/001-login-screen.png.md
exports/context.md
```

`project.json` has `schemaVersion: 1`, a project identity, timestamps, status, tags, favourite state, ordered screenshot records and export preferences. Screenshot records store original and stored filenames, dimensions and references to annotation and notes files.

Annotation JSON is an array of editable records. Coordinates are stored in original-image pixels, so the same data remains meaningful at different canvas zoom levels. Notes Markdown uses one `## fieldName` heading per structured note field. Empty fields are not written.

Future migrations should be explicit, monotonic and backup-safe. Projects with a newer schema are rejected with an actionable message rather than silently rewritten.
