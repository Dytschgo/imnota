# Data format

The on-disk format is intentionally transparent.

```text
project.json
rounds/001-first-feedback/screenshots/001-login-screen.png
rounds/001-first-feedback/annotations/001-login-screen.png.json
rounds/001-first-feedback/notes/001-login-screen.png.md
rounds/001-first-feedback/exports/context.md
exports/context.md  # all-round export
```

`project.json` has `schemaVersion: 2`, a project identity, timestamps, status, tags, favourite state, feedback rounds, ordered screenshot records and export preferences. Each round has a stable folder ID, editable name, creation date and archived flag. Each screenshot has a `roundId`, original and stored filenames, dimensions and references to annotation and notes files. Renaming a round does not rename its folder or break references. Duplicating a round copies images, notes and annotations to independent files.

Annotation JSON is an array of editable records. Coordinates are stored in original-image pixels, so the same data remains meaningful at different canvas zoom levels. Notes Markdown uses one `## fieldName` heading per structured note field. Empty fields are not written.

Version-1 projects are migrated on opening or discovery. Imnota copies their files into the first feedback round and commits the new metadata only after the copies succeed. The original folders and `project.v1.backup.json` remain untouched for rollback. If a copy fails, the version-1 metadata remains active; the next open can retry. Do not open a migrated project in an older Imnota version. For rollback, make a separate copy of the project, restore `project.v1.backup.json` as `project.json`, and use its retained original folders. New version-2 edits are not reflected in that old backup.

Round exports live in the round's `exports` folder. All-round exports live in the project-level `exports` folder. ZIP briefs place annotated PNGs alongside `context.md`, matching the brief's filenames. Notes and optional original screenshots/annotation metadata retain their round-relative paths. A brief ZIP without originals is not a complete editable project backup; copy the whole project folder to back up all data, recovery files and excluded screenshots.

Future schema versions are rejected rather than silently rewritten. Notes retain multiline Markdown; headings matching reserved note field names separate fields.
