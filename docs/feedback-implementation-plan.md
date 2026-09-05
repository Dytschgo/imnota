# Imnota Feedback Implementation Plan

## Implementation status

Implemented locally: native macOS title-bar safe space and branded packaging icon, responsive panels including navigation collapse, bounded scrolling for long screenshot lists, pan/zoom/fit/actual size, direct text editing, image clipboard and attachment checklist, feedback rounds with independent files and safe version-1 migration, and current-round/all-round exports.

Validation includes filesystem migration tests and an Electron workflow covering round duplication/rename/archive/restore, real image clipboard, panel resizing, panning, text creation/double-click/Enter/Escape, annotation persistence, recovery, PNG/ZIP exports and a 100-screenshot project. Cross-platform release packaging and public-download verification must still run for this change before it is called released. The macOS mark is a code-native placeholder derived from the existing Imnota logo, not final commissioned artwork.

Verification: formatting, lint, both TypeScript configurations, 23 tests, production build, Windows NSIS/portable packaging and packaged Electron smoke checks pass. PR #9 at `ac2e7f4` also passes Linux, Windows and macOS packaging, macOS universal archive signature/launch checks, dependency review and CodeQL. The synthetic 100-image check imports 1920 × 1080 images in about three seconds and reopens the warmed project in about 30–35 ms on this machine; this is not a cross-platform performance guarantee. A new public release and public-download verification remain gated on independent PR approval. Vite reports a non-failing renderer bundle-size warning.

Manual updates: a navigation refresh button and Settings control check GitHub for a newer app version, display progress and offer retry after failure. Concurrent checks are coalesced. macOS opens the release download for manual installation; the UI does not promise unsupported automatic installation for ad-hoc-signed Mac builds.

Existing concurrent dependency and CodeQL changes were retained. The unused `electron-winstaller` install script is explicitly disabled. Local packaging requires the pnpm command shim to be on PATH (`corepack enable`, as documented in the README); calling Corepack alone does not make pnpm visible to Electron Builder subprocesses.

Interaction decisions: Select drags the screenshot and its annotations together by panning empty canvas/image areas; dragging an annotation moves just that annotation. Space-drag and middle-drag pan in any tool. Trackpad scrolling pans; pinch or Ctrl/Command-wheel zooms around the cursor. Plain text defaults to red for visibility on common white screenshots. Enter confirms text, Shift+Enter inserts a line, Escape cancels, and clicking elsewhere commits.

Clipboard limitation: copying text cannot attach several images to every AI application. The checklist provides separate image copying and exported PNG attachment, and explicitly explains that copying an image replaces clipboard text.

## Phase 1 — Fix the desktop shell and branding

- Adjust the macOS title-bar layout so the logo never clips into the traffic-light controls.
- Add the Imnota logo consistently to the main application view.
- Replace the temporary/default Electron icon with the Imnota placeholder mark where possible.
- Remove the irrelevant bottom-left privacy message from the main workspace.
- Keep privacy information inside Settings only.

## Phase 2 — Make the workspace responsive

- Convert the workspace layout to a real responsive grid.
- When the screenshot selector is hidden, automatically expand the canvas into the available space.
- When the inspector is hidden, automatically expand the canvas as well.
- Prevent toolbar labels, canvas metadata and inspector text from clipping.
- Add minimum and maximum panel widths.
- Test common desktop sizes with both panels collapsed.

## Phase 3 — Improve canvas interaction like Excalidraw

- Make Select the default free-movement tool.
- Allow screenshots and annotations to move freely around the canvas.
- Add predictable pan behavior with middle mouse, space-drag and trackpad-friendly gestures.
- Add zoom around the cursor position.
- Keep fit-to-screen and actual-size controls.
- Improve selection handles and resizing behavior.
- Add clearer selection states and keyboard behavior.
- Prevent accidental shape creation when moving existing objects.

## Phase 4 — Add direct text editing

- Double-click text annotations to edit them directly on the canvas.
- Support Enter to confirm and Escape to cancel.
- Preserve inspector-based text editing.
- Prevent canvas shortcuts from interfering while text is being edited.
- Add tests for creating, editing, cancelling and saving text annotations.

## Phase 5 — Fix AI context and image handling

- Keep Markdown context and annotated images associated with one export package.
- Improve the “Copy AI Context” flow so it:
  - Copies the Markdown text.
  - Exports the annotated images.
  - Shows exactly where the images are located.
  - Provides individual “Copy image” actions.
  - Provides an “Open export folder” action.
- Use Electron clipboard image support for copying individual annotated images.
- Do not claim that every AI application supports multiple image attachments through one clipboard operation.
- Add a visible attachment checklist so users know which images still need to be attached.

## Phase 6 — Add feedback rounds inside projects

Introduce a project structure like:

```text
Project/
  project.json
  rounds/
    001-first-feedback/
      screenshots/
      annotations/
      notes/
      exports/
    002-revised-feedback/
      screenshots/
      annotations/
      notes/
      exports/
```

Users will be able to:

- Create a new feedback round.
- Rename a round.
- Duplicate a round.
- Archive a round.
- Switch between rounds.
- Keep each round’s screenshots and annotations independent.
- Export one round or the entire project.
- Continue opening existing projects through a schema migration.

The current single-round project format must be migrated safely rather than discarded.

## Phase 7 — Quality and release verification

- Update the data schema and migration tests.
- Add component tests for panel collapsing and responsive behavior.
- Add canvas tests for movement, panning and double-click text editing.
- Add clipboard and export tests.
- Add feedback-round persistence and migration tests.
- Run linting, formatting, type checking and unit tests.
- Run Electron smoke tests.
- Build and test Windows, Linux and universal macOS packages.
- Verify the public download and update workflow again.

## Recommended implementation order

1. Responsive panels and logo/title-bar fixes.
2. Excalidraw-style canvas movement and zoom.
3. Double-click text editing.
4. AI image-copy workflow.
5. Feedback rounds and schema migration.
6. Tests, packaging and release.
