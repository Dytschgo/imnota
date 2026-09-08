# User guide

Imnota turns screenshots, Markdown text blocks and drawings in one collection into local Markdown + PNG prompt bundles. Local copy/export works offline. Optional hosted links upload approved final artifacts; Imnota does not synchronize editable projects or call an AI provider.

## Start a project and collection

Choose a workspace folder, then create or open a project. Collections replace the older Subfolder and feedback-round terminology.

- A new project begins with an empty collection.
- A new collection starts empty and becomes the active collection.
- Creating a newer collection archives the previous one. Archived collections remain available in the chooser and can be restored.
- Renaming a collection changes its visible name, not its internal identity or folder references.
- Imnota restores the last-opened collection when the project is reopened and selects its first screenshot.

Overall context is optional and applies to the active collection. Prompt 1 contains it in full; later prompts briefly point back to Prompt 1 instead of duplicating it.

## Add and organize screenshots

Paste, drop or import PNG, JPEG or WebP images. Imnota appends them in the order supplied by the operating system or file picker, makes the newest imported screenshot active and opens it for annotation.

Each screenshot has:

- An editable title that initially uses the original filename.
- One optional Description field. It accepts directly typed basic Markdown and preserves line breaks.
- Low, Medium or High priority for the agent. Medium is the default. Priority is written to Markdown and never reorders screenshots.
- An eye/crossed-eye control for prompt export. An excluded screenshot stays selectable and editable.

Drag screenshot rows to change their order. Internal IDs remain stable; `Picture 1`, `Picture 2` and so on are assigned from the current order only when exporting.

Deleting a screenshot moves its source image, annotations and description to the operating-system trash. Imnota retains a local recovery snapshot for Undo; it does not require the operating system to provide a restore API. The original trashed copy may remain in the system trash after Undo. This is different from crossing out a screenshot, which keeps it in place and records an exclusion in generated Markdown.

## Add text blocks and drawings

Text blocks contain Markdown and can be edited or previewed. Drawings use the embedded Excalidraw editor and save an editable local JSON source together with a rendered PNG used by exports. Both item types can be reordered with screenshots, included or excluded, duplicated, deleted with Undo and autosaved.

The mixed collection order is authoritative for Markdown and visual export. Text blocks do not create image assets; included screenshots and drawings do. The current drawing editor intentionally supports a focused toolset. Full `.excalidraw` import/export compatibility is planned separately.

## Annotate

Select / Move is the default tool. Drag empty screenshot space to pan; drag an annotation to move only that annotation. The primary toolbar contains Select / Move, Text, Arrow, Rectangle, Highlight and Note / Step. Less common tools are under More tools, and tooltips show their purpose and shortcut.

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

The combined Copy action writes Markdown and a PNG to the clipboard together. Operating systems and receiving editors negotiate clipboard formats differently, so a successful copy does not prove that the target accepted both. If only one arrives, use Copy Markdown only and Copy image only, or open the generated files/folder and attach the PNG manually.

## Share a hosted link

In the prompt sharing dialog, choose **Share online**. Review the exact generated PNG/Markdown files, choose 7, 14 or 30 days, and optionally include a downloadable ZIP. Confirm that anyone with the link may read the approved files.

Choose **Open pairing page**, obtain a one-use code in the browser, and paste it into Imnota. The code expires after about 10 minutes. **Publish HTTPS link** uploads the approved artifacts and returns a link you can copy or open. Local copy and export remain available without pairing or internet access.

On the shared page, use **Copy Markdown**, **Copy PNG**, or **Copy PNG + Markdown** beside an image. Combined copy contains that PNG and the share's full Markdown. If the receiving editor pastes only one format, use the separate buttons. Downloads remain available when the browser denies clipboard access or does not support it.

Use **Revoke link** on the result or in local share history to stop access. Expired and revoked links cannot be reopened through the service. Revocation cannot remove files a recipient has already downloaded or copied. The app retains pending-upload information to recover a response interrupted by a network failure. **Retry recovery** checks those uploads again; **Dismiss** clears the visible warnings without deleting history or pending recovery information. Warnings refresh after a successful upload and may return if an unresolved upload still fails recovery.

Editable drawing sources, original project folders, local paths and recovery journals are not uploaded. Inspect the generated content itself before sharing: annotations, screenshot pixels and Markdown can contain sensitive information even when project metadata is excluded. The hosting provider may retain access logs; see the [service privacy and operations notes](../share-service/docs/hostinger-deployment.md).

## Appearance, settings and onboarding

Appearance follows the operating-system theme by default. Settings also provides Light, Dark and curated color presets. Glass is cosmetic, respects reduced-transparency preferences and falls back to solid surfaces when transparency is unavailable or reduced.

Onboarding appears only for a genuinely new local application profile. It uses an isolated demo project, never the real workspace, and covers importing, annotating and copying a prompt bundle. Completion is stored with local application settings rather than project files, so normal updates do not show it again. Replay it at any time from Settings.

Keyboard shortcuts are configurable in Settings with Windows/macOS-aware defaults, conflict explanations and Reset to defaults. Mouse controls remain available for the complete workflow.
