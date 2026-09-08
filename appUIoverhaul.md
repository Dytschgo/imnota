# Imnota UI Overhaul Plan

**Status:** Implementation in progress on `feature/ui-overhaul-20260908`, based on `origin/main` at `3475c2d`. The original audit below is retained as the design brief; the execution notes supersede its assumptions about missing service code.

**Audit date:** 2026-09-08

**Scope:** Imnota desktop app, `imnota.xyz` marketing site, hosted sharing/pairing surface at `app.imnota.xyz`, and a new owner/operator backend for the private share service.

## Execution notes

The user authorized implementation and a new PR on 2026-09-08. Current main already includes the hosted service, owner session authentication, share revocation, request counters, and Sharing settings. This implementation extends those surfaces and preserves their security and storage contracts.

- Desktop: collection breadcrumbs/counts, primary bundle action, grouped add/tool menus, context/export inspector sections, separated destructive actions, settings navigation and empty-workspace guidance.
- Hosted service: a useful root page, guided pairing with expiry/retry/manual copy, clearer shared-bundle summary and download hierarchy, and an actionable unavailable-link page.
- Owner console: existing authenticated access is retained; operational navigation, share inspection, lifecycle filtering and actual storage/pairing aggregates replace the flat list presentation.
- Typography remains locally available/offline safe. Existing retention defaults are preserved rather than changing them to the original plan's illustrative values.
- The generated comps are design references. Their invented recipient columns, dates, storage numbers, and edit actions are not feature requirements.
- The source/deployment project for the separate `imnota.xyz` marketing site is not in this repository. Its broader page restructuring remains a separate implementation; this PR covers `app.imnota.xyz` and the desktop app.
- Browser pairing has no upload-status subscription contract. The page directs users to Imnota for actual progress and the resulting link instead of claiming to detect upload/consumption.
- Manual cleanup, a persistent operational audit/event log, and owner session-level pairing revocation require additional backend contracts. The console must expose only supported data/actions and explain configured retention.

Validation and remaining coverage will be recorded in `docs/ui-overhaul/implementation.md` after final integration. No merge or production deployment is authorized by this PR request.

## Outcome

Make Imnota feel like a deliberate visual handoff workbench rather than a collection of capable panels. A new user should understand the product in seconds, add a first screenshot without hunting through the interface, annotate it with confidence, and know exactly what will be copied or shared.

The overhaul should preserve the current strengths:

- local-first storage and offline operation;
- screenshots, drawings, and text blocks in ordered collections;
- annotation tools, redaction/pixelation, crop, undo/redo, zoom, and keyboard support;
- title, description, priority, inclusion, duplicate, and delete controls;
- Markdown/PNG prompt bundles;
- optional hosted sharing with explicit privacy boundaries.

The design work should improve hierarchy, discoverability, feedback, and trust without introducing accounts, cloud sync, AI-provider UI, telemetry, or a visual redesign that makes the product look like a generic AI dashboard.

## 1. Audit snapshot

