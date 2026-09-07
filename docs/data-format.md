# Data format

The on-disk format is local, portable and versioned. Schema 4 uses collections containing screenshots, Markdown text blocks and drawings. Screenshot-only projects can remain schema 3; adding the first text block or drawing upgrades them without changing screenshot identity or source filenames.

```text
project.json
collections/001-collection/screenshots/001-login-screen.png
collections/001-collection/annotations/001-login-screen.png.json
collections/001-collection/descriptions/001-login-screen.png.md
collections/001-collection/drawings/001-system-flow.json
collections/001-collection/drawings/001-system-flow.png
collections/001-collection/text/001-context.md
collections/001-collection/exports/Collection 01 - 260907-184205/
  Collection 01 - 260907-184205 - 01.png
  Collection 01 - 260907-184205 - 01.md
.imnota-recovery.json       # present only when recovery is needed
.imnota-transactions/      # interrupted multi-file save recovery
.imnota-undo/               # local deletion recovery snapshots and journals
```

`project.json` contains project identity and timestamps, ordered collections, screenshot records, schema-4 text/drawing records and local export preferences. A collection has an immutable ID, editable name, creation/update timestamps, archived state and optional Overall context. A new collection starts empty. Renaming it never changes its folder ID.

Each screenshot record contains:

- Immutable ID and collection ID.
- Editable title and immutable original filename.
- One Markdown description, also persisted in its description sidecar.
- Low, Medium or High priority; Medium is the default.
- `includeInExport` and a manually sortable `position`.
- Creation/update timestamps, stored filename, dimensions and relative annotation/description paths.
- An optional conflict marker for externally conflicting copies.

The record's `position` orders screenshots within its collection. Picture numbers are not stored identities: export derives them from the current order. Excluding or reordering a screenshot therefore never changes internal IDs.

Schema 4 adds a `contentItems` array for text and drawing records. The application combines it with the screenshot records and sorts all records by `position`, using creation time and ID as deterministic tie-breakers. This combined order is used by the collection rail and export code.

Text blocks reference a Markdown file under `collections/<collection>/text/`. Drawings reference an editable JSON source and rendered PNG under `collections/<collection>/drawings/`. Drawing JSON is authoritative for editing; the PNG is a derived export cache. All three item types have stable IDs, export visibility and recoverable deletion.

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

Adding the first text block or drawing to a schema 3 project retains `project.v3.backup.json` and commits schema 4 metadata with the new content files through the transaction layer. An existing, different version-3 backup blocks the upgrade rather than being overwritten. Schema 4 edits are not reflected in that backup. Restore only on a copy of the whole project; reverting metadata alone does not preserve later text/drawing edits.

## Hosted artifacts

Hosted sharing is separate from the project format. The native client reads finalized PNG/Markdown bundles and uploads only the approved manifest. Local share history and recovery metadata live in the app profile; editable sources, local project paths, recovery journals and the project folder are not part of the upload. Server storage and retention are documented in the [service guide](../share-service/README.md).
