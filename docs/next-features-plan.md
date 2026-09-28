# Next features plan

Status: proposal, drafted 2026-09-26 against v0.3.0. This plan does not authorize implementation. Each feature needs its own scope decision, and items marked **roadmap decision** also need an entry in the [product roadmap](product-roadmap.md) before work starts, because they add a new product surface or an outward-facing action (see [AGENTS.md](../AGENTS.md#scope-and-safety)).

The eight features extend the existing workflow rather than replace it:

```text
Capture (region, window, display, scrolling, clip) -> redact -> explain -> hand off (copy, agent, issue, link)
```

## Order and dependencies

| Milestone | Features                                                                                | Why this order                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | Quick-access overlay, on-device OCR on macOS and Linux, automatic redaction suggestions | Shortest path from capture to paste. OCR with word boxes is the prerequisite for redaction, and redaction makes every later hand-off safer. |
| B         | One-click agent hand-off (MCP and CLI), scrolling capture                               | Builds on the shipped MCP server and capture pipeline. No new outward-facing service.                                                       |
| C         | Short clips turned into key frames                                                      | Needs the capture pipeline plus frame analysis; larger scope.                                                                               |
| D         | Browser context capture, issue creation                                                 | New surfaces (browser extension, third-party accounts). Both need roadmap decisions. Issue images build on hosted sharing.                  |

Shared foundations, built once:

1. **OCR engine interface** with word-level bounding boxes (used by OCR export, redaction, search and key frames).
2. **Capture session pipeline** that can produce one image, a stitched image, or a frame sequence.
3. **Hand-off targets** as one abstraction: clipboard, files, MCP, CLI, issue tracker, hosted link.

## 1. Quick-access overlay after capture

**Outcome:** after a capture, a small floating card shows the result. The user can copy, annotate, add it to the current collection, or discard it without switching to the full workbench.

**Current state:** the capture overlay already offers save, annotate, copy and discard while the overlay is open. The gap is a persistent, non-modal card after the overlay closes, similar to CleanShot X's quick-access overlay.

**Design**

- A frameless, always-on-top `BrowserWindow` in a screen corner (configurable: left, right, or off), one card per capture and at most three stacked.
- Actions: **Copy image**, **Copy with collection context** (runs the existing prompt-bundle copy), **Annotate** (opens a compact editor that reuses `AnnotationCanvas`), **Add to collection**, **Drag out** (native file drag of the PNG) and **Discard**.
- The card auto-hides after a timeout that the user can set (off, 10 s, 30 s) and pauses while hovered. Keyboard: Enter copies, E annotates, Esc dismisses.
- Unsaved captures stay in the existing buffered-capture memory (`commitBufferedCapture`, `discardBufferedCapture`). Nothing is written to the project until the user chooses **Add**, so the current capture-commit guard and admission rules still apply.

**Slices:** (1) card window plus copy, add and discard; (2) drag-out and settings; (3) compact annotate.

**Verification:** application tier for the card UI; platform tier for window placement across displays and DPI, focus stealing, and macOS Spaces and full-screen behaviour. Extend `capture-smoke` to drive the card.

**Risks:** focus and always-on-top rules differ per OS. Linux Wayland may not allow corner placement; fall back to opening the main window there.

## 2. On-device OCR on macOS and Linux

**Outcome:** the recognised-text export option and every OCR-based feature work on all three desktop platforms, with no network access.

**Current state:** `electron/windows-ocr.ts` uses the Windows OCR engine. The preload hard-codes `onDeviceOcrAvailable = process.platform === 'win32'`.

**Design**

- Add a shared `OcrEngine` interface in `electron/ocr/`: `available()`, `recognize(png, { timeoutMs, languages })`, returning lines and words with pixel bounding boxes and confidence. Move the Windows implementation behind it.
- **macOS:** a small bundled Swift helper (universal binary, ad-hoc signed with the app) that calls the Vision framework's `VNRecognizeTextRequest`. It reads PNG bytes from stdin and writes JSON to stdout, and `execFile` runs it with a timeout. No permissions prompt is needed.
- **Linux:** use `tesseract` when it is installed (`tesseract stdin stdout tsv`). If it is missing, report the capability as unavailable and link to install instructions. Do not bundle the language data, which would add about 30 MB or more.
- Report capability through `getNativeCapabilities` instead of the platform constant, so the UI shows the true state.
- Keep the existing decision: recognition is scoped to the export, runs only on exported pixels, is never persisted and never runs in the background. Redacted screenshots are still skipped.

**Slices:** (1) interface plus Windows move (mechanical); (2) macOS helper, packaging and signing; (3) Linux tesseract adapter; (4) capability-driven UI.

**Verification:** platform tier on each OS, including the packaged helper's signature and architecture checks in the macOS verifier. Fixture: the existing `windows-ocr-readable-text.png` plus a synthetic multi-language fixture.

## 3. Automatic redaction of secrets and personal data

**Outcome:** before anything leaves the device, Imnota points out likely secrets or personal data in screenshots and text blocks and offers to mask them. The user always decides.

**Design**

- **Detectors** (pure functions in `src/shared/redaction/`, fully unit-tested):
  - secrets: AWS access keys, GitHub, GitLab, Slack and Stripe tokens, JWTs, PEM private-key headers, `password=`/`api_key=` assignments, and generic high-entropy strings above a length and entropy threshold;
  - personal data: email addresses, phone numbers, payment card numbers (with a Luhn check), IBANs (with mod-97), IPv4/IPv6 addresses, and URLs carrying `token`, `code` or `session` query parameters.
- **Screenshots:** run OCR (feature 2), match detectors against words and lines, and turn matches into **suggested** mask annotations of the existing redaction kinds. Suggestions are drawn dashed and must be accepted per item or with **Accept all**. Detection runs on demand or when the screenshot is opened, never in the background across the workspace.
- **Text blocks and descriptions:** inline highlights with a "mask" action that replaces the match with `[redacted email]`, and so on.
- **Pre-hand-off check:** when copying, sharing or creating an issue, a non-blocking banner reports unresolved findings ("2 possible secrets in Picture 3") with **Review** and **Continue anyway**. Hosted share uploads require an explicit confirmation when findings remain.
- Findings are never persisted beyond the accepted annotations, and there is no telemetry.

**Slices:** (1) detector library and tests; (2) text-block findings; (3) screenshot suggestions via OCR boxes; (4) pre-hand-off banner.

**Verification:** application tier. Keep a table-driven fixture corpus containing true positives and near-miss negatives (UUIDs, hashes in commit lists, and so on) to hold down false positives. Measure OCR-to-suggestion latency on 4K screenshots.

**Risks:** false confidence. The UI must say "suggestions" and never claim that a screenshot is clean.

## 4. One-click hand-off to agents

**Outcome:** an agent such as Claude Code or Cursor can fetch the current collection's bundle directly, and the user can hand it off with one action instead of pasting.

**Current state:** the optional local MCP server (`electron/mcp-server.ts`) is read-only, runs on loopback only, and lists already-prepared bundles. The `--mcp` flag starts a stdio session.

**Design**

- **MCP v2 tools** (still read-only by default):
  - `get_latest_bundle({ project?, collection? })` returns the Markdown plus the PNGs as MCP image content;
  - `list_projects` and `list_collections`;
  - `get_bundle({ id })`.
  - A separate, off-by-default **"Allow agents to prepare bundles"** setting enables `prepare_bundle({ collection })`, which writes only into the collection's `exports/` folder through the existing `PromptBundleWorkflow`.
- **CLI:** `imnota bundle latest --json`, `imnota bundle get <id> --out <dir>`, `imnota projects`. It is implemented as `--cli` arguments to the existing executable, reusing the stdio path. Settings offers an optional PATH shim (a symlink or `.cmd` wrapper) and never edits shell profiles.
- **Send to agent** in the copy dialog: copies a one-line instruction such as `Use the imnota MCP tool get_bundle with id …` together with the bundle files, and shows setup help when agent access is off.

**Slices:** (1) MCP read tools; (2) CLI; (3) Send-to-agent action; (4) opt-in `prepare_bundle`.

**Verification:** application tier plus real loopback and stdio tests, as for the current MCP server. Needs an independent security review for `prepare_bundle` and the PATH shim.

## 5. Scrolling capture

**Outcome:** capture a region taller than the screen, such as a long page, chat or log, as one stitched PNG.

**Design**

- The user selects a region with the existing overlay and chooses **Scrolling**. Imnota captures frames of that region at about 8 fps while the **user** scrolls. It does not inject scroll input, which avoids macOS Accessibility permissions. **Done** or Esc finishes.
- **Stitching** runs in a worker:
  1. downscale to grayscale;
  2. detect static top and bottom bands (sticky headers and footers) and exclude them from matching;
  3. find the vertical offset between consecutive frames by minimising row differences within the expected scroll range;
  4. append only the new rows;
  5. drop frames with no movement.
- Enforce the existing `MAX_CAPTURE_PIXELS` and cap height at a documented limit. Show a live preview strip and warn when the cap is hit.
- Output is a normal screenshot item, so annotation, OCR, redaction and export work unchanged.

**Slices:** (1) stitching algorithm with synthetic fixtures (pure, deterministic); (2) capture session and preview; (3) overlay integration.

**Verification:** application tier for stitching using generated fixtures (sticky header, horizontal jitter, zero-movement frames); platform tier for frame capture across DPI settings. Linux Wayland portal capture may be unavailable; report the capability honestly.

## 6. Browser context capture (**roadmap decision**)

**Outcome:** a companion browser extension captures the visible tab together with developer context (URL, viewport, console errors, failed requests, selected element) and sends it to the local app as one collection item.

**Design**

- A Chromium Manifest V3 extension first, with Firefox later. It captures:
  - the tab through `chrome.tabs.captureVisibleTab`;
  - URL, title, viewport, device pixel ratio and user agent;
  - console errors and unhandled rejections through a content script (only for tabs where the user activates it);
  - failed requests (status 400 or higher, or a network error) through `webRequest`, recording only method, URL, status and timing, never headers, cookies or bodies;
  - an optional element picker that records a CSS selector and a truncated `outerHTML`.
- **Transport:** Chrome native messaging to the installed Imnota executable (`--native-messaging`), which forwards to the running app. It does **not** use HTTP to localhost; this keeps the rule that the MCP server rejects browser origins.
- **Privacy defaults:** strip query strings and fragments unless the user keeps them, run the redaction detectors (feature 3) over the captured text, and show a review step in the app before anything is stored.
- **Data model:** a screenshot item plus a `context.json` sidecar (a schema bump with migration). Export adds a `## Browser context` section per picture.

**Slices:** (1) sidecar schema and export section; (2) native messaging host and installer registration per OS; (3) extension capture; (4) console and network capture; (5) element picker; (6) store publication.

**Verification:** platform tier (native-messaging host registration differs by OS and browser) plus a security review of the host.

## 7. Issue creation (**roadmap decision**)

**Outcome:** create a GitHub or Linear issue from the current collection, with a preview and explicit confirmation.

**Design**

- **GitHub first:** authenticate through the user's existing `gh` CLI session when it is available, otherwise through GitHub device-flow OAuth. Store tokens only through Electron `safeStorage`.
- **Linear second:** a personal API key stored with `safeStorage`.
- **Dialog:** target repository or team, title (defaults to the collection name), body (the bundle Markdown), labels, and a mandatory **Preview**. Nothing is sent without pressing **Create issue**.
- **Images:** GitHub's API has no supported upload for issue attachments. The options are to include hosted-share links, which build on the sharing feature (the image stays under the user's expiring, revocable link), or to send text only with a note. Linear uses its upload API for real attachments.
- The redaction pre-check (feature 3) runs before preview, and the local sharing history records the created issue URL.

**Slices:** (1) target abstraction and preview; (2) GitHub with `gh` and device flow; (3) hosted-link image embedding; (4) Linear.

**Verification:** application tier with mocked APIs; a manual end-to-end check against a disposable repository. Needs security review for token storage.

## 8. Short clips turned into key frames

**Outcome:** record a short clip (up to 30 s) of a region to show a transition, animation or bug. Imnota extracts the frames that matter as ordered screenshots an AI can read.

**Design**

- Record through `desktopCapturer` and `MediaRecorder` in the capture window, region-cropped. There is no audio, the default limit is 30 s, and the timer is visible.
- **Frame selection** runs in a worker:
  1. sample at 5 fps;
  2. compute a perceptual difference on downscaled grayscale frames;
  3. select the first frame, the last frame, and frames after significant change once the screen has settled for a few samples;
  4. cap the result at 8 by default and let the user adjust it with a timeline strip.
- **Output:** selected frames become screenshot items tagged with their timestamp (`t = 3.2 s`), plus an optional contact-sheet PNG. The video is discarded by default; an explicit option keeps the WebM in the collection's `clips/` folder.
- **Export:** "Frames from a 12-second recording", with each frame's timestamp and the time elapsed since the previous frame.

**Slices:** (1) frame-selection algorithm with synthetic fixtures; (2) recorder; (3) timeline review UI; (4) export wording.

**Verification:** application tier for selection; platform tier for recording, including macOS Screen Recording permission and Linux portal behaviour. Memory budget: frames are streamed, never all decoded at once.

## Cross-cutting acceptance

- Local-first boundary is preserved: no feature adds telemetry, a required account or hosted AI calls. Features 6 and 7 connect only after explicit user setup.
- Each outward-facing action (issue creation, hosted link, extension capture) shows a preview and needs explicit confirmation.
- New project data (the `context.json` sidecar and `clips/`) goes through a schema bump with migration, backup inclusion and recovery tests.
- Each feature updates the [user guide](user-guide.md), the [implementation status](implementation-plan.md) and the changelog when it ships.
