# Imnota Implementation Plan

## Product direction

Imnota is a local visual-to-agent handoff tool for developers and QA testers who use AI coding agents such as Codex, Claude Code, Cursor, Copilot, Windsurf, or Gemini CLI.

The immediate priorities are:

1. Keep the project open source.
2. Keep the workflow local-first.
3. Fix the current workflow and interaction issues.
4. Make the application fast, clear, and usable.
5. Collect feedback from real developers and QA testers.
6. Prepare clean architectural boundaries for future asynchronous sync and monetization.
7. Do not build cloud sync, AI integrations, or team collaboration yet.

The core workflow is:

```text
Paste or drop screenshots
        ↓
Annotate visually
        ↓
Add optional text descriptions
        ↓
Organize into a collection
        ↓
Generate readable prompt bundles
        ↓
Copy one prompt bundle into any AI coding tool
```

Imnota should remain agent-agnostic. Its first version should produce excellent Markdown and high-resolution images that can be copied into any external coding tool without requiring native integrations.

## Current codebase assessment

The existing implementation already has a strong base:

- Electron, React, TypeScript, Zustand, Konva, and a secure preload bridge.
- Local project folders with JSON, Markdown, and image files.
- Screenshot import, paste, drag-and-drop, annotation, export, recovery, and update workflows.
- Strong filesystem safety and recovery behavior.
- Typecheck, lint, tests, production build, and Electron smoke coverage.

The main technical risks are:

- `src/renderer/App.tsx` is over 2,200 lines and owns too many unrelated responsibilities.
- The responsive layout hides panels instead of turning them into usable drawers.
- The annotation toolbar exposes too many tools at the same visual priority.
- Export currently needs to evolve from a generic package into readable prompt bundles.
- The current screenshot metadata model contains fields that are not important to the intended workflow.
- The design-system documentation has drifted from the actual indigo/system-font application styling.
- Visual regression coverage is still missing.
- The renderer bundle is above the current Vite chunk warning threshold.
- The normal development command is sensitive to `ELECTRON_RUN_AS_NODE` in environments where that variable is set; the smoke script already removes it explicitly.

Relevant existing files:

- `src/renderer/App.tsx`
- `src/renderer/styles.css`
- `src/renderer/components/AnnotationCanvas.tsx`
- `src/renderer/components/Toolbar.tsx`
- `src/renderer/components/ProblemDescriptionEditor.tsx`
- `src/renderer/prepare-context.ts`
- `src/renderer/export-image.ts`
- `src/renderer/store.ts`
- `src/shared/types.ts`
- `src/shared/schema.ts`
- `src/shared/markdown.ts`
- `electron/main.ts`

## Phase 1 — Simplify the data model

Create a model around the actual local workflow.

### Screenshot model

Each screenshot should contain:

```ts
{
  id: string; // immutable internal ID
  title: string; // defaults to original filename
  description: string; // one Markdown-capable text field
  priority: 'low' | 'medium' | 'high';
  includeInExport: boolean; // eye / crossed-eye state
  position: number; // manually sortable order
  originalFilename: string;
}
```

Rules:

- The title defaults to the original filename.
- The user can edit the title without changing the original file identity.
- The description is optional and supports basic Markdown typed directly into the field.
- Priority defaults to Medium.
- Priority appears in Markdown but never changes screenshot order.
- The current screenshot order determines export-time Picture numbers.
- Internal IDs never change when screenshots are reordered.

### Collection model

Collections replace the user-facing “Subfolder” terminology.

```ts
{
  id: string; // immutable internal ID
  name: string; // user-facing name
  createdAt: string;
  archived: boolean;
}
```

Rules:

- New collections always start empty.
- New collection names are generated from the workspace folder name and collection number, for example `My Workspace / Collection 02`.
- The user can rename the visible collection name.
- Internal ID, creation timestamp, and creation order remain authoritative.
- The newest collection remains active after export.
- When a newer collection is created, the previous collection becomes archived.
- Archived collections remain visible in the chooser with an Archived label.
- Archived collections can be restored to the current collection list.

### Migration

Existing projects should migrate to the simplified model:

- Merge old note fields into the new single Description field.
- Merge old project-level instructions, desired outcomes, and constraints into optional collection-level Overall context.
- Remove tags and screenshot statuses from the new primary model and interface.
- Preserve old source files temporarily as a migration backup if conversion fails.
- Increment the schema version.
- Add migration tests for old and new project formats.

Tags and statuses are not important to the intended workflow and should not continue shaping the primary UX.

## Phase 2 — Rework collections and screenshot workflow

### Collection rail

The collection rail should contain:

- Collection chooser.
- Archived labels and restore actions.
- Optional Overall context action.
- New collection action.
- Screenshot list.
- Direct eye / crossed-eye export control.

The optional Overall context field belongs in the collection rail because it applies to the collection as a whole.

### Import and paste behavior

When a screenshot is imported or pasted:

