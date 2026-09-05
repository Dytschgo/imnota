# Architecture

Imnota is a single-process desktop application with a secure Electron boundary.

## Runtime layers

- `electron/main.ts` owns dialogs, clipboard, filesystem, trash, exports and the BrowserWindow.
- `electron/preload.ts` exposes only the typed `window.imnota` bridge.
- `src/renderer` owns React UI state, Zustand UI state, the Konva stage and Markdown preview.
- `src/shared` contains the data contract and pure functions used by both runtime layers and tests.

The renderer does not access Node.js APIs. The main process resolves every project path and checks that it remains inside the selected workspace before reading or writing.

## Persistence

Writes use a temporary sibling file followed by rename. Screenshot notes and annotations are separate from the original image. A lightweight `.imnota-recovery.json` file is written during editing and flagged on the next open when it is newer than `project.json`.

## Export

The renderer creates a canvas data URL for the active annotated screenshot. The main process writes PNGs to `exports/`, generates `context.md`, and creates a ZIP containing metadata, annotated images, optional originals and optional annotation JSON.
