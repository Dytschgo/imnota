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

This is still an early application, not the full stable product originally specified. Recovery files are written but there is no restore interface. Crop is currently an outline, and the tool named Blur is an opaque cover rather than a blur filter. Project-wide search, full annotation property parity, complete clipboard annotation support, and performance validation with 100 large screenshots remain unfinished.

Installer syntax and platform packaging are distinct from installation verification. The downloaded-install experience still needs a published release and clean-machine testing, including Linux system library/FUSE requirements and macOS signing/notarisation. No release tag is created by publishing this cleanup to main.