- Append it to the end of the current collection.
- Preserve the order supplied by the operating system or file picker.
- Do not alphabetize unless a future platform limitation requires it.
- Make the newest imported screenshot active immediately.
- Open the new screenshot so the user can annotate without manually finding it.

When reopening a project:

- Restore the last opened collection.
- Select the first screenshot in that collection.
- Open both the collection rail and inspector by default.
- Remember panel collapse state locally when possible.
- Do not store panel state in project files or future sync data.

### Screenshot visibility

Every screenshot row should have a direct visibility/export control:

- Eye icon when included.
- Crossed-eye icon when excluded.
- Muted or greyed-out row styling when excluded.
- The screenshot remains selectable and editable when excluded.

Excluded screenshots:

- Stay in the collection.
- Are omitted visually from prompt PNGs.
- Are mentioned textually in every generated Markdown file.
- Do not cause remaining screenshots to be renumbered.

Example:

```md
Picture 3 was intentionally excluded from this prompt bundle.
```

### Screenshot deletion

Users should be able to delete individual screenshots.

Deletion should:

- Move the original image, annotations, and description to the operating system trash.
- Remove the screenshot from the active collection view.
- Show a notification such as `Screenshot moved to trash`.
- Offer an Undo action.
- Preserve all other screenshot IDs and ordering logic.

## Phase 3 — Simplify and improve annotation

### Primary toolbar

Show the important tools directly:

- Select / Move.
- Text.
- Arrow.
- Rectangle.
- Highlight.
- Note / Step.

The current tool must be visually highlighted.

Advanced tools should move under a More tools menu:

- Blur.
- Pixelation.
- Crop.
- Freehand drawing.
- Line.
- Ellipse.
- Callout.

Every tool needs a visible hover tooltip explaining what it does and, when available, its shortcut.

### Canvas interaction

The default tool is Select / Move.

Required behavior:

- Drag empty screenshot space to pan the canvas.
- Drag an existing annotation to move only that annotation.
- Double-click anywhere on the screenshot to create a text box.
- Focus the new text box immediately.
- Start typing without another click.
- Enter confirms the text.
- Shift+Enter adds a line.
- Escape cancels editing.
- After confirming a text box, automatically return to Select / Move.

When an annotation is dragged near the viewport edge:

- Automatically pan the canvas.
- Start at a gentle speed.
- Gradually increase speed as the pointer approaches the edge.
- Continue moving the annotation while more of the screenshot is revealed.
- Use pointer capture and a controlled edge-pan loop so dragging remains reliable when the pointer leaves the canvas bounds.

### Text references

Picture numbers are generated only during export.

Text annotation references are scoped to their screenshot:

```text
Picture 1 / Note 1
Picture 1 / Note 2
Picture 2 / Note 1
```

Each text annotation receives a small `Note 1`, `Note 2`, etc. badge next to its text box.

Visual-only annotations do not create Markdown note entries. They remain visible in the cheat image and are understood visually by the agent.

### Color behavior

Automatic semantic colors are the default, based on annotation type and active theme.

The user can override colors through a compact ten-color palette:

- Quick palette directly in the toolbar.
- Full selected-annotation color control in the inspector.

Theme behavior:

- Text adapts between light and dark application themes.
- Light mode uses black text by default.
- Dark mode uses white text by default.
- Other preset colors remain unchanged when they are readable.

Export behavior:

- Prompt PNGs always use a white neutral background.
- Export rendering performs stronger contrast correction than the live canvas.
- White text becomes a readable dark equivalent on white.
- Green and other colors are shifted to contrast-safe equivalents when necessary.
- Text can receive a subtle outline or backing when placed over complex imagery.
- Saved annotation intent is preserved; only rendered export colors are adapted.

## Phase 4 — Simplify the inspector

The inspector should focus on information the agent needs.

Primary fields:

- Title.
- Description.
- Priority for agent.
- Eye / crossed-eye export visibility.

Priority options:

- Low.
- Medium.
- High.

Priority defaults to Medium and is written into Markdown without changing screenshot order.

The Description field should:

- Be one freeform text area.
- Support basic Markdown typed directly.
- Preserve line breaks.
- Be optional.
- Be dynamically included only when non-empty.

A screenshot without a description or text annotations still receives a minimal Markdown reference:

```md
## Picture 3 — dashboard.png

Priority for agent: Medium
```

The optional collection-level Overall context should:

- Live in the collection rail.
- Appear in the master Markdown.
- Appear fully in Prompt 1 only.
- Be referenced briefly by Prompt 2 and later.
- Not be duplicated into every prompt.

## Phase 5 — Implement prompt bundle export

This is the central product feature.

### Export scope

Exports operate on the current collection only.

For every export:

- Included screenshots are rendered into one or more prompt PNGs.
- Excluded screenshots are omitted visually.
- Original Picture numbers are preserved across split bundles.
- Text annotations remain visible on the PNG.
- Text annotation content is also copied into Markdown.
- Screenshot descriptions appear in Markdown.
- Visual annotation geometry is not serialized into Markdown.
- Screenshots may be exported without any description or annotations.

### Prompt PNG layout

Each prompt PNG should be:

- Vertical.
- Built on a white neutral background.
- High-resolution.
- Composed of full-width screenshots.
- Given a consistent outer margin.
- Labelled above each screenshot.

Example:

```text
Picture 1 — checkout.png
[full-width annotated screenshot]

Picture 2 — confirmation.png
[full-width annotated screenshot]
```

Text annotations remain at their original positions and remain visible in the cheat image.

Each text annotation also shows its small Note badge.

### Expanded export bounds

The export bounds must expand beyond the original screenshot when needed:

- Long text annotations must remain fully visible.
- Annotations moved outside the original screenshot must be included.
- Text boxes larger than their original canvas area must be included.
- Transparent space may be added around the original image.
- A consistent safety margin must surround the outermost content.

The original source screenshot must never be modified.

### Automatic splitting

Imnota decides automatically where to split prompt bundles based on:

- Native screenshot dimensions.
- Combined output dimensions.
- Pixel count.
- Clipboard safety limits.
- Text readability.
- Memory usage.

Users do not manually choose split points.

Normal targets:

- Typical collection: 1–10 screenshots.
- High-volume collection: around 20 screenshots.
- Stress test: 100 screenshots.
- Mixed resolutions: 1920×1080, 2560×1600, and 3840×2160.

### File naming

Each export creates a new timestamped set and never overwrites an older export.

Recommended format:

```text
Collection 02 - 260907-184205 - 01.png
Collection 02 - 260907-184205 - 01.md

Collection 02 - 260907-184205 - 02.png
Collection 02 - 260907-184205 - 02.md
```

Rules:

- Use the collection name only.
- Use `YYMMDD-HHmmss` for the local timestamp.
- Use the final number for the prompt bundle number.
- Sanitize Windows-invalid filename characters.
- Truncate overly long collection names safely.
- Save files inside the current collection’s `exports` directory.
- Do not create individual annotated PNGs for every screenshot.

### Markdown output

Each prompt bundle receives its own matching Markdown file.

Markdown should include:

- Overall context in Prompt 1 only.
- A reference to Prompt 1 context in later bundles.
- Screenshot title.
- Picture number.
- Priority.
- Description if supplied.
- Text annotations with scoped Note references.
- Explicit excluded screenshot notes.

Example:

```md
# Collection 02

Shared collection context is included in Prompt 1.

## Picture 4 — checkout.png

Priority for agent: High

The checkout button is too difficult to find on smaller screens.

### Picture 4 / Note 1

Move the primary action closer to the form completion state.

Picture 3 was intentionally excluded from this prompt bundle.
```

If there is no description or text annotation, retain a minimal reference:

```md
## Picture 5 — dashboard.png

Priority for agent: Medium
```

An optional master Markdown overview may contain the whole collection, including excluded screenshots. It is for the user to inspect and is not offered as a normal copy-paste bundle.

### Sharing UI

The sharing dialog should show the generated prompt bundles as separate cards, limited to the current collection.

Each card should display:

- Small preview thumbnail.
- Click-to-enlarge preview.
- Prompt number.
- Screenshot count.
- Excluded count.
- Estimated size.
- Readability warnings.
- Copy action.

The first visible actions should be:

- Copy Prompt 1.
- Copy Prompt 2.
- Copy Prompt 3.

Each copy action should:

1. Generate a fresh timestamped export from the latest saved state.
2. Copy the matching Markdown and PNG together.
3. Show a success state.
4. Provide separate fallback actions.

Fallback actions:

- Copy Markdown only.
- Copy image only.
- Open the generated files.
- Open the export folder.

“Copy all prompts” can live in a dropdown as an experimental option. It should not be the primary action because clipboard support varies between target applications.

The copy dialog should explain that combined clipboard support may fail in some applications. If combined copying fails, make the separate Markdown and image actions prominent.

### Progress and cancellation

Large exports should show progress such as:

```text
Preparing Prompt 2 of 3
```

Cancellation should:

- Stop the export.
- Remove incomplete files.
- Keep successfully completed bundles from the current export.
- Preserve previous timestamped exports.

## Phase 6 — Onboarding and themes

### Onboarding

Show onboarding only for a genuinely new local application profile.

Store completion separately from workspace and project data:

```ts
onboarding: {
  completed: boolean;
  completedVersion: number;
}
```

Rules:

- Show once on a new installation/profile.
- Do not show again after normal application updates.
- Keep it replayable from Settings.
- Use an isolated temporary demo project.
- Use one simple sample screenshot.
- Do not write demo files into the user’s real workspace.
- End with `Create your first project`.
- If no workspace exists, ask the user to create one before creating the real project.

The interactive demo should cover:

