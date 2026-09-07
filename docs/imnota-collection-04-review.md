# Imnota Collection 04 — Agent Review

Date: 2026-09-07

This document records Luna's initial implementation, which was produced during a planning request. The subsequent review found issues despite the passing checks below. The user then authorized corrections, generated artwork, and a nightly release. See the correction record at the end; initial validation is historical, not release acceptance.

## Scope

UI improvements for the Imnota desktop workbench based on Collection 04 feedback.

## Findings

1. The collection controls used a native select plus three text buttons. The control group was visually busy and took more space than necessary.
2. Several application-level states still used hard-coded indigo values, so changing the accent preset did not update every active, focus, hover, and selected state.
3. Recent and Favourites only exposed top-level project navigation. There was no quick way to switch directly between recently used collections.
4. The Shortcuts action was present in the application navigation even though the full shortcut editor already exists in Settings.
5. Glass surface transparency existed, but there was no configurable image backdrop or opacity setting.
6. Refreshing a project snapshot after a metadata save could reset the active screenshot to the first screenshot in the collection.

## Implemented

### Collection rail

- Replaced the native collection select with an accessible custom picker.
- Added a compact green plus icon button beside the Collection label.
- Replaced Rename and Archive/Restore text actions with icon buttons and tooltips.
- Added click-outside and Escape handling for the picker.

File: `src/renderer/collection/CollectionRail.tsx`

### Navigation

- Recent now shows up to four most recently updated active collections.
- Favourites now shows up to four most recently updated collections belonging to favourite projects.
- Collection submenu entries show both collection and project names.
- Selecting a submenu entry opens the project and selects that collection.
- Removed the Shortcuts action from the application navigation.

Files: `src/renderer/app/AppShell.tsx`, `src/renderer/App.tsx`

### Accent consistency

- Added semantic accent tokens for the base, hover, and soft accent states.
- Updated major UI states to use those tokens, including navigation, primary buttons, search focus, project rows, screenshot selection, empty states, form focus, and settings controls.

File: `src/renderer/styles.css`

### Appearance and backdrop

- Added local image upload for a workbench backdrop.
- Added adjustable backdrop opacity from 0–100%.
- Persisted `backgroundImage` and `backgroundOpacity` in appearance preferences.
- Added four copyable image prompts for Graphite, Indigo, Emerald, and Amber themes.
- Kept the existing glass levels and added guidance to use Balanced or Strong glass to reveal the backdrop.
- Background images are limited to local image data or HTTP(S)/data image values and the upload UI limits files to 5.5 MB.

Files: `src/renderer/settings/AppearanceSettings.tsx`, `src/renderer/settings/settings.css`, `src/renderer/app/useAppearance.ts`, `src/shared/preferences.ts`, `src/shared/preference-settings.ts`

Note: This adds prompt generation guidance and image upload. It does not call an image-generation service or generate image assets automatically.

### Screenshot selection fix

- Same-project snapshot refreshes now retain the currently selected screenshot when it still exists in the active collection.
- Added a regression test for refreshing a favourited project while a non-first screenshot is selected.

Files: `src/renderer/store.ts`, `src/renderer/store.test.ts`

## Initial validation reported by Luna

All checks passed:

- `corepack pnpm test` — 52 test files, 311 tests passed; one existing platform-specific test skipped.
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm build`

## Review points for the other agent

- Confirm whether Recent/Favourites should include archived collections. The current implementation excludes archived collections from those quick lists.
- Confirm the preferred source for backdrop images. The current implementation stores uploaded images as data URLs in the local appearance profile.
- Confirm whether the four prompts should be editable by the user or remain curated presets.
- Exercise the Electron UI directly for visual QA. The browser preview could load the renderer but could not provide `window.imnota`, so it crashed before the real app shell rendered.

## Authorized correction scope

- Restore keyboard navigation and focus return in the collection picker; bound and scroll long lists.
- Align file and encoded preference limits, handle image errors and stale uploads, and permit only bundled presets or local image data.
- Respect solid surfaces, reduced transparency, and conservative performance fallback.
- Correct the new-collection button's CSS cascade.
- Replace copy-only image prompts with four selectable, bundled GPT Image backdrops. See [artwork provenance and prompts](backdrop-artwork.md).
- Separate Recent/Favourites navigation from submenu disclosure and protect rapid collection navigation.
- Keep the screenshot-selection regression fix and add coverage for the new behavior.
- Exercise native picker keyboard input, actual packaged backdrop image loading, saved selection, solid fallback, and removal in the release smoke workflow.

Final validation and release acceptance are pending while these corrections are implemented.
