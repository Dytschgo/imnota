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

Open the sharing dialog from the active collection. Each card shows a preview and a **Bundle 1**, **Bundle 2**, etc. heading. Dimensions and counts are under **Bundle details**.

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

The green **Copy Bundle** button below the image copies Markdown and PNG together. It turns gray after copying and remains available to copy again. Its dropdown offers **Copy Markdown** and **Copy PNG** separately. Some receiving apps paste only one format; use the separate options or attach the saved PNG when needed. Text-only bundles copy Markdown without an image.

## Share a hosted link

Choose **Share online**, check the bundle, and optionally enter your name. Imnota remembers the name on this device; you can edit or clear it in **Settings → Sharing**. New links expire after **1 day** by default; 7, 14 and 30 days are also available. Every new desktop share includes a downloadable ZIP. Turn on **I understand** to confirm that everyone with the link can open the bundle. This acknowledgement resets for each share.

Choose **Create link**. Imnota handles pairing and returns a link to copy or open. **Pairing code**, beside Back and Create link, opens the manual fallback when needed. Local copy and export remain available offline. **Open files** prepares the export if needed before opening it, without changing the clipboard.

The shared page shows your name when supplied, for example, “Dylan shared this prompt bundle with you.” Use **Copy Bundle** at the top or below an image, its dropdown for individual formats, and **Download ZIP** for the complete share. For a multi-bundle share, select the bundle at the top; each copy uses its matching Markdown and PNG. Older shares without bundle metadata still include the full share Markdown with each image, as explained in **Copying help**. Downloads remain available if clipboard access fails.

Open **Settings → Sharing** to copy, open or revoke links created on this device, even when no bundle is open. You can also use **Revoke link** on the share result or in **Your shared links**. Revocation cannot remove copies someone already saved. **Retry recovery** checks uploads interrupted by a network failure. **Dismiss** remembers the specific warning across dialog reopening and app restarts without deleting history or recovery information. A different failure or a new failed upload can still show a warning.

Editable drawing sources, original project folders, local paths and recovery journals are not uploaded. Inspect the generated content itself before sharing: annotations, screenshot pixels and Markdown can contain sensitive information even when project metadata is excluded. The hosting provider may retain access logs; see the [service privacy and operations notes](../share-service/docs/hostinger-deployment.md).

## Manage the sharing site

The site owner can sign in at [app.imnota.xyz/owner](https://app.imnota.xyz/owner) with the private owner access key. The dashboard lists hosted shares, filters active/expired/revoked links, and lets the owner revoke access. It is not a public account system.

Usage counts start when this feature is deployed. They count successful page loads and Markdown, PNG and ZIP requests, not unique people. PNGs can load automatically when a page opens, and copying can request files too. No visitor IP addresses or browser identifiers are stored by these counters. Entries and counts disappear when the share is removed by the existing expiry/revocation cleanup policy.

## Appearance, settings and onboarding

Appearance follows the operating-system theme by default. Settings also provides Light, Dark and curated color presets. Glass is cosmetic, respects reduced-transparency preferences and falls back to solid surfaces when transparency is unavailable or reduced.

Onboarding appears only for a genuinely new local application profile. It uses an isolated demo project, never the real workspace, and covers importing, annotating and copying a prompt bundle. Completion is stored with local application settings rather than project files, so normal updates do not show it again. Replay it at any time from Settings.

Keyboard shortcuts are configurable in Settings with Windows/macOS-aware defaults, conflict explanations and Reset to defaults. Mouse controls remain available for the complete workflow.
