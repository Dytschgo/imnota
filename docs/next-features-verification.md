# Next features verification

This record covers workflow templates, clipboard fallbacks, content search, local history and experimental region capture. It does not authorize a release or replace the platform release checklist.

## Integration with current main

The features are integrated with the 0.2.7 codebase and its Electron 44, React 19 and Zod 4 dependencies. Existing hosted sharing, project icons, revision-checked metadata edits, navigation and active/archived search remain available. Region capture stays disabled by default and does not occupy toolbar space until enabled.

The corrected integration passed 808 application tests, 45 script tests and 37 sharing-service tests, plus the share contract, formatting, lint, type checks and a production build on Windows. The script suite skipped its real macOS-package test. Regression coverage includes archived search isolation, capture opt-in visibility, the text-only primary copy state, restore navigation, project-bound export grants, reserved backup paths, interrupted retention cleanup and all six schema 1/2 missing-sidecar combinations.

The full Windows walkthrough passed 21 assertion groups with synthetic capture. A separate Electron 44 desktop-capture probe passed in memory without saving real desktop pixels. A locally packaged Windows application passed all 20 normal workflow groups in approximately 91 seconds, including restore/reopen and in-place image/draft replacement. Linux CI passed both development and packaged native verification. Cross-platform checks on the final reviewed commit are still required before release.

Two Windows CI attempts reached the unchanged 180-second limit near the library-search/history transition. Per-step progress and original failures are now saved as artifacts; optional renderer diagnostics have a separate two-second limit so they cannot hide an earlier assertion failure. All 13 existing workspace/onboarding/backdrop visual baselines passed on the first runner; the remaining settings image was individually reviewed and updated for the new Backups & history tab. Comparison tolerances are unchanged. New macOS test fixtures now canonicalize the OS temporary-folder alias, matching existing fixture setup while preserving the application's link rejection. macOS and Linux packaged verification passed on the second CI run.

## Original implementation checks

On 13 September 2026, the implementation passed 486 application tests across 80 files in the original checkout, plus 35 script tests with one real-macOS-package test skipped. Renderer and Electron type checks, ESLint, changed-file formatting and the production build passed. The final application test run used four workers to limit concurrent disk traffic. The existing large JavaScript chunk warning remains.

The Windows native workflow passed 18 assertion groups in both the integration and original checkouts. Independent review accepted all five feature areas, including the final capture-coordinate and backup-cleanup corrections. Tests used disposable project folders and an isolated application profile. Existing user documentation, plans and macOS updater changes were preserved when transferring the feature files.

## Verified workflows

- The Windows desktop workflow creates a bug-report project from the template picker, edits its first Markdown block, copies that text without creating an image, prepares a Markdown file and copies its path, then reopens the project with the edit intact.
- Template tests cover all five definitions, deterministic order, blank creation, cancellation, duplicate destinations and cleanup after write failures.
- Clipboard tests cover preparation failures without a clipboard write, separate format actions, stale generated files, cancellation between file-open actions and explicit result messages. An independent reviewer checked the corrected clipboard implementation.
- Desktop screenshots at 1280 × 800 confirm that the template choices and two-column clipboard fallback actions fit the dialogs.
- A Windows desktop search for words inside an edited template opens the correct Markdown block, focuses the editor and selects the match. The project's metadata stays byte-identical across search and navigation.
- The search fixture contains 100 projects and 1,000 text blocks. One measured run built the index in 1,306 ms and answered a subsequent query in 0.4 ms, with no additional file reads. These are local fixture timings, not a guarantee for every workspace.
- Under concurrent full-suite and desktop-test load, the same cold scan took 4,257 ms and a cached query took 0.6 ms. Search remains asynchronous; slower disks and larger workspaces need further measurement.
- Search tests cover legacy projects without writes, unavailable files, bounded indexing, cached queries, refresh, superseded requests, reserved recovery folders and out-of-order navigation.
- The Windows desktop history workflow creates a mixed-content snapshot, closes the window, restores to a new project and reopens it. The original and restored text, drawings, image and annotation files match byte for byte; the original metadata remains unchanged.
- In-place restoration was exercised with a newer image already loaded at the same path and item ID. The rendered pixels returned to the historical image, the old draft was cleared, and a new description edit survived reopening. The restored source PNG remained byte-identical.
- The synthetic Windows capture workflow selects a region, retakes it, cancels without creating files, then saves another region, selects it, annotates it and exports the image. Native testing caught and corrected an overlay pointer-movement bug before acceptance.
- The final Windows overlay occupied the complete 1920 × 1080 display, not its 1920 × 1032 work area. A 960 × 486 selection completed the native workflow. The save path rejects a mismatched overlay, and crop-math tests prevent an extra pixel at exact 1:1 coordinates.
- A separate real Windows desktop-capture probe returned a full-resolution 1920 × 1080 source and successfully cropped the smoke window in memory. No real desktop pixels were persisted or returned in the verification report. This establishes capture capability on this setup, not multi-monitor or high-DPI acceptance.
- Light-theme history, search, template and clipboard views and the dark restored workspace were inspected in the desktop app. Actions and content fit at 1280 × 800; the capture overlay was also inspected at display size.
- Backup tests cover corruption, incomplete manifests, traversal, symbolic links, retained snapshots, failed writes, restore safety copies, full rollback folders and interrupted-restore journals. Real backup-service fixtures verify snapshots before schema 1/2 migration and the first schema 3→4 text or drawing save.
- Failure-path tests verify that a failed in-place restore renews the renderer's project watch, allowing subsequent edits to save. Archive export has a 256 MiB input cap; total peak memory can exceed that because ZIP generation also buffers output.
- Once an in-place directory swap commits, later journal or recovery cleanup failures return the committed project, safety snapshot and full rollback path with warnings. An injected double-failure test checks both sets of file contents and subsequent journal recovery.

## Checks that still require people or other platforms

The planned moderated workflow sessions have not been run. Automated fixture results do not establish whether the chosen templates solve the most common user problems.

Clipboard writes do not prove what a receiving application accepts. For each target editor, record the operating system and editor version, whether Markdown and the image arrive, whether the image is readable, and which separate-copy or file-attachment fallback works. This implementation has not completed that receiver matrix on Windows or macOS.

Capture remains experimental and disabled by default. Synthetic screenshots can verify the overlay and insertion workflow without recording a private desktop. They do not verify macOS Screen Recording permission, Retina displays, mixed-DPI monitors or Linux capture support. Keep those checks separate from the automated result.

Video/GIF capture, OCR, cloud sync, accounts, PDF export and full Excalidraw compatibility remain outside this work. Existing optional hosted sharing is preserved when integrating with current main.

The fullscreen behavior was checked against the [Electron BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window); platform behavior still requires native verification.