| Surface           | What exists today                                                                                                 | Main friction                                                                                                                                                                                | Design direction                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop workbench | A functional global sidebar, collection rail, annotation canvas/editor, and inspector                             | The three levels compete equally. Many controls are small, icon-only, and visually flat. The next useful action is not always obvious.                                                       | Establish a clear `evidence → context → handoff` hierarchy, with progressive disclosure and one persistent primary action.                                |
| Collection rail   | Ordered screenshot/drawing/text items, drag reorder, visibility, context, add actions                             | Item type, inclusion, and add actions are easy to miss. Four add buttons have similar weight.                                                                                                | Make the collection a visible handoff outline: item count, included count, type labels, reorder affordances, and one `Add item` entry point.              |
| Canvas toolbar    | Select/move, text, arrow, rectangle, highlight, note/step, advanced tools, color, undo/redo, zoom                 | Useful tools are mixed with transformations and view controls. `More` is doing too much.                                                                                                     | Group by task: `Annotate`, `Transform`, and `View`; keep advanced tools progressive but discoverable.                                                     |
| Inspector         | Screenshot metadata, selected-annotation settings, inclusion toggle, duplicate/delete actions                     | Metadata, annotation detail, and destructive actions read as one dense form.                                                                                                                 | Separate `Context`, `Annotation`, `Export`, and collapsed `Danger zone` sections. Keep the selected annotation visually tied to the canvas.               |
| Library/settings  | Projects, recent/favourites, workspace settings, about/update states                                              | Mostly list-and-row UI with limited orientation and weak empty/in-progress states.                                                                                                           | Add recency and status cues, stronger first-run guidance, and settings categories with summaries and disclosures.                                         |
| Public site       | Strong existing identity, real product screenshots, truthful local-first/open-source positioning                  | The page is approximately 9,600 px tall and repeats a similar editorial rhythm. The first viewport could explain the workflow and product proof more directly.                               | Keep the graphite/indigo identity and real evidence, but shorten the path to `understand → install/GitHub`; use generated concepts only as art direction. |
| Browser pairing   | `/new` is a privacy-conscious, centered one-action page with a ten-minute one-time code                           | `app.imnota.xyz/` returns `Cannot GET /`; `/new` does not visually explain the three-step pairing flow or its state changes. The current page also feels disconnected from the public brand. | Give the service a small branded shell, explicit steps, visible expiry/single-use status, and complete waiting/expired/success/error states.              |
| Owner backend     | No owner console was found in the repository; the share-service contract is described in `implementation plan.md` | Operators have no planned visual model for health, storage, shares, pairing, retention, or audit activity.                                                                                   | Add a separate, authenticated operational console based on existing service truth; keep `/health` machine-readable and do not expose secrets or content.  |

### Important live findings

- `https://imnota.xyz/` is live and already communicates the core product truth well. Its actual workbench, prompt-bundle, and drawing screenshots should remain the primary proof assets.
- `https://app.imnota.xyz/` currently has no root route. `/new` works as a pairing page, `/health` returns JSON, and `/api` returns a not-found JSON error. This is an information-architecture gap to resolve before calling the hosted surface complete.
- The current app implementation is a capable React/Electron workbench. The redesign should be a shell and interaction-hierarchy pass, not a capability rewrite.
- Existing design tokens already provide a useful foundation: graphite surfaces, indigo interaction, cyan focus/link color, semantic success/warning/danger colors, Lucide icons, and dark/light themes.

## 2. Product and user model

### Primary user

Developers, designers, and technical collaborators who need to turn a visual observation into an instruction an AI coding agent or teammate can act on.

Their recurring job is:

> Bring in visual evidence, point at what matters, describe the intended change, and produce a clean handoff without losing local control.

The UI should optimize for repeated desktop use with mouse and keyboard, not for a first-time marketing demo alone.

### Owner/operator

The owner is a low-frequency, high-consequence user of the hosted sharing service. They need to answer, quickly and safely:

- Is the service healthy?
- How much storage is being used and what is pending cleanup?
- Which shares are active, expiring, expired, or revoked?
- Are pairing sessions stuck or being abused?
- What can be revoked or cleaned up, and what will that action affect?

The owner console must show operational metadata only. It must not become a content browser for private Markdown, images, local paths, bearer tokens, or recovery data.

## 3. Design thesis and visual direction

### One-sentence thesis

**Every Imnota surface should make the same handoff legible: evidence on the left, a point of view in the middle, and a trustworthy next action on the right.**

### Design dials

- **Variance: 6/10.** Distinctive enough to feel authored; restrained enough for a tool used every day.
- **Motion: 3/10 in the app, 4/10 on the public site.** Motion explains state and relationships. It does not decorate empty space or slow down work.
- **Density: 6/10 in the app, 7/10 in the owner console, 4/10 on public pages.** Use density for useful information, not more cards.

### Signature interaction: the handoff spine

Make the relationship between a collection, its selected evidence, and the final prompt bundle visible throughout the workspace:

1. The collection rail shows the ordered evidence outline and inclusion state.
2. The canvas shows the selected evidence and annotation coordinates.
3. The inspector shows the context that will travel with that evidence.
4. `Copy prompt bundle` remains a clear, stable action in the top-level workspace chrome.

When an item is excluded, incomplete, saving, or ready, the state should be visible in more than one place but never communicated by colour alone.

### Visual language

