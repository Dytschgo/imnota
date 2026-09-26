# User guide

Imnota turns screenshots, Markdown text blocks and drawings in one collection into local Markdown + PNG prompt bundles. Local copy/export works offline. Optional hosted links upload approved final artifacts; Imnota does not synchronize editable projects or call an AI provider.

## Start a project and collection

Choose a workspace folder, then create or open a project. Collections replace the older Subfolder and feedback-round terminology.

Generated names such as `Imnota / Collection 01` display as `Collection 01` when the project is directly inside the `Imnota` workspace. Breadcrumbs, Recent, Favourites and the collection chooser use the same label. Stored names and the rename field remain unchanged. Custom names stay intact, and the prefix remains when shortening would duplicate another collection name, including an archived collection. A moved project with an old workspace prefix keeps that prefix until you rename the collection.

The sidebar keeps Projects and Archived in its main navigation. Use **View all recent** and **View all favourites** beneath the quick lists to open those pages, or use their keyboard shortcuts. Archiving or restoring a collection updates both quick lists immediately; archived collections stay out of the lists until restored.

- A new project begins with an empty collection unless you choose a template.
- A new collection starts empty and becomes the active collection.
- Creating a newer collection archives the previous one. Archived collections remain available in the chooser and can be restored. Each row of the chooser carries a status icon (outlined while active, filled once archived) and its own rename and archive or restore buttons.
- Renaming a collection changes its visible name, not its internal identity or folder references.
- Imnota restores the last-opened collection when the project is reopened and selects its first screenshot.

Overall context is optional and applies to the active collection. Prompt 1 contains it in full; later prompts briefly point back to Prompt 1 instead of duplicating it.

Use the plus button beside **Projects** to create a project from the sidebar. Choose a predefined icon in the new-project dialog. **Edit project** on a project row changes its name, description and icon without renaming its folder.

Each project row ends with icon buttons for edit, archive or restore, and delete. **Archive project** hides the project from the active library and ordinary search without deleting its files. Undo reverses the action. Open **Archived projects** to search archived projects or restore one to the active library. **Delete project** asks for confirmation, then moves the whole project folder to the operating-system trash.

### Start from a template

The new-project dialog also has five optional templates: Bug report, UI review, Feature request, Design-to-code brief and Architecture handoff. Blank project is selected by default. A template creates ordered Markdown blocks that you can edit, reorder, duplicate or delete. Later changes to bundled templates do not rewrite existing projects.

## Navigate and search

The toolbar **Back** button returns to earlier app locations. Settings has its own category rail and a back arrow beside its title; that arrow returns to the prior location, including the project, collection and item you were viewing. **Forward** becomes available after going back; navigating somewhere new clears the forward history. Navigation saves pending work before leaving it.

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

## Capture an image

Screen capture is a stable feature. It is on by default for new Windows and macOS profiles; saved profile values remain unchanged. Toggle it in **Settings → Features**. Linux remains Import or Paste. The active shortcut is shown in **Settings → Shortcuts** (default `Ctrl+Shift+5`, `⌃⇧5` on macOS — Control, not Command). With a project open, use **Capture area** in the collection toolbar, **Take screenshot** in the collection rail's Add menu, or that shortcut. While capture is on, Windows and macOS also register the shortcut in the background, including when Imnota is unfocused or minimized. The background shortcut is not registered when capture is off, on Linux, or when the operating system already owns the combination (for example an explicitly saved `⌘⇧5` on macOS). If another app has already taken the keys, Settings says the background shortcut is not active; the focused-window shortcut still works. The toolbar and Add menu require a current collection. The shortcut can start without one: it keeps the PNG in memory, restores the last-used current collection when that collection is still valid, and otherwise brings Imnota forward and asks where to save it; Cancel discards the capture. The menu item and the shortcut explain why capture is unavailable instead of doing nothing. The toolbar button keeps working when no shortcut is set. To change a shortcut, click its recorder, wait for “Press keys…”, then press the combination; the saved keys appear in the button. Combinations other apps commonly use, such as `Ctrl+Shift+S` on Windows, are explained and need a second press to confirm. Each row also offers Reset to default and Clear, which register or unregister the background shortcut. Existing custom bindings are preserved; on macOS, Reset to default selects `⌃⇧5` if an older `⌘⇧5` binding was saved explicitly. On Windows and macOS, capture opens the area overlay directly across all connected displays. There is no monitor chooser. Drag on any screen or across screen boundaries to select the area. Each overlay keeps its captured still on screen, so hover menus and dropdowns stay visible while you select. If a display cannot be captured or the layout changes during capture, Imnota stops with an error instead of silently omitting a screen.

Choose an immediate capture or a 3- or 5-second delay from the capture delay control beside the camera action. Imnota hides first, then waits so hover menus and tooltips can appear, then opens the area overlay. Press Escape or Cancel during that countdown to abort; no overlay opens and no file is created. The shortcut still captures immediately.

