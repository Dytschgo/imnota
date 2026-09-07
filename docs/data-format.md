# Data format

The on-disk format is local, portable and versioned. Schema 3 uses collections and one description per screenshot.

```text
project.json
collections/001-collection/screenshots/001-login-screen.png
collections/001-collection/annotations/001-login-screen.png.json
collections/001-collection/descriptions/001-login-screen.png.md
collections/001-collection/exports/Collection 01 - 260907-184205/
  Collection 01 - 260907-184205 - 01.png
  Collection 01 - 260907-184205 - 01.md
.imnota-recovery.json       # present only when recovery is needed
.imnota-transactions/      # interrupted multi-file save recovery
.imnota-undo/               # local deletion recovery snapshots and journals
```

`project.json` contains project identity and timestamps, ordered collections, ordered screenshot records and local export preferences. A collection has an immutable ID, editable name, creation/update timestamps, archived state and optional Overall context. A new collection starts empty. Renaming it never changes its folder ID.

Each screenshot record contains:

- Immutable ID and collection ID.
- Editable title and immutable original filename.
- One Markdown description, also persisted in its description sidecar.
- Low, Medium or High priority; Medium is the default.
- `includeInExport` and a manually sortable `position`.
- Creation/update timestamps, stored filename, dimensions and relative annotation/description paths.
- An optional conflict marker for externally conflicting copies.

The record's `position` orders screenshots within its collection. Picture numbers are not stored identities: export derives them from the current order. Excluding or reordering a screenshot therefore never changes internal IDs.

Annotation JSON contains editable records in original-image coordinates. Canvas zoom does not alter them. Description sidecars preserve Markdown and line breaks. Missing descriptions are valid.

## Prompt exports

Exports live only under the active collection. Each primary Copy Prompt or fresh-files action creates a new local timestamped set and does not overwrite older sets. Separate image/Markdown fallback actions reuse that committed set so both pastes match. The sanitized collection name, local `YYMMDD-HHmmss` timestamp and final bundle number (at least two digits) form each matching PNG/Markdown filename. Names are shortened when necessary to stay within the Windows-compatible path budget; an already excessive workspace path produces an actionable error.

Each set has its own timestamped directory. PNG/Markdown pairs are staged together and published after finalization. Cancellation keeps completed pairs and removes incomplete outputs. An optional ` - overview.md` file is for reviewing the full collection, not the primary copy action.

Automatic splitting may produce several pairs. Original Picture numbers continue across pairs. Excluded screenshots stay in project data, do not appear in PNGs and are explicitly recorded in generated Markdown. Prompt outputs are sharing artifacts, not editable project backups; back up the full project folder to retain sources, annotations, descriptions, recovery data and exclusions.

## Migration and compatibility

Opening schema 1 or 2 data migrates feedback rounds/subfolders to collections. Existing screenshot descriptions and populated legacy note fields are merged into the single Description. Project-level desired outcome, AI instructions and technical constraints are merged into collection Overall context. Legacy `critical` priority becomes High; tags and screenshot statuses do not enter the schema 3 primary model.

Migration copies source content into `collections/` before committing schema 3 metadata. It preserves `project.v1.backup.json` or `project.v2.backup.json` and the legacy source files for manual recovery. A failed copy leaves the old metadata active so migration can be retried.

Do not open a migrated project in an older Imnota version. To attempt rollback, first copy the whole project, then restore the matching versioned backup as `project.json` and use the retained legacy files. Schema 3 edits are not written back into legacy backups.

Unknown future schema versions are rejected rather than silently rewritten.
