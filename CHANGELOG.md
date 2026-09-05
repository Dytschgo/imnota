# Changelog

## Unreleased — First downloadable release

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
