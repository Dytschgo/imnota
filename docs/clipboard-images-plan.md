# Prompt bundle clipboard compatibility

Status: combined clipboard preparation is experimental. Receiver compatibility, macOS behavior and cross-editor paste remain pending manual verification.

## Product contract

Each prompt card represents a matching Markdown + PNG bundle from the current collection. The primary Copy action prepares both formats together from the latest saved state. Separate Copy Markdown only, Copy image only, Open generated files and Open export folder actions remain visible fallbacks.

Electron can place several representations on the operating-system clipboard. The receiving application decides which representation to consume. Imnota must never claim an image attachment arrived merely because the clipboard write succeeded.

Large collections are split automatically before clipboard preparation using output dimensions, pixel count, text readability and memory/safety limits. Prompt PNGs retain full-width labels, white backgrounds, expanded annotation bounds and original export-time Picture numbers. Excluded screenshots do not appear visually but remain Markdown exclusions.

## Safety boundaries

- Keep preparation local; do not upload files or invoke an AI provider.
- Use generated prompt PNGs, never hidden original pixels or excluded source images.
- Keep clipboard unchanged when preparation fails.
- Refuse or split unsafe output instead of shrinking text until it is unreadable.
- Preserve separate file actions when a target ignores one clipboard format.
- Use synthetic screenshots for compatibility work unless explicit authorization covers other data.

## Pending compatibility matrix

Manual verification must record OS/version, target application or browser and exact version, Imnota revision, whether Markdown arrived, whether the image arrived, whether both arrived in one paste, readability and whether each fallback worked.

Run at least:

- One prompt image.
- Multiple automatically split prompt bundles.
- A collection containing an excluded screenshot.
- Empty descriptions and annotations.
- Expanded bounds and a readability warning/oversized case.
- A desktop editor and browser-based editor on Windows and macOS.

These checks have not been run as part of this documentation update. Follow the [manual user-feedback protocol](user-feedback-protocol.md); do not convert automated Electron clipboard tests into receiver-acceptance claims.
