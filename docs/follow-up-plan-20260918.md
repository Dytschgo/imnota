# Follow-up plan — observations from the 2026-09-18 feedback round

Status: proposal only. Nothing in this document is authorized work; each item needs its own decision and its own PR. It records what was noticed while implementing PRs #72–#76 but deliberately left out of them because it was outside the feedback.

Items are sorted into **do**, **do only if the matrix shows it**, and **do not do**. Each "do" item is small enough for one PR.

## 1. Do

### 1.1 Change the macOS default capture shortcut

- Observation: the default binding for `capture.region` is `Ctrl+Shift+5`, mapped to `⌘⇧5` on macOS (`src/shared/shortcuts.ts`). `⌘⇧5` is macOS's own screenshot-toolbar shortcut and is intercepted by the OS before the Imnota window sees it, so the default can never trigger Imnota capture on a Mac.
- Proposal: keep `Ctrl+Shift+5` on Windows and Linux, and use a Mac-specific default that macOS does not reserve, for example `⌃⇧5` (Control rather than Command). `getDefaultShortcuts()` already special-cases `edit.deleteAnnotation` for Mac, so the change is one line plus a test.
- Migration: only the default changes. Users who saved an explicit binding keep it. The shortcut recorder (#73) already flags `⌘⇧5` as a clash when someone records it deliberately.
- Verification: unit test for the platform default; one manual press on macOS.

### 1.2 Show the disabled camera button when experimental capture is off

- Observation: `App.tsx` passes `onCapture` to the toolbar only when `experimentalRegionCapture` is enabled, so the toolbar hides the camera entirely when the setting is off. The toolbar already has a `captureDisabledLabel` branch ("Screen capture is experimental — enable it in Settings") that can never render.
- Proposal: always pass `onCapture` on Windows and macOS, and let the existing disabled state carry the explanation. The same applies to the **Take screenshot** menu item from #75, which follows the toolbar rule.
- Why: discoverability. Today a user who has not found the setting does not know capture exists.
- Counter-argument: the feature is experimental and the current behaviour may be a deliberate "hide until opted in" choice. If that is the intent, delete the dead label branch instead so the code says what it does.
- Verification: toolbar test for the disabled label; no native work.

### 1.3 Add an "Unreleased" section to `CHANGELOG.md`

- Observation: the changelog only has per-release sections. PRs #72–#76 each change user-visible behaviour and none of them could add an entry without inventing a version heading.
- Proposal: make a separate release-preparation PR to decide whether `## Unreleased` belongs in the changelog and, if so, add its release workflow there. Do not make `scripts/release.mjs` rewrite the changelog after acceptance: the current release contract requires a clean, exact `main` candidate whose version and changelog are already merged.
- Verification: review the release-preparation PR against `docs/release-readiness.md`; run `node --test scripts/release-readiness.test.mjs` and a dry run of the release script.

### 1.4 Record the manual matrices as living documents

- Observation: `docs/clipboard-receiver-matrix.md` exists for clipboard, but there is no equivalent record for multi-display capture.
- Proposal: add `docs/capture-display-matrix.md`, filled in per nightly build, with the exact build and OS; display count, arrangement and scaling; entry point; pointer and overlay displays; saved image dimensions; and whether the crop matches the selection. Link it from `docs/nightly-verification-audit.md`.
- Why: #72 was reasoned from Electron's Windows fullscreen behaviour, not observed on a two-display machine. The matrix is the only way to close it.

## 2. Do only if the matrix shows it

### 2.1 Tolerance in `overlayCoversDisplay`

- `electron/capture-overlay-placement.ts` (#72) requires the overlay's content bounds to equal the display bounds exactly. A one-pixel difference after `show()` on Windows mixed-scaling displays is a hypothesis to test, not an observed failure.
- Do **not** add a tolerance pre-emptively: a stretched overlay would map selection coordinates onto the wrong pixels, which is exactly the bug the check prevents. If the capture matrix reproduces `misplaced` failures on scaled displays and isolates a one-pixel reporting difference, add a ±1 px tolerance together with the failing display configuration as a test case.

### 2.2 Windows clipboard: write the image first, or write the formats separately

- #76 makes Imnota report what the clipboard kept. It does not change what is written. If the receiver matrix shows that Windows consistently drops `image/png` from a combined `ClipboardItem`, two options exist:
  - order the formats so the bitmap is registered first, or
  - fall back to a second write of the image only when the read-back reports it missing, and say so.
- Both change clipboard semantics, so they need the receiver matrix result first, not a guess.

### 2.3 Global (background) capture shortcut

- Feedback mentioned that the shortcut "feels glitchy". Today it is a renderer-level shortcut and only works while Imnota is focused; the user guide says so. If the matrix shows that users expect it to work from other apps, that is a product decision (it needs `globalShortcut`, conflicts with OS shortcuts and an unregister path) and belongs in `docs/product-roadmap.md`, not in a fix PR.

## 3. Do not do

### 3.1 Do not split `electron/main.ts` or `src/renderer/App.tsx` as a prerequisite

- Both are large. AGENTS.md explicitly says not to require a refactor before every small fix. Extract only when a specific boundary needs testing in isolation (the capture workflow in `main.ts` is the first candidate, because it now has three pure helper modules around it). Do not treat the related PRs as evidence that they merged cleanly until the integrated revision and checks are reviewed.

### 3.2 Do not add a "capture the display of the Imnota window" option

- The proposed rule is to capture the display under the pointer and communicate that rule. #72 documents it and the shortcut PR shows it in Settings. Offering a second rule as a preference would reintroduce the ambiguity that caused the report.

### 3.3 Do not make update checks more frequent than hourly or auto-download

- Hourly discovery (#74) is enough for a local-first app and stays within the "no surprise install" acceptance. Auto-download would violate this plan's explicit-download proposal.

### 3.4 Do not treat synthetic capture smoke as nightly evidence

- `IMNOTA_SMOKE_CAPTURE_SOURCE=synthetic` exercises the basic capture pipeline using synthetic pixels on the host's real display. It does not prove multi-display placement, scaling or crop correctness. Nightly promotion of capture changes needs the real matrix described in §1.4.

## Suggested order

1. 1.1 (one line, unblocks Mac users immediately).
2. 1.4 and the matrix runs for #72 and #76, which then decide 2.1 and 2.2.
3. 1.3 before the next release preparation.
4. 1.2 after the product decision on discoverability.

## Related

- [Engineering follow-up plan](engineering-follow-up-20260918.md) — codebase structure, evidence, and housekeeping items with code sketches and sequencing.
