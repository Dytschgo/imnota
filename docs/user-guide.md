# User guide

Imnota turns screenshots, Markdown text blocks and drawings in one collection into local Markdown + PNG prompt bundles. Local copy/export works offline. Optional hosted links upload approved final artifacts; Imnota does not synchronize editable projects or call an AI provider.

## Start a project and collection

Choose a workspace folder, then create or open a project. Collections replace the older Subfolder and feedback-round terminology.

- A new project begins with an empty collection unless you choose a template.
- A new collection starts empty and becomes the active collection.
- Creating a newer collection archives the previous one. Archived collections remain available in the chooser and can be restored.
- Renaming a collection changes its visible name, not its internal identity or folder references.
- Imnota restores the last-opened collection when the project is reopened and selects its first screenshot.

Overall context is optional and applies to the active collection. Prompt 1 contains it in full; later prompts briefly point back to Prompt 1 instead of duplicating it.

Use the plus button beside **Projects** to create a project from the sidebar. Choose a predefined icon in the new-project dialog. **Edit project** on a project row changes its name, description and icon without renaming its folder.

**Archive project** hides the project from the active library and ordinary search without deleting its files. Undo reverses the action. Open **Archived projects** to search archived projects or restore one to the active library.

### Start from a template

The new-project dialog also has five optional templates: Bug report, UI review, Feature request, Design-to-code brief and Architecture handoff. Blank project is selected by default. A template creates ordered Markdown blocks that you can edit, reorder, duplicate or delete. Later changes to bundled templates do not rewrite existing projects.

## Navigate and search

The toolbar **Back** button returns to earlier app locations, including the project, collection and item you were viewing before Settings. **Forward** becomes available after going back; navigating somewhere new clears the forward history. Navigation saves pending work before leaving it.

Choose **Search** to find project and collection information, screenshot descriptions, annotation text, Markdown text blocks and drawing text. Results include context and open the matching item; annotation results reveal the matching mark on the canvas. Search reads local saved text, not text inside screenshot pixels. Archived projects have a separate search scope.

Search reports when its limits or unavailable files prevent complete results. Content files over 2 MB are skipped; each request also limits the number of projects, file operations and total bytes read. Project files remain unchanged by searching.

## Add items

The collection rail’s primary action is **Add screenshot**. The adjacent menu adds a pasted clipboard image, a drawing, or a Markdown text block. Settings → Shortcuts → Combined Add item button restores the previous single Add item menu.

Paste, drop or import still appends screenshots in the order supplied by the operating system or file picker, makes the newest imported screenshot active and opens it for annotation.

## Add and organize screenshots

Each screenshot has:

- An editable title that initially uses the original filename.
- One optional Description field. It accepts directly typed basic Markdown and preserves line breaks.
- Low, Medium or High priority for the agent. Medium is the default. Priority is written to Markdown and never reorders screenshots.
- An eye/crossed-eye control for prompt export. An excluded screenshot stays selectable and editable.

Drag screenshot rows to change their order. Internal IDs remain stable; `Picture 1`, `Picture 2` and so on are assigned from the current order only when exporting.

Deleting a screenshot moves its source image, annotations and description to the operating-system trash. Imnota retains a local recovery snapshot for Undo; it does not require the operating system to provide a restore API. The original trashed copy may remain in the system trash after Undo. This is different from crossing out a screenshot, which keeps it in place and records an exclusion in generated Markdown.

## Capture an image (experimental)

Enable region capture in Settings > Shortcuts > Experimental capture; the toggle shows the shortcut that is currently active (default `Ctrl+Shift+5`, `⌘⇧5` on macOS). With a project open, use Capture screen region in the collection toolbar, **Take screenshot** in the collection rail's Add menu (both the Add screenshot dropdown and the combined Add item menu), or that shortcut while Imnota is focused. All entry points share the same enablement; the menu item explains why capture is unavailable. The toolbar button keeps working when no shortcut is set. To change a shortcut, click its recorder, wait for “Press keys…”, then press the combination; the saved keys appear in the button. Combinations other apps commonly use, such as `Ctrl+Shift+S` on Windows, are explained and need a second press to confirm. Each row also offers Reset to default and Clear. The toolbar delay menu offers **Capture in 3 seconds** and **Capture in 5 seconds**; the Add menu offers **Take screenshot in 3 seconds** and **Take screenshot in 5 seconds**. Imnota hides first, then waits so hover menus and tooltips can appear, then opens the region overlay. Press Escape or Cancel during that countdown to abort; no overlay opens and no file is created. The focused shortcut still captures immediately. On Windows with more than one display, those entry points open a display chooser first. Capture then uses only the display you choose, including its bounds and scaling; it does not silently fall back to the primary display. A single Windows display skips the chooser. macOS still captures the display under the pointer. Drag a rectangle on the overlay, then choose Save, Retake or Cancel. Saving adds a PNG screenshot to the active collection for annotation and export.