- Keep the dark graphite foundation and existing indigo/cyan identity. Add depth through controlled surface steps, hairline borders, and small tonal shifts rather than gradients, glass, or glow.
- Use indigo for selection and primary interaction; cyan for focus, links, and relationship lines; green/amber/red for status only.
- Use one technical sans family consistently. The public site already uses a Plex-style family and the app currently uses Inter/system fallbacks. Evaluate IBM Plex Sans as the shared candidate, but bundle it or use a system fallback so the Electron app remains offline and deterministic. Do not add a remote font dependency.
- Keep monospace for commands, file-like metadata, codes, and timestamps—not for every label.
- Use Lucide icons with text or tooltips. Do not use emoji as interface icons.
- Use a restrained 4/8/12/16/24/32 spacing rhythm, 6–10 px control radii, and pill shapes only for compact status or segmented controls.
- Prefer one dominant surface per screen and one clear focal action. Avoid a catalogue of equally weighted cards.
- Add a tactile “export plane” sparingly: a light Markdown/paper-like preview can make the prompt bundle feel tangible, but it must remain a real preview of the generated output, not a decorative fake document.

### Accessibility and comfort baseline

- Maintain or exceed WCAG AA contrast for text and controls; do not use colour as the only inclusion/status signal.
- Preserve visible focus rings, with enough contrast against graphite surfaces.
- Make every icon-only action have an accessible name and tooltip.
- Keep keyboard alternatives for drag reorder, canvas actions, dialogs, and command/search access.
- Target 40–44 px hit areas for frequently used controls, even if visual glyphs are smaller.
- Ensure focus is never hidden behind drawers, sticky bars, or canvas overlays.
- Provide reduced-motion and reduced-transparency behavior. Avoid blur-heavy surfaces.
- Provide a skip/focus path in public and pairing pages; use `role="alert"` for actionable errors and explicit empty/loading copy.

## 4. Proposed information architecture

### Desktop application shell

Keep the current mental model—Library, project, collection, selected content—but make the hierarchy explicit:

```text
Global rail       Project / Collection context       Primary handoff action
Projects          Collection rail                   Canvas / editor   Inspector
Recent            Evidence outline                  Annotate          Context
Favourites        Add item                          Transform          Annotation
Settings                                             View               Export
```

Recommended changes:

- Keep `Projects`, `Recent`, `Favourites`, `Settings`, and `About`; do not introduce a new top-level concept without a product need.
- Let the global rail collapse to a compact icon rail, but retain a discoverable expand control and tooltips.
- Add an always-visible project/collection breadcrumb with a clear collection name and item count.
- Make `Copy prompt bundle` the workspace’s primary action. Keep search/command access adjacent but visually secondary.
- Treat `Open project`/`New project` as library actions, not as the dominant control once a project is open.

### Collection rail

- Header: collection name, rename/archive actions, item count, and included-in-bundle count.
- Context: keep the collection context field, but label it with its export role and show a useful placeholder such as “What should the agent understand about this collection?”
- Item list: show thumbnail/type, title, included/excluded state, priority, and a subtle selected indicator. Keep drag reorder plus explicit keyboard move actions.
- Add actions: replace four equal buttons with one prominent `Add item` menu containing `Screenshot`, `Drawing`, and `Text`, plus a secondary `Paste from clipboard` action where appropriate.
- Visibility: distinguish “included in bundle” from “visible in workspace”; a single eye icon must not carry two meanings.
- Keep archived/empty/error states in the rail rather than leaving a blank panel.

### Canvas and toolbar

Group existing capabilities by the user’s task:

- **Annotate:** Select/Move, Arrow, Rectangle/Frame, Highlight, Note, Step.
- **Transform:** Crop, Redact, Pixelate, Freehand, Line, Ellipse, Callout, Rounded rectangle.
- **View:** Undo/Redo, zoom, Fit, 1:1.

The default toolbar should show the five or six most-used annotation tools. Advanced tools remain in `More`, but the menu should be grouped, searchable by shortcut, and show destructive tools in a separated danger section. Preserve existing shortcuts and add them to tooltips or a command-reference surface.

When an annotation is selected, show a lightweight contextual strip near the canvas or inspector header with its type, colour, and the most relevant two properties. Keep the complete configuration in the inspector.

### Inspector

