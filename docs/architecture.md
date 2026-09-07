# Architecture

Imnota is a local-first Electron desktop application with a narrow, typed security boundary. The renderer never receives direct Node.js or unrestricted filesystem access.

## Runtime layers

- `electron/` owns windows, dialogs, clipboard operations, filesystem validation, OS trash, project migration, exports and update checks.
- `electron/preload.cts` exposes the typed `window.imnota` bridge with context isolation enabled.
- `src/renderer/` owns the React shell, collection rail, screenshot inspector, Konva canvas, sharing UI, settings and onboarding.
- `src/shared/` owns versioned domain types, validation and pure Markdown/export helpers used by both processes and tests.
- `share-service/` is an optional, separately deployed HTTP service for finalized artifacts. It has no access to the local project workspace.

Every main-process operation resolves paths from the selected workspace and rejects traversal and link-based escapes. Imported project data is untrusted even though it is local.

## Domain boundaries

Projects contain ordered collections. Collection IDs and screenshot IDs are immutable; editable names and export-time Picture numbers are presentation concerns. A screenshot has one Markdown-capable description, one Low/Medium/High priority, an include-in-export flag and independently persisted annotations.

Schema 4 also stores drawing and Markdown records in `contentItems`. `orderedCollectionItems` combines them with screenshots into one deterministic order. Native content persistence treats drawing JSON and Markdown as editable sources, with a rendered PNG for drawing exports; see the [mixed-content contract](mixed-content-model.md).

Collection creation, archive/restore rules and ordering belong behind one collection update boundary. Screenshot persistence, recovery and external-change detection belong behind a filesystem adapter rather than React components. This keeps a future asynchronous sync adapter possible without introducing cloud behavior now.

Renderer responsibilities should remain separated into application/bootstrap, collections, screenshots, canvas, inspector, prompt export and settings modules. Keyboard shortcuts and autosave are dedicated hooks. Save, export, migration and external-change conflicts use typed, actionable errors. These boundaries are about maintainability; they are not a network service or plugin API.

## Persistence and recovery

`project.json` stores versioned metadata while original screenshots, annotation JSON and description Markdown remain ordinary files. Individual writes use a temporary sibling followed by rename. Multi-file screenshot saves keep before/after recovery data in `.imnota-transactions`, validate their baseline, and write changed project metadata last as the commit point. Recovery data is local to the project.

Project file watching is debounced. Safe external changes can be reloaded; unsaved local changes require confirmation. If concurrent edits cannot be reconciled, Imnota preserves a same-collection Copy conflict, marks it visibly and excludes it from prompt export by default.

Deleting an individual screenshot sends its source, annotations and description to the operating-system trash. Imnota retains its own recovery snapshot for Undo; it does not depend on a portable OS-trash restore API. Undo can therefore leave the original trashed copy in the system trash. Recovery journals must remain available until their operation has safely completed or been resolved.

## Prompt export

Export is scoped to the current collection. The renderer produces annotated, expanded screenshot renders and structured bundle input; export helpers split content automatically using dimensions, pixel count, readability, memory and clipboard limits. The main process writes a fresh timestamped `.png` + `.md` set into that collection's `exports` directory.

Prompt PNGs use a neutral white background and export-only contrast correction. Source screenshots and saved annotation colors are never rewritten. Excluded screenshots are absent from PNGs but retained as explicit Markdown exclusions with their original export-time Picture numbers.

The clipboard bridge can write Markdown and an image representation together. This confirms only that Imnota prepared clipboard formats. The receiving application decides which formats to accept, so separate text, image and file/folder fallbacks remain part of the product contract.

## Hosted sharing boundary

The renderer requests finalized prompt bundles by session and bundle identity. The main process reads and validates the committed artifacts, displays an exact manifest through the sharing flow, and uploads only after explicit confirmation and one-use browser pairing. Native transport validates origins and bounded responses, refuses redirects and preserves local recovery/history state for ambiguous network outcomes.

The service canonicalizes bounded PNGs, sanitizes Markdown, stores artifacts outside the public web root and serves them through expiring public tokens. Management credentials support revocation. Quotas, rate limits, idempotent receipts, cleanup and metadata backups belong to the service, not project persistence. There is no project sync or background content upload. See [service architecture and operations](../share-service/README.md).

## Local settings

Workspace-independent settings store panel collapse state, appearance, shortcuts and onboarding completion in the local application profile. They are not written into projects. The default appearance follows the operating system; optional presets and Glass remain cosmetic and must preserve accessibility fallbacks.

Imnota has no account, hosted AI call, cloud sync or background telemetry in this architecture.