1. Paste or import a screenshot.
2. Annotate it with text and visual markers.
3. Copy a prompt bundle into an AI tool.

Onboarding visuals may be generated bitmap assets with a polished visual direction inspired by Wispr Flow. If generated assets are not included, keep reusable image prompts available.

### Themes

Default application appearance:

```text
Follow operating system theme
```

Add a small set of curated presets rather than arbitrary color editing. Possible presets:

- Graphite.
- Indigo.
- Emerald.
- Amber.
- Glass.

Glass mode:

- Optional.
- Cosmetic only.
- Disabled or reduced automatically on low-performance systems.
- Includes a few transparency levels.
- Has a solid-surface fallback.
- Respects reduced-transparency accessibility preferences.

The current application’s actual indigo/system-font visual language should become the documented design-system source of truth instead of the stale generated design-system values.

## Phase 7 — Configurable shortcuts

Mouse interaction remains the primary workflow, but shortcuts should support experienced users.

Shortcuts should cover:

- Annotation tools.
- Screenshot navigation.
- Screenshot visibility.
- Copying prompt bundles.
- Panel controls.
- Fit and actual-size canvas views.
- Common collection actions.

The shortcut settings screen should support:

- Editing shortcuts.
- Windows and macOS platform-aware defaults.
- Conflict detection.
- Clear conflict explanations.
- Reset to defaults.

## Phase 8 — Refactor the codebase

Before adding all features, split the current application shell into focused modules.

Recommended structure:

```text
src/renderer/
  app/
    AppShell.tsx
    AppDialogs.tsx
    useAppBootstrap.ts
    useKeyboardShortcuts.ts
    useProjectPersistence.ts

  collections/
    CollectionRail.tsx
    CollectionChooser.tsx
    CollectionContext.tsx

  screenshots/
    ScreenshotList.tsx
    ScreenshotRow.tsx
    ScreenshotActions.tsx

  canvas/
    AnnotationCanvas.tsx
    AnnotationToolbar.tsx
    AnnotationPalette.tsx
    annotation-commands.ts
    annotation-export.ts

  inspector/
    ScreenshotInspector.tsx
    DescriptionEditor.tsx
    PriorityField.tsx

  export/
    PromptBundleBuilder.ts
    PromptBundleCard.tsx
    PromptSharingDialog.tsx
    export-contrast.ts

  settings/
    AppearanceSettings.tsx
    ShortcutSettings.tsx
    OnboardingSettings.tsx
```

Refactoring requirements:

- Replace `any` props with typed interfaces.
- Move autosave into a dedicated persistence hook.
- Move keyboard shortcuts into a dedicated hook.
- Centralize project and collection updates.
- Centralize collection archive rules.
- Add typed domain errors for save, export, migration, and conflict states.
- Keep future sync adapters outside the renderer.

## Phase 9 — Reliability and external-change preparation

No cloud service, login system, or sync UI should be implemented now.

Prepare for future asynchronous sync by:

- Keeping immutable internal IDs.
- Separating user-facing names from IDs.
- Keeping project data portable and file-based.
- Adding timestamps to project, collection, and screenshot changes.
- Keeping persistence behind an adapter boundary.
- Watching project files for external changes.
- Debouncing filesystem events.
- Offering `Reload external changes` when safe.
- Prompting before replacing locally unsaved changes.
- Preserving both versions when conflicts occur.

Conflict copies should:

- Stay in the same collection.
- Receive a clear name such as `Copy conflict`.
- Display a visible conflict indicator.
- Be crossed out/excluded from export by default.
- Remain editable.
- Let the user decide which version to keep or delete.

If a save fails, Imnota should:

- Keep the user on the affected screenshot.
- Identify the screenshot by title, filename, and Picture number where available.
- Preserve unsaved edits in recovery storage.
- Prevent copy/export from using stale content.
- Provide a detailed retryable error.

## Phase 10 — Testing and user feedback

### Functional tests

Add tests for:

- Pasting opens the newest screenshot.
- Importing appends in supplied order.
- New collections start empty.
- Creating a new collection archives the previous collection.
- Archived collections can be restored.
- Screenshot numbering happens only during export.
- Reordering preserves internal IDs.
- Hidden screenshots remain in Markdown as exclusions.
- Text annotation numbering is scoped per screenshot.
- Text boxes are created on double-click.
- Text editing returns to Select / Move after confirmation.
- Edge auto-pan works.
- Export bounds include outside-canvas annotations.
- Prompt splitting keeps content readable.
- Export filenames are Windows-safe.
- Cancelled exports remove incomplete files.
- Save errors identify the affected screenshot.
- Individual screenshot deletion moves files to system trash.
- Undo restores a deleted screenshot where supported.
- Conflict copies are excluded by default.
- Theme changes preserve readability.
- Onboarding does not reappear after updates.
- Shortcut conflicts and reset behavior work.

### Visual and responsive checks

Add visual regression coverage for:

- Welcome screen.
- Empty library.
- Project library.
- Workspace with both panels open.
- Workspace with either panel collapsed.
- Context Builder.
- Settings.
- Light theme.
- Dark theme.
- Curated color presets.
- Glass mode and solid fallback.
- Sharing dialog with one bundle.
- Sharing dialog with multiple bundles.
- Save failure state.
- Conflict copy state.

Target sizes:

- 13-inch laptop layout.
- 16-inch laptop around 1440×900 or 1536×960.
- Standard desktop around 1920×1080.
- Ultrawide around 3440×1440.

The smallest fully usable layout should target a 13-inch laptop. Phone, iPad, and web layouts are out of scope for now.

### Performance checks

Validate collections with:

- 1–10 screenshots as the normal case.
- 20 screenshots as the high-volume case.
- 100 screenshots as the stress case.
- Mixed 1920×1080, 2560×1600, and 3840×2160 source images.
- Many text annotations and expanded export bounds.

Profile:

- Screenshot loading.
- Thumbnail generation.
- Canvas interaction.
- Prompt bundle rendering.
- Clipboard preparation.
- Memory usage during multi-bundle exports.
- Renderer bundle size.

### User feedback loop

After the local workflow is stable:

1. Recruit several developers and QA testers.
2. Give them three tasks:
   - Import and annotate a screenshot.
   - Organize several screenshots into a collection.
   - Copy a generated prompt bundle into an external AI coding tool.
3. Observe where they hesitate or misunderstand the UI.
4. Collect feedback on readability, copy behavior, splitting, and export usefulness.
5. Fix the most common friction points before adding new product surface area.

Do not add telemetry by default. Feedback should initially be collected manually or through an explicit opt-in mechanism.

## Recommended implementation order

1. Update the data model and migration rules.
2. Fix paste/import activation and sortable screenshot behavior.
3. Implement collection naming, archive, restore, and visibility controls.
4. Simplify the inspector to Title, Description, Priority for agent, and visibility.
5. Rework the annotation toolbar and double-click text workflow.
6. Implement edge auto-pan and export bounds around outside-canvas annotations.
7. Build the prompt bundle generator and dynamic Markdown output.
8. Build the sharing dialog with prompt cards, previews, progress, cancellation, and fallbacks.
9. Add automatic splitting and timestamped exports.
10. Add light/dark contrast normalization and curated themes.
11. Add onboarding and configurable shortcuts.
12. Refactor `App.tsx` into focused modules.
13. Add visual regression, performance, migration, and conflict tests.
14. Run real user feedback sessions.

## Explicitly out of scope for now

Do not build in this implementation cycle:

- Native AI provider integrations.
- Cloud sync.
- Team accounts.
- Real-time collaboration.
- Monetization.
- Built-in screen capture.
- PDF export.
- Mobile or iPad layouts.
- Individual annotated PNG exports for every screenshot.
- Rich Markdown formatting controls.
- Manual prompt split controls.
- Arbitrary custom theme editing.
- Tag management.
- Screenshot status workflows.
- Two-way Markdown synchronization.

The first milestone is a reliable, local, open-source workflow that turns a collection of screenshots into clear, high-resolution, agent-ready prompt bundles that users can copy into any coding tool.

## Feature plan — drawings and text blocks

### Product goal

Allow users to build a complete explanation for an AI coding agent in one local collection. A collection can contain screenshots, architecture drawings, and written Markdown in one deliberate sequence:

```text
Text block → Drawing → Text block → Screenshot
```

Drawings are useful for architecture, flows, state diagrams, and rough design ideas. Text blocks provide the surrounding explanation. Both should be as easy to add, rearrange, save, hide, duplicate, and export as screenshots.

This feature remains local-first and agent-agnostic. It must not require a native integration with a specific AI provider.

### Agreed product decisions

- Screenshots, drawings, and text blocks share one ordered list per collection.
- The collection order controls Markdown order and the order of exported visual assets.
- Text blocks contain only body content. Users write Markdown directly; there is no separate title field.
- Text blocks should have an edit/preview experience, with the source Markdown remaining authoritative.
- Drawings use an essential Excalidraw-style tool set rather than the full Excalidraw feature set in the first version.
- The initial drawing tools are select/move, rectangle, rounded rectangle, ellipse, diamond, container/group, text, arrow/connector, freehand line, zoom/pan, and undo/redo.
- Connectors attach to shapes and remain attached when shapes move.
- A drawing has no separate description field. Explanations belong in adjacent text blocks.
- Each drawing saves editable JSON plus a rendered PNG in the collection work tree.
- The JSON should use an Excalidraw-compatible direction so import/export can be added later without replacing the storage model.
- Rendered drawing PNGs use a white background, automatic content cropping, and a small padding margin.
- All three item types support include/exclude visibility.
- All three item types support drag-and-drop reordering, deletion with Undo, duplication, and debounced autosave.
- Copy context includes generated Markdown plus the rendered PNGs for included screenshots and drawings. Text blocks do not create image assets.
- Markdown labels drawings explicitly, for example `Drawing 1 — Application architecture`, while screenshots remain labeled as pictures.