The overlay defaults to Area. Drag a rectangle, choose Window and click a window if Imnota can identify one, or choose Display to capture that whole screen including the taskbar or dock. Then choose **Save to collection**, **Annotate** (save and open the canvas with the last drawing tool), **Copy image** (image-only clipboard; the overlay stays open so you can still save or discard), **Retake**, or **Cancel**. Cancel and overlay close create no files. Each saved mode adds one PNG to the active collection through the same capture save path. Window capture is best-effort: if the operating system cannot identify windows, the overlay explains this and Area stays available. It does not silently capture the whole display instead.

While Imnota is running, a tray icon (Windows and Linux) or menu-bar extra (macOS) offers Capture area, Capture window on Windows, Capture display, and Open Imnota. Those actions share capture enablement with the toolbar. Closing or hiding the main window does not unregister the capture shortcut while the tray is still running.

Repeat last area recaptures the same rectangle as the last successful area in this session, including areas spanning screens. Use Repeat last captured area (default `Ctrl+Shift+6`, `⌘⇧6` on macOS) while Imnota is focused, or Last area in the capture overlay. If this session has no successful area yet, Imnota explains that and does not start a capture. If the display layout has changed, capture a new area first; Imnota does not move or clip the remembered rectangle onto a different screen. Window and full-display captures do not replace the remembered area.

New Windows and macOS profiles have capture on; existing profiles keep their saved value. Linux stays Import or Paste. It captures one area, window or display, with no video or GIF conversion. macOS requires Screen Recording permission. If capture is unavailable or permission is denied, use the operating system's screenshot tool and Import or Paste. Linux capture is disabled. Retina and mixed-DPI setups still need platform verification.

## Add text blocks and drawings

Text blocks contain Markdown and can be edited or previewed. Drawings use the embedded Excalidraw editor and save an editable local JSON source together with a rendered PNG used by exports. A drawing also has an optional Description that is written into prompt Markdown under that drawing. Both item types can be reordered with screenshots, included or excluded, duplicated, deleted with Undo and autosaved.

The mixed collection order is authoritative for Markdown and visual export. Text blocks do not create image assets; included screenshots and drawings do. The current drawing editor intentionally supports a focused toolset. Full `.excalidraw` import/export compatibility is planned separately.

## Annotate

Select / Move is the default tool. Drag empty screenshot space to pan; drag an annotation to move only that annotation. The primary toolbar contains Select / Move, Text, Arrow, Rectangle, Highlight and Note / Step. Less common tools are under More tools, and tooltips show their purpose and shortcut.

Double-click the screenshot to create a text box and type immediately. Enter confirms, Shift+Enter inserts a line, and Escape cancels. After confirmation, Imnota returns to Select / Move. Text notes are numbered within their screenshot, such as `Picture 2 / Note 1`. Visual marks such as arrows, boxes and steps also appear under `Picture N / Marks` with kind, id and position as percentages of the source image. Crop stays an image operation, and redaction marks are omitted so Markdown does not outline secrets.

The application selects semantic annotation colors for the active theme; a compact palette allows overrides. This affects the live canvas. Prompt PNG rendering separately corrects contrast for a white export background without modifying the source screenshot or saved annotation intent.

## Copy prompt bundles

Choose **Copy Bundle** in the active collection's toolbar to open the sharing dialog, then choose the bundle to copy. Each card shows a preview, a **Bundle 1**, **Bundle 2**, etc. heading, and one line with its pictures, counts, dimensions and estimated size. The card's menu holds the single-format copies; **Copy Markdown only**, **Copy image only**, **Open files** and **Copy file paths** also appear inline when a bundle is file-only or a copy reported a problem.

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

A screenshot needs neither a description nor an annotation. Its minimal Markdown still includes its title, Picture number, priority and source pixel width × height.

When **Settings → Features → Include recognised text in Markdown** is enabled, Copy Bundle also runs on-device OCR and appends a `### Visible text` section when text is found. This beta feature is off by default. Recognition stays on this device; it is not written into descriptions or `project.json`. A crop is honoured so only the exported region is read. Screenshots with blur or pixelate marks omit Visible text so redacted pixels are not transcribed. OCR failure never blocks Copy Bundle. Windows uses the system OCR engine (`Windows.Media.Ocr`), downscales captures that exceed that engine’s size limit, and bounds each recognition so Copy Bundle is not blocked for long. Encoded screenshots larger than 20 MB skip Visible text. Linux and other platforms skip OCR without sending screenshot pixels.

When a screenshot has visual annotations, Markdown lists them under `### Picture N / Marks` so arrows, boxes and steps are available as geometry, not only in the PNG. Text and callout notes remain under `### Picture N / Note N`. Crop is applied to the image rather than listed, and blur or pixelate marks are omitted:

```md
### Picture 2 / Marks

- arrow `a1` from 12.0%,40.0% to 71.5%,41.2%
- rectangle `r4` at 68.0%,38.0% 18.0%×10.0%
- step `s2` number 1 at 70.0%,40.0%
```

