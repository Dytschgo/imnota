# Engineering audit — 2026-09-05

The previous green CI runs verified compilation and packaging, but never launched Electron. A runtime check reproduced startup failures caused by the updater's CommonJS import, an ESM preload in a sandboxed renderer, an incorrect HTML path, and omitted shared runtime modules in packaged files.

This revision fixes those startup problems and adds an Electron smoke command to CI. The smoke uses disposable project data and verifies the bridge, project creation, image import, content persistence, repeated duplication, ZIP contents, and rejected traversal attempts.

Other changes:

- Validate IPC payloads and senders; restrict settings mutations and folder opening.
- Reject symlinks/junctions in file access paths and serialize writes, with regression tests for Windows contention and path escapes.
- Preserve notes and annotations when duplicating screenshots, with collision-free filenames.
- Flush pending screenshot edits during navigation, ignore stale asynchronous image loads, and persist export preferences.
- Render all exported images independently of the selected canvas at original resolution; align filenames with the Markdown brief.
- Correct arrow/freehand coordinates, ellipse dragging, and persisted transform scales. Sensitive-area covers are fully opaque.
- Fix Windows release-command argument handling, fail on remote lookup errors, and require ancestry from the current remote main branch.
- Publish only installer/update assets, check quality before releases, and build a universal macOS installer. Linux installation stages the download before replacing an existing copy. Windows installation checks the installer exit status.

## Remaining scope

The first downloadable release adds a restore/keep/cancel recovery dialog with a retained backup, a write-ahead journal for screenshot saves, and save-before-close handling. Crops now determine PNG export bounds without modifying originals. Pixelation is a separate tool; the existing opaque mask remains unchanged for safe redaction. Search includes screenshot notes, titles, tags, statuses and priorities. Annotation controls now cover fonts, alignment, colour, layers, arrowheads, step numbers and pixel size; copy/paste works inside Imnota.

Thumbnail caching and sequential export rendering reduce repeated decoding and simultaneous canvas allocations. The Electron smoke includes a synthetic 100-image 1920×1080 project and recovery restoration. This is not a benchmark of varied real-world large screenshots, and full performance profiling remains outstanding. Cross-application annotation clipboard exchange is not implemented.

Release CI extracts the actual universal Mac ZIP, verifies its ad-hoc signature and both architectures, then launches the packaged application and runs the filesystem smoke. The installer verifies SHA-256 checksums and preserves previous app bundles. Apple Developer signing/notarisation, clean-machine Gatekeeper testing and automatic Mac update installation remain external release limitations; Mac clients offer a manual update link. Linux system library/FUSE compatibility still needs broader testing. This is an early usable release, not a claim that every original product requirement is complete.