Reframe the current screenshot inspector into four sections:

1. **Context** — title, description, priority, and the questions the description should answer: what should change, where should the agent look, and what must stay.
2. **Annotation** — selected annotation type and properties; collapsed when nothing is selected.
3. **Export** — inclusion status, output contribution, and a compact “included/excluded” explanation.
4. **Danger zone** — duplicate, delete screenshot, and delete project, with destructive actions visually and spatially separated from normal work.

Use progressive disclosure for typography, arrowhead, opacity, pixel size, and other low-frequency properties. The user should see the useful context fields before implementation details.

### Library and settings

- Library rows should expose project name, last-used time, collection count, item count, and favourite state without inventing analytics.
- The empty library should offer a three-step first-run path: `Choose workspace → Create project → Add first screenshot`.
- Settings should use a category list: `Appearance`, `Workspace`, `Shortcuts`, `Updates`, and `About`. Each category should have grouped sections with a one-line summary and disclosure rather than a long undifferentiated form.
- Keep update/error/snapshot banners clear and interruptive only when action is required.

## 5. Core user flows

### First run

Replace a blank welcome state with a short orientation:

1. Choose workspace.
2. Create or open a project.
3. Add the first screenshot, drawing, or text block.

Include a visible drop target, the offline/local-first reassurance, and a small keyboard-shortcut hint. After the first import, move the user directly into the selected item with the context field ready to fill.

### Import and annotate

- Show a full-window drop overlay with explicit targets for a screenshot versus a project file.
- Confirm import with a toast and focus the new item in the collection rail.
- Start in Select/Move, then reveal a one-time contextual hint for the most useful annotation actions. Hints should be dismissible and never block the canvas.
- Keep autosave state visible as `Saving`, `Saved`, or `Needs attention`; avoid relying only on a tiny dot.

### Describe and export

- Focus the inspector description after an annotation is created when the user is likely to add context.
- Keep `Copy prompt bundle` visible in the top bar and repeat it in the collection/export surface only when helpful.
- The export dialog should summarize exactly what will be copied: collection context, included items, Markdown, PNGs, and optional archive. Show a clear local-only action first.
- After copy, show a durable success state with the output name and a `Reveal`/`Copy again` action if supported.
- Do not silently route local export through the hosted service. Sharing must be a separate, explicit action with a privacy confirmation.

### Share and browser pairing

Use a three-step stateful sequence on `/new`:

1. **Create code** — explain that it is one-time, expires after ten minutes, and authorizes one finalized prompt upload.
2. **Pair Imnota** — show a large, copyable/pasteable code with expiry countdown and concise instructions to paste it into the desktop app.
3. **Waiting/uploaded** — show the upload state, then the resulting share link, expiration, copy action, and revoke guidance.

Required states: initial, generating, code available, copied, expired, consumed, waiting, uploading, upload complete, network failure/retry, quota failure, and revoked/expired share. Keep the current privacy boundary visible: no project folder, recovery data, annotation source, or local settings are requested by the service.

### Owner operations

Every destructive or security-sensitive action should follow:

```text
Inspect → explain impact → confirm → execute → show audit/result → offer safe next action
```

Revoke and cleanup must never be ambiguous, and the UI should not display raw bearer tokens or private content to make an action feel concrete.

## 6. Public website direction

The current public page has a strong visual foundation and real product proof. The redesign should refine it, not replace it with a generic landing-page template.

### Above-the-fold target

Make the first viewport communicate three things in order:

1. **What:** screenshots become structured, AI-ready instructions.
2. **How:** annotate, add context, copy a prompt bundle.
3. **Why trust it:** local-first, open source, no account required.

Keep `Install Imnota` as the primary CTA and GitHub as the secondary CTA. Consider a small `Open shared prompt`/`Pair browser` entry only after the corresponding hosted route exists and its wording is truthful.

### Page structure

Shorten the current long scroll by combining repeated proof sections:

- Hero with the handoff relationship made tangible.
- One before/after proof section using real screenshots.
- One four-step workflow strip.
- Three capability details: annotations, context, prompt bundle.
- Compact local-first/file-format section.
- Installation with platform tabs and copyable commands.
- Open source, FAQ, and footer.