On Windows the green primary button is **Copy files** by default (the generated `.md` and `.png` as two files). Change it to **Rich copy** or **Files + rich copy** from the copy menu or Settings → Sharing. On macOS the primary action is **Rich copy**. **Rich copy** writes Markdown, HTML and a prompt PNG to the clipboard in one operation, then reads the clipboard back and names the formats the operating system actually kept. The card says **Markdown + image prepared** only when both text and image are confirmed. If a format is missing, the card names it and points to **Copy Markdown only**, **Copy image only** or **Open files**. Windows in particular may keep only one format. Imnota cannot promise that both formats will arrive in the receiving app; some apps paste only text or only the image even when both are present on the clipboard. Use **Copy Markdown only**, **Copy image only**, **Open files**, **Copy file paths** or **Open export folder** when a target accepts only one format. Text-only bundles copy Markdown without an image. The button turns gray after copying and remains available to copy again.

Markdown copy works without generating an image first. Reopening Share bundles after a copy shows **Loading saved bundles** while checking the saved content, then restores the existing cards without generation progress when the collection is unchanged. Repeating **Rich copy** or a Windows copy variant shows **Copying** and reuses the generated files, including after retrying a failed clipboard copy. A changed collection creates fresh files before the primary copy. **Prepare fresh files** always generates a new export. Copying file paths does not place file attachments on the clipboard. If the source changes after preparation, prepare fresh files before using a single-format fallback. Imnota reports what the clipboard held after the write, not whether another app accepted it.

## Local agent access

Off by default. The beta **Settings → Features → MCP access** toggle lets any MCP-capable coding agent read prepared prompt bundles from the selected workspace without a clipboard paste. Imnota starts no listener until the toggle is on, and the listener binds only to `127.0.0.1` (or a spawned `--mcp` stdio process). There is no public HTTP server, account, or hosted model call.

Agents can list projects, read collection items, search saved text, and load the latest export. They cannot run Copy Bundle for you: if no export exists, the tool returns `bundle not prepared`. Recovery journals, backups, and hosted-share secrets are not exposed.

Choose **Copy prompt** in Settings and paste it into your agent; the prompt carries the server address, the stdio alternative, the tool list, and the instruction for the agent to write its own MCP configuration. A configuration reference with generic `mcpServers` entries sits below it. Optional skill and rule files live in the repository (`docs/claude-code-imnota-skill.md`, `docs/cursor-imnota-rule.md`); Imnota does not write agent configuration. See [Local agent access](agent-access.md).

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

Onboarding appears only for a genuinely new local application profile. It uses an isolated demo project, never the real workspace, and walks through adding a screenshot, annotating it, adding Markdown, and copying the prompt bundle through the same native copy path as Copy Bundle. The guide reports the formats the clipboard actually kept; after the first copy attempt it shows the fallbacks (**Copy Markdown only**, **Copy image only**, **Open files**, **Copy file paths**, **Open export folder**), highlighted when a format is missing. On Windows the dropdown attached to the copy button chooses the saved copy format. It does not write files into the workspace. Skip remains available. Completion is stored with local application settings rather than project files, so normal updates do not show it again. Replay it at any time from Settings.

Keyboard shortcuts are configurable in Settings with Windows/macOS-aware defaults, conflict explanations and Reset to defaults. Mouse controls remain available for the complete workflow.

## Updates

A compact update control stays beside **About** in the workspace navigation. When navigation is hidden, it sits in the top bar beside Show navigation / Back. It is always available: refresh when you are on the latest version or have not checked yet, a disabled progress state while checking or downloading, download when an update is ready, restart/install after the file is downloaded, and retry after a failure. Hover the control for the current status and, when a release is available, its notes. Nothing downloads or installs until you choose that action.

Installed builds also check the selected channel (Stable or Nightly) shortly after Imnota starts and about once an hour while it stays open. Those background checks are discovery only. They stay quiet while discovery is offline; a manual check reports the failure. If preparing a discovered update fails, Imnota clears the download action and shows a retry message. Switch channels and check again in Settings → Updates & about → App updates. Nightly is labeled as a preview. Checking contacts GitHub for release information only; your project files stay local.

After you start a newer installed version, **What’s new** appears once for that version with a short summary and screenshots when they are bundled. Nightly notes are labeled as preview. Choose **Try it now** to open a related setting or the onboarding guide, or **Later** / dismiss to keep working. Missing screenshots do not block startup. Imnota stores that you have seen this version in local application settings, not in project files, and will not show it again until a newer version is installed. Replay the same notes from Settings → Updates & about.

### Saved export presets

In Settings > Sharing, set the primary copy action and whether to include recognised text, then enter a name under Export presets and choose **Save current options**. Choose a saved preset and **Apply preset** to restore both options together. On platforms without native file clipboard support, presets use rich copy (text and image). The receiving app still decides which formats to accept.

Up to 20 uniquely named presets are stored on this device in application preferences. Removing a preset leaves the current export options unchanged. Presets do not change project content, annotation styling, bundle size, or sharing permissions. If saving fails, the previous preferences remain active and the name stays available for retry.