Capture is off by default. It captures one region on one display, with no video, GIF conversion or background global shortcut. macOS requires Screen Recording permission. If capture is unavailable or permission is denied, use the operating system's screenshot tool and Import or Paste. Linux capture is disabled. Retina and mixed-DPI setups still need platform verification.

## Add text blocks and drawings

Text blocks contain Markdown and can be edited or previewed. Drawings use the embedded Excalidraw editor and save an editable local JSON source together with a rendered PNG used by exports. A drawing also has an optional Description that is written into prompt Markdown under that drawing. Both item types can be reordered with screenshots, included or excluded, duplicated, deleted with Undo and autosaved.

The mixed collection order is authoritative for Markdown and visual export. Text blocks do not create image assets; included screenshots and drawings do. The current drawing editor intentionally supports a focused toolset. Full `.excalidraw` import/export compatibility is planned separately.

## Annotate

Select / Move is the default tool. Drag empty screenshot space to pan; drag an annotation to move only that annotation. The primary toolbar contains Select / Move, Text, Arrow, Rectangle, Highlight and Note / Step. Less common tools are under More tools, and tooltips show their purpose and shortcut.

Double-click the screenshot to create a text box and type immediately. Enter confirms, Shift+Enter inserts a line, and Escape cancels. After confirmation, Imnota returns to Select / Move. Text notes are numbered within their screenshot, such as `Picture 2 / Note 1`. Visual-only marks remain visible in the PNG but are not converted to Markdown geometry.

The application selects semantic annotation colors for the active theme; a compact palette allows overrides. This affects the live canvas. Prompt PNG rendering separately corrects contrast for a white export background without modifying the source screenshot or saved annotation intent.

## Copy prompt bundles

Choose **Copy Bundle** in the active collection's toolbar to open the sharing dialog, then choose the bundle to copy. Each card shows a preview and a **Bundle 1**, **Bundle 2**, etc. heading. Dimensions and counts are under **Bundle details**.

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

The green **Copy Bundle** button below the image copies Markdown and PNG together. It turns gray after copying and remains available to copy again. Its dropdown offers **Copy Markdown** and **Copy PNG** separately. After a combined copy Imnota reads the clipboard back and reports what the operating system kept: the card says **Markdown + image prepared** only when both formats are confirmed, and otherwise names the missing format and the separate copy to use for it (Windows in particular may keep only one). Some receiving apps still paste only one format even when both are present; use the separate options or attach the saved PNG when needed. Text-only bundles copy Markdown without an image.

Markdown copy works without generating an image first. The fallback actions also provide generated files and their plain-text paths. Copying file paths does not place file attachments on the clipboard. If the source changes after preparation, prepare fresh files before using them. Imnota reports what it copied, not whether another app accepted it.

## Share a hosted link

Choose **Share online**, check the bundle, and optionally enter your name. Imnota remembers the name on this device; you can edit or clear it in **Settings → Sharing**. New links expire after **1 day** by default; 7, 14 and 30 days are also available. Every new desktop share includes a downloadable ZIP. Turn on **I understand** to confirm that everyone with the link can open the bundle. This acknowledgement resets for each share.

Choose **Create link**. Imnota handles pairing and returns a link to copy or open. **Pairing code**, beside Back and Create link, opens the manual fallback when needed. Local copy and export remain available offline. **Open files** prepares the export if needed before opening it, without changing the clipboard.

The shared page shows your name when supplied, for example, “Dylan shared this prompt bundle with you.” Use **Copy Bundle** at the top or below an image, its dropdown for individual formats, and **Download ZIP** for the complete share. For a multi-bundle share, select the bundle at the top; each copy uses its matching Markdown and PNG. Older shares without bundle metadata still include the full share Markdown with each image, as explained in **Copying help**. Downloads remain available if clipboard access fails.