Use section navigation or a short progress cue if the page remains long. Keep real workbench, drawing, and prompt-export screenshots as evidence. Do not use generated UI as if it were a live product screenshot.

### Hosted root route

`app.imnota.xyz/` should become a small service landing/entry page rather than a blank 404. It can explain browser pairing and shared prompt links, offer `Pair browser`, and link back to the main site. Keep `/health` machine-readable for monitoring and out of the public navigation. Owner routes must be separately protected.

## 7. Owner backend design

The owner console is a separate operational surface, not another tab inside the end-user workbench. The exact route and authentication mechanism must be confirmed before implementation. A reasonable IA candidate is an authenticated `/owner` or `/admin` route on the service domain.

### Navigation

- Overview
- Shares
- Pairing
- Storage
- Operations

Avoid exposing owner navigation or data to anonymous share viewers. Authentication, session handling, CSRF protection, authorization, and audit requirements are implementation prerequisites, not visual details.

### Screens

#### Overview

Use one focal service-health strip, followed by the operational work that needs attention:

- service status and last check;
- recorded, metadata, reserved, and total storage where the service contract supports them;
- active, expiring, expired, and revoked share counts;
- pairing sessions waiting, consumed, and expired;
- cleanup status and the next scheduled action;
- recent sanitized operational events.

Do not build a grid of oversized metric cards or imply product analytics that the backend does not record.

#### Shares

Use a keyboard-navigable table with filters for Active, Expiring, Expired, and Revoked. Suggested columns:

- sanitized share identifier/name;
- status;
- created time;
- expiry time;
- byte size;
- included file count;
- last operational access metadata, only if the service actually records it.

Open a right-side detail drawer for lifecycle timestamps, included artifact names, size, expiry, and revoke action. Never render raw tokens, local filesystem paths, recovery metadata, or private Markdown/image contents.

#### Pairing

Show pairing sessions as a lifecycle table: Created, Waiting, Consumed, Expired, Revoked. Display created/expiry/consumed timestamps and safe revoke actions for unused sessions. Never re-display a consumed one-time code.

#### Storage and retention

Show usage breakdown, configured limits, expiration policy, cleanup schedule, and a dry-run preview of candidates. A cleanup action must state what will be removed, require explicit confirmation, and produce an auditable result. Separate expired-share cleanup from revoked-share cleanup if their retention rules differ.

#### Operations

Show sanitized rate-limit events, rejected uploads by reason, unsafe file/content-type rejections, failed cleanups, and authentication/session anomalies. Keep it operational; do not add content inspection by default.

### Owner console visual rules

- Density 7/10, but with generous row height and clear table grouping.
- Tabular numbers for size, counts, and timestamps.
- Green/amber/red status indicators must also include text and accessible labels.
- Use a right drawer for inspection so the operator keeps table context.
- Use confirmation dialogs for revoke, cleanup, and any action that changes retention state.
- Include `Synthetic demo data` in design comps and seeded previews so screenshots cannot be mistaken for production telemetry.

## 8. State and edge-case matrix

The redesign is not complete until these states have an intentional visual treatment:

| Area          | States to design                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| App boot      | Starting, ready, update available, update failed, fatal error                                                                             |
| Library       | Empty, loading, populated, workspace unavailable, project error                                                                           |
| Collection    | Empty, imported, large, archived, excluded item, failed item                                                                              |
| Canvas        | No selection, selected annotation, zoomed, image missing, narrow window                                                                   |
| Save          | Saving, saved, retryable error, conflict/external change                                                                                  |
| Export        | Preparing, progress, copied, reveal/copy again, failure/retry, unsupported/too-large bundle                                               |
| Pairing       | Code generating, available, copied, expired, consumed, waiting, upload progress, success, offline, quota failure                          |
| Share viewer  | Valid, expired, revoked, invalid token, missing asset, download failure                                                                   |
| Owner         | Loading, healthy, degraded, unavailable, storage warning/critical, no shares, cleanup running/failed, permission denied, rate-limit spike |
| Accessibility | Keyboard-only, reduced motion, reduced transparency, high zoom, focus recovery after dialog/drawer close                                  |

## 9. Image concepts and usage guidance

Three GPT Image concepts were generated for direction-setting and copied into the repository:

- [Workbench concept](docs/ui-overhaul/imnota-workbench-concept.png) — a stronger evidence/context/hand-off relationship inside the desktop app. Use it to discuss hierarchy, the persistent prompt preview, and inspector composition.
- [Public hero concept](docs/ui-overhaul/imnota-public-hero-concept.png) — a compact marketing composition showing annotation evidence flowing into a prompt bundle. Use it to discuss the public first viewport and the annotation-to-handoff visual motif.
- [Owner console concept](docs/ui-overhaul/imnota-owner-console-concept.png) — a dense but calm shares/health/storage operator view. Use it to discuss tables, status strips, drawers, and safe operational actions.

These are concept comps, not product screenshots. Their generated labels, dates, counts, and UI copy are synthetic. Production pages should use real Imnota screenshots or real data-driven components. The existing anime-style backdrop files in `public/backdrops/` should not be used for the public site or owner console; they are unrelated to the product’s evidence-first visual language.

Prompt recipe shared by the concepts:

> Product UI concept for Imnota; deep graphite surfaces; off-white text; indigo selection; cyan relationship/focus line; restrained green/amber/red status; desktop 16:10 composition; crisp technical/editorial hierarchy; no gradients, glass, glow blobs, stock photography, fake testimonials, fake metrics, real tokens, local paths, private content, or watermark.

The public-hero variation adds the exact idea “Screenshots that AI understands” and a visible Markdown/PNG prompt-bundle preview. The owner variation adds Shares, Pairing, Storage, Operations, Healthy, Cleanup, and a selected-share drawer with clearly synthetic demo data.

## 10. Implementation phases for a future build

### Phase 0 — Product and contract alignment

- Confirm the source location and deployment path for the public site.
- Confirm whether `app.imnota.xyz/` should be a public entry page and which share-viewer routes are committed.
- Define owner authentication, authorization, session expiry, and audit requirements.
- Inventory current keyboard shortcuts, export formats, share states, and supported minimum window sizes.
- Decide the bundled-font policy and document the design tokens that remain stable.

**Exit:** approved route map, capability-parity checklist, owner security boundary, and design direction.

### Phase 1 — Shared visual foundation

- Consolidate surface, border, typography, spacing, radius, focus, status, and motion tokens.
- Define dark/light behavior and the offline-safe font/icon policy.
- Add component states for buttons, icon buttons, fields, selects, tabs, drawers, dialogs, toasts, empty states, and tables.
- Update `design-system/imnota/MASTER.md` after the direction is approved.

**Exit:** a small, tested component foundation with no visual regressions in existing core controls.

### Phase 2 — Desktop shell and workbench

- Refine the global rail, topbar, collection rail, canvas toolbar, and inspector hierarchy.
- Introduce grouped toolbar actions and progressive disclosure.
- Add the handoff spine and make inclusion/export state clear.
- Preserve current annotation/editor behavior and keyboard alternatives.

**Exit:** a user can import, annotate, describe, reorder, include/exclude, and save without capability loss.

### Phase 3 — Flows and states

- Rework first run, empty states, drop overlay, autosave feedback, export, and failure/retry surfaces.
- Add explicit share privacy confirmation and upload progress states.
- Test narrow desktop windows, long titles/descriptions, large collections, missing assets, and unsaved/conflict conditions.

**Exit:** primary flows and edge states are understandable without a support explanation.

### Phase 4 — Public, pairing, and share viewer

- Tighten the public landing page around the five-second explanation.
- Add the hosted root entry page and branded `/new` pairing flow.
- Design `/s/:token` for valid, expired, revoked, invalid, and asset-failure states.
- Use real screenshots for proof and the generated comps only as internal direction.

**Exit:** public install/GitHub path and browser sharing path are both clear, truthful, responsive, and privacy-explicit.

### Phase 5 — Owner console

- Implement the authenticated owner shell and route guard.
- Add Overview, Shares, Pairing, Storage, and Operations screens against existing service contracts.
- Add revoke/cleanup confirmations, safe redaction, and audit-result feedback.
- Verify the console cannot expose raw bearer tokens, local paths, or private content.

**Exit:** the owner can diagnose service health and manage share lifecycle safely without database or filesystem access.

