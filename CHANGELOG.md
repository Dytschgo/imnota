# Changelog

## 0.2.6

- Retry briefly when Windows temporarily locks a save destination, preserving the committed file if the lock persists.
- Added optional hosted prompt sharing, browser copy actions, device pairing, and private owner management. Sharing pages now use versioned assets so cached files cannot break updated pages.
- Improved search, project management, collection history, favourites, and sharing settings.
- Reworked navigation and editor headers, made annotation tools adapt to available space, and fixed tooltips that stayed open after selection.
- Centered dialogs, expanded bundle previews, simplified visibility controls, and added recoverable item deletion from the collection list. Removed stale recovery banners and duplicate deletion prompts.
- Improved light-mode contrast, restored backdrop transparency, added generic light and dark backgrounds alongside the existing character options, and matched drawing and screenshot canvas surfaces.
- Improved edit preservation, interrupted-export recovery, update visibility, and macOS rollback cleanup.
- This release keeps the existing project format; the major dependency migrations are not included. macOS downloads remain ad-hoc signed, not Apple-notarised.

## 0.2.5

- Added standalone drawings with essential Excalidraw tools and connectors that stay attached to shapes. Drawings save editable JSON and a cropped PNG with a white background and padding in the collection's work tree.
- Added body-only Markdown items with editing and preview, stored alongside screenshots and drawings.
- Added shared ordering, visibility controls, duplication, and recoverable deletion for all three item types. Drawing and text editors autosave with a saving indicator.
- Mixed-content exports follow collection order and include written explanations and images. Text-only collections export Markdown without placeholder images.
- Back up workspaces before upgrading. Adding drawing or text items upgrades a project to schema 4 and preserves a schema 3 backup; older app versions cannot open the upgraded project.

## 0.2.4

- Corrected macOS temporary test paths so release checks exercise regular folders without bypassing symlink protection. The v0.2.3 tag did not publish a release because these checks failed.

- Added collection-based PNG prompt bundles with corresponding Markdown, screenshot references, and export exclusions.
- Added traditional non-destructive crop controls with Apply, Cancel, Reset, and resize handles.
- Improved annotation selection, resizing, Mac deletion shortcuts, and collapsible workspace navigation.
- Grouped Settings and added one app-wide backdrop with a local uploaded-image library.
- Desktop glass remains optional and is labelled Beta. Scrolling and transparency can still show rendering glitches; select No image or Solid surfaces to turn it off.
- macOS downloads remain ad-hoc signed, not Apple-notarised. Back up workspaces before upgrading; older app versions may not support newer project data.

## 0.2.2

- Added a macOS Terminal update button and copyable command with verified downloads, graceful shutdown, rollback and retained app backups.
- Nightly subscribers receive a newer stable release when it is ahead of the latest nightly, while keeping Nightly selected for future previews.
- Added update progress, save-before-restart protection and retryable installation errors.
- Refreshed Settings and subfolder creation, fixed project search, and repositioned the sidebar toggle and update control.
- Kept portable Windows and Linux deb updates on their supported manual installation paths.

## 0.2.1

- Added opt-in Stable and Nightly update channels with channel-specific checks and downloads.
- Added verified nightly prereleases and stable publication checks for all desktop platforms.
- Renamed feedback rounds to subfolders and simplified screenshot notes to one problem description.
- Moved update and sidebar controls into navigation.
- Added experimental combined text-and-image copying, with explicit attachment fallbacks.
- Isolated test profiles and corrected cross-platform canvas smoke tests.

## 0.2.0

- Added on-demand update checks in the app toolbar and Settings, with retry and download/install states.
- Release publishing now tags an already-reviewed main commit instead of pushing version commits around branch protections.

- Added feedback rounds with independent screenshots, notes, annotations and round-scoped exports.
- Added copy-first, metadata-last version-1 migration with retained rollback files.
- Fixed panel collapse and long screenshot lists stretching the canvas beyond the window.
- Added canvas pan, cursor-anchored zoom, actual size and inline text editing with Enter/Escape.
- Added image clipboard actions and an explicit AI attachment checklist.
- Added macOS title-bar safe space and packaged Imnota icon assets; removed the duplicate privacy footer.
- Fixed multiline Markdown note loading and added modal focus trapping.
- Expanded tests for migration, round independence, clipboard, layout and text editing.

## 0.1.3 — First downloadable release

- Universal Mac ZIP and DMG, Windows installers and Linux packages.
- Verified Mac archive launch, installer checksums and previous-app backups.
- Fixed packaged startup, preload isolation and file path validation.
- Added recovery restoration, save-before-close, cropped exports and pixelation.
- Added project-wide search, annotation clipboard and expanded properties.
- Added recovery and 100-image smoke checks; cache thumbnails and render exports sequentially.
- Mac updates use a download link until Apple Developer signing is configured.

The 0.1.1 and 0.1.2 tags did not publish downloadable assets. Release verification caught cross-platform test assumptions and a missing ad-hoc signature in electron-builder 25. The release now signs the assembled Mac bundle before creating archives and verifies installation from the public download.

## 0.1.0 — Development foundation (not published)

- Initial local-first Electron application foundation.
- Project folders, screenshot import and clipboard paste.
- Editable screenshot annotations with persistent JSON data.
- Structured notes, AI-ready Markdown and ZIP package export.
- Secure preload bridge, themes, tests and cross-platform packaging scripts.