### Proposed content model

Replace screenshot-only collection ordering with a collection content-item list, while preserving screenshot compatibility during migration. The exact TypeScript shape should be finalized against the existing persistence and conflict model before implementation.

```ts
type ContentItemKind = 'screenshot' | 'drawing' | 'text';

interface ContentItemBase {
  id: string;
  collectionId: string;
  kind: ContentItemKind;
  position: number;
  includeInExport: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DrawingRecord extends ContentItemBase {
  kind: 'drawing';
  title: string;
  sourceFilename: string; // editable Excalidraw-compatible JSON
  imageFilename: string; // rendered PNG used by export/copy context
}

interface TextBlockRecord extends ContentItemBase {
  kind: 'text';
  markdownFilename: string;
}
```

Possible implementation strategies are:

1. Introduce a new `contentItems` array and keep `screenshots` temporarily as a compatibility projection.
2. Generalize the existing screenshot record into a discriminated visual/content record.

Choose the strategy that minimizes data duplication and keeps existing screenshot recovery, conflict detection, and migration behavior safe. Do not force drawing or text-only fields into `ScreenshotRecord` just to avoid a schema change.

### Work-tree layout

New files should live under the existing collection directory structure and use safe, validated filenames. A possible layout is:

```text
collections/
  <collection-id>/
    screenshots/
    annotations/
    descriptions/
    drawings/
      <drawing-filename>.json
      <drawing-filename>.png
    text/
      <text-block-filename>.md
```

The implementation should use the same path validation, atomic writes, revision checks, recovery journal, and trash/Undo conventions already used for screenshots. Drawing JSON and rendered PNG must be committed together where possible so a project cannot point to an editable drawing without its image counterpart.

### User workflow

#### Adding content

- Add `Drawing` and `Text` actions to the collection rail.
- `Add drawing` creates a new drawing at the end of the collection, opens the drawing editor, and focuses it.
- `Add text` creates a new text block at the end of the collection and focuses its editor.
- New items receive stable IDs and the next collection position.
- New items are included in export by default.

#### Editing content

- Text editing supports direct Markdown input and an optional preview toggle.
- Drawing editing supports the agreed essential tools and architecture-diagram connectors.
- Edits autosave with a small `Saving…` / `Saved` indicator.
- Save failures identify the affected item and preserve unsaved in-memory content for retry.
- Reopening a project restores each item and its last persisted content.

#### Organizing content

- The collection rail displays a clear type indicator for screenshot, drawing, or text.
- Drag-and-drop works across all item types.
- Position changes preserve stable item IDs.
- Visibility controls are available directly on each row.
- Hidden items remain editable and reorderable but are omitted from visual export and marked as intentionally excluded in Markdown.

#### Deleting and duplicating

- Delete uses the existing recoverable trash workflow and offers Undo.
- Deleting an item removes its metadata and associated content files together.
- Duplicating a drawing copies its editable JSON and PNG, assigning new filenames and a new stable ID.
- Duplicating a text block copies its Markdown file and creates a new position.
- Duplicate items should be included by default unless existing conflict rules require otherwise.

### Markdown and export behavior

Update Markdown generation to iterate over the ordered collection content items.

- Text blocks emit their Markdown body verbatim in sequence.
- Drawings emit an explicit drawing heading and reference their rendered PNG.
- Screenshots retain their existing picture heading and annotation/description behavior.
- Hidden items remain represented textually with an exclusion statement.
- Picture numbering and drawing numbering must be deterministic and documented. Prefer numbering visual items in collection order while retaining explicit type labels, unless existing prompt consumers require separate counters.
- Text-only collections must produce valid Markdown and must not attempt to create an empty image bundle.
- Copy context must provide Markdown and all included rendered visual assets.
- Package export must include Markdown, screenshot assets, drawing PNGs, and editable drawing JSON files.

Add tests for mixed sequences, text-only collections, drawing-only collections, hidden items, reordered items, and duplicate items.

### Migration and compatibility

- Existing schema version 3 projects with screenshots must open unchanged.
- Migration should create the new content ordering from existing screenshot positions.
- Existing screenshot IDs, filenames, annotations, descriptions, and ordering must remain stable.
- New projects should use the generalized content model from creation.
- If a compatibility projection is used, define one authoritative ordering source and test that saves cannot silently diverge.
- Increment the schema version only when the final model is chosen.
- Preserve a migration backup and retain the existing recovery behavior if migration fails.
- Do not migrate old screenshot notes into text blocks automatically unless there is a clear, lossless mapping; preserve the current description migration rules.

### Native bridge and persistence work

Add bridge operations for the smallest safe set of native mutations, likely including:

- Create a drawing.
- Load drawing source and rendered image.
- Save drawing source and rendered image atomically.
- Create, load, and save a text block.
- Reorder content items.
- Duplicate a drawing or text block.
- Delete and undo-delete a drawing or text block.

The bridge must validate project ownership, collection membership, filenames, content sizes, and revisions in the same way as existing screenshot operations. Renderer code should not write directly to the work tree.

### Rendering architecture

- Keep drawing source state separate from the rendered PNG cache.
- Render from the canonical drawing JSON after edits and before export.
- Use white as the export background regardless of the application theme.
- Calculate drawing bounds from visible drawing elements and add a small fixed padding margin.
- Ensure text, connectors, grouped shapes, and freehand paths are included in bounds.
- Avoid rendering empty or invisible elements into the exported crop.
- Keep the editor theme-aware, while keeping exported drawing output stable and readable.

### UI states and accessibility

Cover at minimum:

- Empty collection with Add drawing and Add text actions.
- Newly created drawing with an empty canvas.
- Newly created empty text block.
- Saving and saved states.
- Save failure with retry.
- Hidden item styling and accessible visibility labels.
- Dragging, drop target, and keyboard-reorder states.
- Deletion confirmation according to the existing preference, plus Undo notification.
- Loading and malformed-content recovery states.
- Light and dark application themes.
- Keyboard focus and shortcuts for the drawing tools and text editor.
- Reduced-motion behavior for drawers, notifications, and editor transitions.

### Testing plan

#### Shared and renderer tests

- Schema validation for drawing and text records.
- Migration from screenshot-only schema 3 projects.
- Stable ordering across mixed item types.
- Visibility filtering and exclusion Markdown.
- Text Markdown source and preview behavior.
- Drawing JSON load/save round trips.
- Connector attachment when a shape moves.
- Drawing bounds and PNG rendering with text, groups, and connectors.
- Autosave debounce, retry, and stale revision handling.
- Duplicate, delete, Undo, and recovery behavior.
- Markdown and package export for every item combination.
- Copy-context behavior with and without visual assets.

#### Electron and smoke tests

Extend the existing workflow coverage to:

1. Create a project and collection.
2. Add a text block and enter Markdown.
3. Add a drawing and create connected architecture shapes.
4. Add or import a screenshot.
5. Reorder the three item types.
6. Hide one item.
7. Close and reopen the project.
8. Confirm content and ordering.
9. Copy context and export a package.
10. Duplicate and delete items, then Undo deletion.

### Recommended implementation order for this feature

1. Decide and document the authoritative generalized content model.
2. Add schema versioning, migration, and path helpers.
3. Add native bridge persistence with atomic/revision-safe transactions.
4. Add text blocks and mixed-item ordering first.
5. Update collection rail, visibility, duplicate, delete, Undo, and autosave behavior for all item types.
6. Build the essential drawing editor and Excalidraw-compatible source format.
7. Add connector attachment and shape/group behavior.
8. Add deterministic drawing PNG rendering and automatic cropping.
9. Update Markdown, copy context, package export, and previews.
10. Add migration, renderer, Electron smoke, and performance tests.
11. Manually verify the complete mixed-content workflow on light and dark themes.

### Explicit non-goals for the first version

- Full Excalidraw feature parity.
- Importing `.excalidraw` files.
- Exporting `.excalidraw` files through the UI.
- Rich-text controls for text blocks.
- Separate drawing descriptions.
- Separate drawing or text collections.
- Cloud sync or collaboration.
- AI-generated diagrams or automatic diagram interpretation.
- PDF/SVG export.
- Mobile or web-specific drawing layouts.

## Feature plan — hosted static sharing

### Product goal

Allow a user to share a finished prompt bundle through a read-only HTTPS link. The shared result is an opt-in cloud copy of the generated Markdown and visual assets; the normal Imnota project remains local-first and is never uploaded automatically.

The first deployment target is a Node.js application hosted at `app.imnota.xyz` on Hostinger. The existing `app.imnota.xyz` subdomain points to `/home/u644068606/domains/imnota.xyz/public_html/app` and is ready for application deployment.

### First-version scope

The first version shares only finalized export artifacts:

- generated Markdown;
- included prompt PNG files;
- an optional ZIP containing those artifacts.

It does not share the original project folder, source screenshots not included in the prompt, annotation JSON, recovery files, editable drawing JSON or local settings. Editable drawing sources may be added later only as an explicit sharing choice.

The recipient does not need an account. A share page provides a Markdown reading view, PNG previews/downloads and a ZIP download when available.

### Access model

Shares use unguessable random bearer tokens:

```text
https://app.imnota.xyz/s/<random-token>
```

Anyone with the complete URL can view the share. This is link privacy, not authentication. The service must:

- generate at least 128 bits of cryptographically secure token entropy;
- store a hash of the token rather than the raw token where practical;
- never use sequential or project-derived public IDs;
- support expiration, with a 30-day default for the first version;
- support immediate revocation;
- send `X-Robots-Tag: noindex, nofollow` and omit shares from sitemaps;
- avoid exposing local paths, workspace names or private project metadata;
- rate-limit public reads and all upload/session endpoints.

The share page must clearly identify that the content was intentionally published and show its expiration state.

### Upload authorization

The desktop application must not contain a permanent Hostinger API key or server secret. A distributed desktop secret could be extracted and abused for anonymous uploads.

The recommended first flow is browser pairing:

1. The user selects **Share prompt** in Imnota.
2. Imnota opens `app.imnota.xyz/new` in the default browser.
3. The service creates a short-lived, one-time pairing session.
4. The browser returns a one-time upload code or pairing token to Imnota.
5. Imnota generates the normal finalized export and uploads it over HTTPS.
6. The service returns the public share URL and expiration date.
7. Imnota displays Copy link, Open link, expiration and Revoke actions.

The pairing token must be single-use, short-lived and scoped to one upload. A future account-based flow may replace pairing, but accounts are not required for the first version.

### Service architecture

Use a small Node.js/Express service deployed to Hostinger:

- `POST /api/pairing` creates a short-lived browser/device pairing session;
- `POST /api/shares` accepts one authorized finalized bundle;
- `GET /s/:token` renders the public share page;
- `GET /s/:token/markdown` downloads the Markdown file;
- `GET /s/:token/assets/:filename` downloads an included PNG;
- `GET /s/:token/archive.zip` downloads the optional ZIP;
- `POST /api/shares/:id/revoke` revokes a share through the paired client;
- `GET /api/shares` lists shares known to the paired local client where local share metadata exists.

For the initial low-volume service, metadata can use SQLite and files can use a dedicated uploads directory outside the public document root. The server should stream files through controlled routes rather than exposing the upload directory directly. If Hostinger storage or process persistence is unsuitable, move binary artifacts to S3-compatible object storage while retaining the same API contract.

### Share record

```ts
interface ShareRecord {
  id: string;
  tokenHash: string;
  title: string;
  markdownPath: string;
  imagePaths: string[];
  archivePath?: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  byteSize: number;
}
```

The desktop project stores only local share metadata and the public URL. It must not treat a remote share as the project source of truth.

### Client workflow and failure states

The desktop sharing dialog must cover:

- privacy confirmation before upload;
- preparation of a fresh export from the latest saved state;
- upload progress and cancellation;
- pairing expired or already used;
- network failure and retry;
- file-size or server quota rejection;
- successful link copy/open;
- expiration and revoke status;
- offline use of the existing local export actions.

The UI must state which files will be uploaded and must never silently fall back from local copy to cloud sharing.

### Storage and retention

The service must enforce:

- maximum Markdown size;
- maximum image dimensions and total bundle size;
- maximum files per share;
- expiration cleanup;
- revoked-share cleanup;
- storage-usage monitoring;
- backups for metadata and a documented recovery procedure.

Expired and revoked files should be deleted by a scheduled cleanup job after a short recovery grace period. Cleanup must not remove active shares.

### Security and privacy checks

Before release, test:

- token unpredictability and no ID enumeration;
- access after expiration and revocation;
- upload authorization, replay and pairing-token reuse;
- path traversal and unsafe filenames;
- SVG/HTML/script injection through Markdown titles and text;
- oversized uploads and decompression bombs;
- content-type and download-header correctness;
- rate limits and abuse responses;
- absence of local project paths and hidden metadata in the public page;
- HTTPS, secure cookies if introduced, CSP, frame restrictions and security headers.

Markdown preview must be sanitised. Images should be served with safe content types and download names derived from validated filenames.

### Implementation order

1. Define the export artifact contract and privacy confirmation copy.
2. Create the Node.js share service and health endpoint on `app.imnota.xyz`.
3. Add pairing sessions with single-use expiry.
4. Add SQLite metadata and private artifact storage.
5. Add share creation, token lookup, public rendering, download and cleanup routes.
6. Add the desktop sharing dialog and upload client.
7. Add revoke/expiry handling and local share metadata.
8. Run security, quota, expiry and cross-platform upload tests.
9. Perform a manual end-to-end test from Windows, macOS and Linux builds.
10. Publish only after verifying that local-only workflows remain unchanged when the service is unavailable.

### Acceptance criteria

A user can select a collection, see exactly which finalized Markdown and PNG files will leave the device, approve the upload, receive a working HTTPS link, open that link in a private browser, download the artifacts, revoke the link and confirm that access is denied afterwards. An expired share behaves the same way. Existing local copy, export and project persistence continue to work with the sharing service offline.

### First-version non-goals

- recipient accounts;
- editing shared content;
- comments or collaboration;
- public search or share discovery;
- project-folder synchronization;
- sharing recovery files or local project metadata;
- permanent links with no expiration;
- permanent anonymous upload credentials;
- analytics or tracking by default.