### Phase 6 — QA and release review

- Review at 1440 px, 1280 px, and the smallest supported laptop width; review public/share surfaces at mobile widths.
- Test dark/light themes, keyboard-only operation, screen reader naming, focus recovery, reduced motion/transparency, and contrast.
- Run typecheck, lint, unit/integration tests, production builds, and existing share-security tests.
- Capture before/after screenshots for the primary flows and compare visual density, hierarchy, and task completion time.

**Exit:** the acceptance criteria below are met and the capability-parity checklist is signed off.

## 11. Likely implementation map

The future app pass will likely touch, after design approval:

- `src/renderer/styles.css` — tokens, layout, surfaces, states, responsive behavior;
- `src/renderer/app/AppShell.tsx` — global navigation and top-level actions;
- `src/renderer/app/Workspace.tsx` — workspace composition and handoff spine;
- `src/renderer/collection/CollectionRail.tsx` — item hierarchy and add-item menu;
- `src/renderer/components/Toolbar.tsx` — grouped tool model and progressive disclosure;
- `src/renderer/inspector/ScreenshotInspector.tsx` — context/annotation/export/danger sections;
- `src/renderer/components/ui.tsx` — shared controls, dialogs, drawers, focus behavior;
- library, settings, prompt-export, and sharing dialogs — orientation and state coverage;
- the hosted service frontend/backend location to be confirmed in Phase 0;
- `implementation plan.md` — source for share-service constraints and lifecycle states;
- `design-system/imnota/MASTER.md` — updated only after the new direction is approved.

This map describes the planned ownership; see the execution notes and PR diff for implemented changes.

## 12. Acceptance criteria

### User experience

- A new user can reach a first annotated screenshot through the welcome state without guessing.
- The user can tell which collection items will be included in a prompt bundle.
- Title, description, priority, and selected-annotation settings are easy to locate.
- `Copy prompt bundle` is visible at the point of need and has clear preparing/success/failure feedback.
- Destructive actions are separated from ordinary work and explain their impact.
- Pairing explains one-time use, expiry, privacy, and the next action in every state.

### Visual quality

- Each screen has one clear focal area and one primary action.
- The UI feels more tactile and legible through hierarchy and surface depth, not decorative effects.
- The product still reads as a focused developer tool: graphite, indigo, cyan, technical typography, real evidence.
- There is no gradient/glass/blob treatment, pill overload, generic three-card feature grid, or unrelated wallpaper.
- Generated imagery is never presented as real product evidence.

### Accessibility

- All interactive controls have accessible names and visible focus.
- Keyboard users can operate reorder, tool selection, dialogs, drawers, export, and pairing.
- Status and inclusion are communicated through text/state labels as well as colour.
- Text and control contrast meets AA targets; focus is not obscured.
- Reduced-motion/transparency preferences are respected.

### Local-first and performance

- Core editing and export remain local and offline-capable.
- No remote font or runtime asset is required for the desktop app.
- Large screenshots and generated concepts are lazy-loaded or omitted from runtime bundles where possible.
- The public site does not load heavy decorative background assets unnecessarily.

### Owner and sharing safety

- Owner views never display raw share tokens, local paths, private Markdown, annotation source, recovery data, or secrets.
- `/health` remains a machine-readable endpoint and is not confused with the owner dashboard.
- Revoke and cleanup actions are explicit, confirmable, and auditable.
- Share, pairing, expiry, replay, upload-size, path-traversal, and security-header behavior remains covered by tests.
- The owner console is inaccessible without the approved authentication/authorization boundary.

## Decisions to make before implementation

1. What should the root of `app.imnota.xyz/` do: pairing entry page only, or pairing plus share-link explanation?
2. Where will the owner console live, and what authentication/session model is approved?
3. Should the app converge on a bundled IBM Plex Sans family, or keep its current Inter/system-first policy while the public/service surfaces align visually?
4. Which hosted share-viewer routes and retention policies are in the first release?
5. Which current keyboard shortcuts, toolbar defaults, and export dialogs are contractually stable and must not change?

Once these decisions are answered, the concepts in `docs/ui-overhaul/` can be translated into annotated screen specs and then into implementation tickets. Until then, this document is the design and sequencing plan only.
