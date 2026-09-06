# Architecture

Imnota is a local-first Electron desktop application with a narrow, typed security boundary. The renderer never receives direct Node.js or unrestricted filesystem access.

## Runtime layers

- `electron/` owns windows, dialogs, clipboard operations, filesystem validation, OS trash, project migration, exports and update checks.
- `electron/preload.cts` exposes the typed `window.imnota` bridge with context isolation enabled.
- `src/renderer/` owns the React shell, collection rail, screenshot inspector, Konva canvas, sharing UI, settings and onboarding.
- `src/shared/` owns versioned domain types, validation and pure Markdown/export helpers used by both processes and tests.

Every main-process operation resolves paths from the selected workspace and rejects traversal and link-based escapes. Imported project data is untrusted even though it is local.

## Domain boundaries

Projects contain ordered collections. Collection IDs and screenshot IDs are immutable; editable names and export-time Picture numbers are presentation concerns. A screenshot has one Markdown-capable description, one Low/Medium/High priority, an include-in-export flag and independently persisted annotations.

Collection creation, archive/restore rules and ordering belong behind one collection update boundary. Screenshot persistence, recovery and external-change detection belong behind a filesystem adapter rather than React components. This keeps a future asynchronous sync adapter possible without introducing cloud behavior now.

Renderer responsibilities should remain separated into application/bootstrap, collections, screenshots, canvas, inspector, prompt export and settings modules. Keyboard shortcuts and autosave are dedicated hooks. Save, export, migration and external-change conflicts use typed, actionable errors. These boundaries are about maintainability; they are not a network service or plugin API.

## Persistence and recovery

`project.json` stores versioned metadata while original screenshots, annotation JSON and description Markdown remain ordinary files. Writes use a temporary sibling followed by rename. Recovery data is local to the project and can restore interrupted edits.

Project file watching is debounced. Safe external changes can be reloaded; unsaved local changes require confirmation. If concurrent edits cannot be reconciled, Imnota preserves a same-collection Copy conflict, marks it visibly and excludes it from prompt export by default.

Deleting an individual screenshot sends its source, annotations and description to the operating-system trash. A bounded local undo record supports the immediate Undo action. The original project metadata is committed only after the deletion operation is safe to present.

## Prompt export

Export is scoped to the current collection. The renderer produces annotated, expanded screenshot renders and structured bundle input; export helpers split content automatically using dimensions, pixel count, readability, memory and clipboard limits. The main process writes a fresh timestamped `.png` + `.md` set into that collection's `exports` directory.

Prompt PNGs use a neutral white background and export-only contrast correction. Source screenshots and saved annotation colors are never rewritten. Excluded screenshots are absent from PNGs but retained as explicit Markdown exclusions with their original export-time Picture numbers.

The clipboard bridge can write Markdown and an image representation together. This confirms only that Imnota prepared clipboard formats. The receiving application decides which formats to accept, so separate text, image and file/folder fallbacks remain part of the product contract.

## Local settings

Workspace-independent settings store panel collapse state, appearance, shortcuts and onboarding completion in the local application profile. They are not written into projects. The default appearance follows the operating system; optional presets and Glass remain cosmetic and must preserve accessibility fallbacks.

Imnota has no account, hosted AI call, cloud sync or background telemetry in this architecture.
