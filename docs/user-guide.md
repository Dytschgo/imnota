# User guide

Imnota turns screenshots, Markdown text blocks and drawings in one collection into local Markdown + PNG prompt bundles. It does not upload projects, call an AI provider or synchronize through a cloud service.

## Start a project and collection

Choose a workspace folder, then create or open a project. Collections replace the older Subfolder and feedback-round terminology.

- A new project begins with an empty collection.
- A new collection starts empty and becomes the active collection.
- Creating a newer collection archives the previous one. Archived collections remain available in the chooser and can be restored.
- Renaming a collection changes its visible name, not its internal identity or folder references.
- Imnota restores the last-opened collection when the project is reopened and selects its first screenshot.

Overall context is optional and applies to the active collection. Prompt 1 contains it in full; later prompts briefly point back to Prompt 1 instead of duplicating it.

## Add items

The collection rail’s primary action is **Add screenshot**. It imports PNG, JPEG or WebP files. The adjacent menu adds a pasted clipboard image, a drawing, or a Markdown text block. Settings → Editing & shortcuts → Separate add buttons restores the previous four-button row.

Paste, drop or import still appends screenshots in the order supplied by the operating system or file picker, makes the newest imported screenshot active and opens it for annotation.

## Add and organize screenshots

Each screenshot has:

- An editable title that initially uses the original filename.
- One optional Description field. It accepts directly typed basic Markdown and preserves line breaks.
- Low, Medium or High priority for the agent. Medium is the default. Priority is written to Markdown and never reorders screenshots.
- An eye/crossed-eye control for prompt export. An excluded screenshot stays selectable and editable.

Drag screenshot rows to change their order. Internal IDs remain stable; `Picture 1`, `Picture 2` and so on are assigned from the current order only when exporting.

Deleting a screenshot moves its source image, annotations and description to the operating-system trash. Imnota retains a local recovery snapshot for Undo; it does not require the operating system to provide a restore API. The original trashed copy may remain in the system trash after Undo. This is different from crossing out a screenshot, which keeps it in place and records an exclusion in generated Markdown.

## Add text blocks and drawings

Text blocks are Markdown and appear in collection order in the prompt. Drawings use the embedded editor and save an editable local JSON source plus a rendered PNG for export. Both types can be reordered with screenshots, included or excluded, duplicated, and deleted with Undo.

A drawing has a title and an optional Description. The description is written into prompt Markdown under that drawing. Deleting a drawing or text block asks for confirmation in the app (when Confirm before deletion is on) and does not show a second operating-system dialog.

## Annotate

Select / Move is the default tool. Drag empty screenshot space to pan; drag an annotation to move only that annotation. The toolbar shows as many annotation tools as the current width allows and moves the rest into More tools. Tooltips show each tool’s purpose and shortcut.

Double-click the screenshot to create a text box and type immediately. Enter confirms, Shift+Enter inserts a line, and Escape cancels. After confirmation, Imnota returns to Select / Move. Text notes are numbered within their screenshot, such as `Picture 2 / Note 1`. Visual-only marks remain visible in the PNG but are not converted to Markdown geometry.

The application selects semantic annotation colors for the active theme; a compact palette allows overrides. This affects the live canvas. Prompt PNG rendering separately corrects contrast for a white export background without modifying the source screenshot or saved annotation intent.

## Copy prompt bundles

Open the sharing dialog from the active collection. Each card represents one generated prompt and shows its preview, prompt number, screenshot count, excluded count, estimated size and any readability warning.

Copying a prompt creates a fresh timestamped export from the latest saved state. Only the current collection is included. Each bundle contains a matching `.png` and `.md` file:

```text
Collection 02 - 260907-184205 - 01.png
Collection 02 - 260907-184205 - 01.md
```

Prompt PNGs use a white background, full-width labelled screenshots, expanded bounds for annotations outside the source image and a safety margin. Imnota chooses split points automatically when dimensions, pixel count, memory, clipboard safety or text readability require more than one bundle. Original Picture numbers are preserved across split bundles.

An excluded screenshot is omitted from every prompt PNG but noted in Markdown, for example:

```md
Picture 3 was intentionally excluded from this prompt bundle.
```

A screenshot needs neither a description nor an annotation. Its minimal Markdown still includes its title, Picture number and priority.

The combined Copy action writes Markdown and a PNG to the clipboard together. Operating systems and receiving editors negotiate clipboard formats differently, so a successful copy does not prove that the target accepted both. If only one arrives, use Copy Markdown only and Copy image only, or open the generated files/folder and attach the PNG manually. Record what each editor accepts in the [clipboard receiver matrix](clipboard-receiver-matrix.md).

## Appearance, settings and onboarding

Appearance follows the operating-system theme by default. Settings also provides Light, Dark and curated color presets. Glass is cosmetic, respects reduced-transparency preferences and falls back to solid surfaces when transparency is unavailable or reduced.

Onboarding appears only for a genuinely new local application profile. It uses an isolated demo project, never the real workspace, and covers importing, annotating and copying a prompt bundle. Completion is stored with local application settings rather than project files, so normal updates do not show it again. Replay it at any time from Settings.

Keyboard shortcuts are configurable in Settings with Windows/macOS-aware defaults, conflict explanations and Reset to defaults. Mouse controls remain available for the complete workflow.