Open **Settings → Sharing** to copy, open or revoke links created on this device, even when no bundle is open. You can also use **Revoke link** on the share result or in **Your shared links**. Revocation cannot remove copies someone already saved. **Retry recovery** checks uploads interrupted by a network failure. **Dismiss** remembers the specific warning across dialog reopening and app restarts without deleting history or recovery information. A different failure or a new failed upload can still show a warning.

Editable drawing sources, original project folders, local paths and recovery journals are not uploaded. Inspect the generated content itself before sharing: annotations, screenshot pixels and Markdown can contain sensitive information even when project metadata is excluded. The hosting provider may retain access logs; see the [service privacy and operations notes](../share-service/docs/hostinger-deployment.md).

## Manage the sharing site

The site owner can sign in at [app.imnota.xyz/owner](https://app.imnota.xyz/owner) with the private owner access key. The dashboard lists hosted shares, filters active/expired/revoked links, and lets the owner revoke access. It is not a public account system.

Usage counts start when this feature is deployed. They count successful page loads and Markdown, PNG and ZIP requests, not unique people. PNGs can load automatically when a page opens, and copying can request files too. No visitor IP addresses or browser identifiers are stored by these counters. Entries and counts disappear when the share is removed by the existing expiry/revocation cleanup policy.

## Local backup and version history

Open Settings > Backups & history. Select a project and choose Create snapshot to save its metadata, original screenshots, annotations, descriptions, Markdown and drawing files. Generated exports and recovery caches are excluded.

Automatic history is off by default. When enabled, it creates snapshots before project-format migrations and whole-project deletion, not after every edit. Use Create snapshot to keep a particular version.

The default location is `.imnota-backups` inside the workspace, outside individual projects. Change location selects a different parent folder without moving existing snapshots. Choose a separate drive for protection against failure of the project drive. Default retention is 20 snapshots per project and a maximum age of 90 days. Cleanup runs after snapshot creation and leaves invalid or unregistered snapshots untouched.

Select a snapshot to validate its files and inspect its date, reason, size and schema. Restore as new project leaves the original untouched. Export archive saves a ZIP containing the manifest and a `data/` folder; after extraction, `data/` is the project folder. Archive export is capped at 256 MiB of snapshot content. Copy larger snapshots as folders.

Restore in place asks for confirmation and creates a safety snapshot first. Imnota also retains the complete pre-restore folder, including extra files, and displays its recovery path. Retention does not remove these rollback folders. Reopening the workspace attempts recovery of an interrupted restore and preserves ambiguous recovery files. If restoration succeeds but opening fails, use Retry opening project instead of repeating the restore.

## Appearance, settings and onboarding

Appearance follows the operating-system theme by default. Settings also provides Light, Dark and curated color presets. Glass is cosmetic, respects reduced-transparency preferences and falls back to solid surfaces when transparency is unavailable or reduced.

You can use the same background for both themes or choose separate Light and Dark images and opacity. Existing backgrounds remain shared until you change this option. **No image** applies to the selected theme when using separate backgrounds. System mode uses the background for the current operating-system theme. Reading surfaces keep a protective light or dark background over wallpaper; **Solid** removes transparency. These preferences do not change the white background of exported bundles. Settings categories scroll with the page.

Onboarding appears only for a genuinely new local application profile. It uses an isolated demo project, never the real workspace, and covers importing, annotating and copying a prompt bundle. Completion is stored with local application settings rather than project files, so normal updates do not show it again. Replay it at any time from Settings.

Keyboard shortcuts are configurable in Settings with Windows/macOS-aware defaults, conflict explanations and Reset to defaults. Mouse controls remain available for the complete workflow.

## Updates

Installed builds check the selected channel (Stable or Nightly) shortly after Imnota starts and about once an hour while it stays open. These background checks are discovery only: when a newer version exists, a download indicator appears beside **About** in the workspace navigation (lower-left when navigation is hidden) showing the channel and version. Nothing downloads or installs until you choose **Download update** there or in Settings > Updates & about, where you can also check manually and switch channels. Background checks stay quiet while discovery is offline; a manual check reports the failure. If preparing a discovered update fails, Imnota clears the download action and shows a retry message.
