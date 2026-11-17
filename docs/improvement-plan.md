# Imnota improvement plan

Goal: shorten the time from a reviewed change to a verified release while preserving data integrity and platform coverage. Work in small, complete PRs under [AGENTS.md](../AGENTS.md). This plan distinguishes completed work, the next measured experiment, and later candidates; listing a task does not authorize its implementation.

## Completed baseline

[PR #34](https://github.com/Dytschgo/imnota/pull/34) delivered:

- [x] Nightly quality and packaging run concurrently after the exact-main-commit guard. Publication still requires quality and every package job to succeed.
- [x] Remove duplicate release-test invocation and the extra nightly build/unpackaged Linux walkthrough. Packaged verification remains on all three OSes. PR/main retained the unpackaged walkthrough at that point; the [September 22 audit](verification-timing.md#september-22-validation-audit) removes that duplicate too.
- [x] Correct premature Markdown-search assertions and native double-click scheduling in the smoke driver without weakening assertions or adding automatic retries.

The [baseline nightly](https://github.com/Dytschgo/imnota/actions/runs/34266014334) took 10m 25s from guard start to publication-job completion. The [optimized nightly](https://github.com/Dytschgo/imnota/actions/runs/34274745361) took 7m 17s: 3m 08s, or about 30%, less in that single comparison. Queue, runner, and upload timing vary; this is observed evidence, not a guaranteed improvement. See the [verification audit](nightly-verification-audit.md) for the original measurements and coverage rationale.

## 1. Working agreement and verification tiers

Completed in [PR #35](https://github.com/Dytschgo/imnota/pull/35):

- [x] Replace hard PR-size stops with warnings and justified exceptions.
- [x] Keep cohesive backend/UI/test changes and required dependency updates together.
- [x] Allow agents to complete an approved plan without pausing at every slice.
- [x] Define documentation, application, platform, build/CI, and release verification tiers in [AGENTS.md](../AGENTS.md#verification-by-impact).
- [x] Correct stale assumptions and move broad refactors into a conditional backlog.

Acceptance: both documents agree, commands and local links are valid, and it is clear that no existing CI gate or repository setting changes in this slice. The tiers guide local work now; automated routing requires the next reviewed CI change.

## 2. Completed: remove redundant PR test execution

[PR #36](https://github.com/Dytschgo/imnota/pull/36) mapped all tests and retained the full suite in Linux quality. Each package job now repeats the 37 unexcluded application test files and all script tests. The 41 exact renderer exclusions were reviewed for simulated or platform-independent behavior; new or unlisted test files remain in platform runs by default. Cases added to an excluded file follow its existing policy until review reclassifies it. See the [coverage map](pr-test-coverage.md).

In one successful PR-run comparison ([before](https://github.com/Dytschgo/imnota/actions/runs/34276483712), [after](https://github.com/Dytschgo/imnota/actions/runs/34277727340)), the package test step fell from 82s to 36s on Windows, 85s to 52s on macOS, and 42s to 20s on Linux. All native, visual, security, and quality checks passed. Workflow-level queue delay was zero at API timestamp resolution in both runs; runner scheduling and total job times vary. No test cases were deleted and release gates were unchanged.

The reviewed coverage map accounts for every existing test and defaults new or unlisted test files to full platform coverage. Full packaged walkthroughs, Windows visuals, hosted sharing contracts, and service security checks remain. No required check or publication gate was removed.

## 3. Follow-up speed and reliability work

Choose the next item from measured cost and failure frequency, rather than implementing this entire list automatically.

Completed follow-up experiments:

- [PR #37](https://github.com/Dytschgo/imnota/pull/37) retains useful [CI review artifacts](ci-artifacts.md) without duplicate unpacked folders. All three archive inventories were inspected after native verification. Stored package bytes fell about 46%; upload steps fell from 29s to 6s on Windows, 29s to 4s on Linux, and 83s to 8s on macOS in one successful before/after PR comparison.
- [PR #38](https://github.com/Dytschgo/imnota/pull/38) introduces conservative [documentation-only PR routing](ci-routing.md). Every original check name still reports. Full formatting, CodeQL, and dependency review remain; main pushes and uncertain or mixed changes retain full application/platform verification. The first prose-only results revision in [PR #39](https://github.com/Dytschgo/imnota/pull/39) verified the hosted shortcut: Validate completed its jobs in 40s, and CodeQL finished in 61s from the first job start. All original check contexts reported success.

Both changes received independent review. Measurements and limitations are recorded in the linked documents and PRs. These completed slices establish a faster release process without turning the remaining candidates into automatic refactors.

| Candidate                     | Investigation and acceptance                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR artifact uploads           | Completed in PR #37; monitor artifact usefulness and upload measurements.                                                                                                                                                                                                                                   |
| Electron/build caches         | Evaluated in [PR #42](https://github.com/Dytschgo/imnota/pull/42); not retained because the same-commit cold/warm experiment did not establish worthwhile savings. See the [measured results](history/build-cache-experiment.md). Revisit only if download costs materially increase.                       |
| Documentation-only CI routing | Completed in PR #38 and exercised by PR #39; retain conservative classification.                                                                                                                                                                                                                            |
| Stable release duplication    | Implemented in the subsequent stable-release CI cleanup: one quality job alongside platform packaging, with candidate/public-install/promotion gates preserved. Record actual stable elapsed time at the next intended release.                                                                             |
| Slow or flaky tests           | Completed: [duplicate Mac updater verification](verification-timing.md#earlier-updater-timing-audit) was removed from PR/main CI while the post-package platform-suite case became required. Preserve native, signature, architecture and release checks; use new traces before changing waits or fixtures. |
| Reduced PR macOS package      | Superseded: macOS builds move to Apple Silicon only on every channel (section 5, Phase 1, item 3). Adapt the architecture/signature verifier and artifact contract together.                                                                                                                                |

For each implemented experiment, record the before/after commit and run URLs, event type, runner/architecture, check coverage, job durations, queue delay, artifact sizes, and reruns. Use multiple comparable runs when possible; label single-run comparisons and estimates clearly. Roll back an optimization that creates coverage gaps or unreliable evidence.

Deferred after this pass:

- The Electron/build-helper archive cache was evaluated and removed after a full three-OS cold/warm pilot. All archives hit on the warm run, but restore overhead and about 523 MB of additional storage did not establish worthwhile savings. Existing dependency caches remain; see the [experiment and limits](history/build-cache-experiment.md).
- The subsequent [stable-release CI cleanup](stable-release-ci.md) moves shared checks into concurrent quality and retains platform suites and publication gates. It uses classifier fixtures, workflow review, and full PR package validation; actual tag-triggered publication/public-install execution and elapsed-time measurement remain for the next real stable release.
- Keep universal macOS PR packaging and all native verification. Reducing architecture coverage is a separate tradeoff, not necessary for these measured savings. _Superseded on 16 November 2026 by the Apple Silicon-only packaging decision in section 5._
- Structural work below remains conditional on a demonstrated defect or maintenance boundary. No mass IPC, persistence, state, lint, or test-runner migration is required to release the current improvements.

## 4. Structural improvements, driven by recurring problems

These are candidates for focused investigation, not prerequisites for releasing or commitments to a specific architecture.

The September 22 memory/data-loss audit identified three concrete stability follow-ups beyond the measured image-memory changes:

- **Bound autosave postponement.** Screenshot/content/project metadata saves currently use a trailing 650-700 ms debounce without a maximum wait. Continuous editing can leave a longer unsaved interval. Add a maximum wait while preserving revision checks, navigation drains and failure visibility; verify a crash during sustained editing against the last acknowledged save.
- **Make import interruption recoverable.** `importOne` copies the original and sidecars before updating project metadata, without one transaction. Main-process interruption can leave files present but unlisted. Journal import and test interruption at each boundary before considering any orphan-file recovery UI. Never automatically remove unlisted files.
- **Check source size before decoding.** Thumbnail and image loading still decode original files natively. A bounded preview/cache does not protect against a single oversized compressed image. Validate supported-format dimensions before native allocation, preserving originals and reporting an actionable limit; cover malformed headers and supported OS decoders.

These are follow-up proposals, not demonstrated causes of the reported user's loss. Ordinary screenshot-save transactions do not remove original images; renderer memory exhaustion can interrupt unsaved edits, while already admitted native saves may finish.

- **IPC boundaries:** extract one domain from `electron/main.ts` when its coupling makes changes or tests difficult. Preserve IPC validation, behavior, and ownership. Evaluate testability and review effort rather than a target line count.
- **Persistence and recovery:** characterize journal replay, partial writes, conflict handling, undo, and restart recovery before consolidation. Compare screenshot/content semantics before proposing a shared abstraction. Require independent review and a recovery plan for changes to data-loss paths.
- **Renderer state and canvas/export code:** use repeated defects or change friction to select one boundary. Pilot a focused hook, reducer, or module; do not migrate every state owner or force new libraries in one effort.
- **Types and lint:** narrow duplicated types one domain at a time. Evaluate existing violations before enabling repository-wide compiler/lint failures; use a workable baseline or include the necessary fixes. A global rule does not automatically apply only to new code.
- **Smoke harness packaging:** measure startup loading and packaged size separately. Dynamic import defers loading but does not exclude emitted files under current packaging globs. Any exclusion needs an explicit artifact design and a way to verify the actual shipped application.
- **Test runner or browser-driver migration:** pilot one representative flow only if it improves reliability or maintenance. Preserve trusted input, native clipboard, packaging, filesystem, and recovery evidence. Consolidating reports alone does not justify replacing working runners.
- **Assets, styles, and docs:** investigate demonstrated resolution problems, duplication, and stale guidance. Keep intentional bundled artwork and approved visual baselines. Archive obsolete plans with links, and do not rewrite published history to remove old assets.

## 5. November 2026 performance and trim audit

A read-only audit of `main` at `875c88a` (0.5.0 candidate) measured CI, the test suites, the application runtime and dead code. Each slice below is a separate PR candidate. Listing it does not authorize it; record before/after evidence as in section 3. In this section, _measured_ means timed or counted, and _estimated_ means inferred from reading the code.

Baseline evidence:

- [Validate on main](https://github.com/Dytschgo/imnota/actions/runs/43626717756): macOS package job 26.4 min, Windows 15.7 min, Linux 7.7 min, quality checks 4.7 min.
- [Nightly](https://github.com/Dytschgo/imnota/actions/runs/43626851377): 21.4 min, with macOS taking 19.9 min.
- macOS job steps: build 153 s, updater test 63 s, update fixture build 76 s, live update 66 s, walkthrough 231 s, native installer transactions 597 s, native faults 312 s.
- PR runs reached 40–45 min because one package job queued for about 30 min.
- Local Windows suite times: Vitest 72–102 s, script tests 66 s. These were noisy because the system drive was nearly full.

### Phase 1: CI critical path

1. **Fake clock for expected installer timeouts.**
   - Problem: in `scripts/install.native-mac.test.mjs`, the `refuses-quit` and `blocked-quit` cases wait out the real 60 s quit deadline, and the `exits` and `no-process` cases wait out the 30 s launch-observation deadline. Measured: 8 cases, about 396 of the 597 s.
   - Change: for those faults only, shadow `/bin/sleep` in the harness so it advances Bash `SECONDS`, the way the harness already shadows `ditto` and `codesign`.
   - Keep real time for `quit`, success and lock cases. Leave the shipped installer and updater scripts unchanged.
   - Acceptance:
     - Each case still asserts the user-facing timeout message and the restored bundle.
     - The step takes under 4 min on macOS in both Validate and nightly.
   - Tier: CI plus native macOS. Coordinate with any open edits to `update-macos.sh`.
2. **Fewer sequential native fault launches.**
   - Problem: the 12 fault case sets each launch the packaged app in sequence. Measured: macOS 5:09, Windows 8:08, Linux 3:47. The EIO/EACCES/EPERM variants of `restore-*` and `recovery-lineage-*` are separate launches.
   - Decided 16 November 2026: combine. One launch arms EIO, EACCES and EPERM in turn, so `restore-*` and `recovery-lineage-*` each become one case set. That is 8 launches instead of 12.
   - Keep each errno a distinct case ID with its own evidence, and update the shared catalog, `assertFaultReport` and the aggregate check together.
   - Concurrent case sets were considered and not chosen, because of CPU contention on hosted runners.
   - Acceptance:
     - Every errno case still produces bound evidence.
     - The aggregate and downloaded-manifest verifiers still fail closed when any case is missing.
     - Estimated savings: about 2 min on Windows and 1–1.5 min on macOS.
   - Tier: native verification on all three OSes. This is recovery-evidence code, so it needs independent review.
3. **Apple Silicon-only macOS builds (decided 16 November 2026).**
   - Problem: every macOS package, fixture and installer-test extraction carries both x86_64 and arm64 slices, although Intel Macs are unsupported (see [the roadmap](product-roadmap.md)). The universal build takes 153 s, and the update fixture is a second universal build (76 s).
   - Change, part 1 (bridge release): teach every updater to accept an `-arm64` archive and to verify an arm64 slice instead of requiring both. The updaters are `electron/terminal-update.ts` and `scripts/update-macos.sh` (archive name and `verify_universal_binary`), plus the in-app update path. On an Intel Mac, the updater must stop with a clear unsupported-hardware message and leave the installed app unchanged. This release still publishes universal archives.
   - Change, part 2 (switch): build with `--arm64` and make the native helpers arm64-only. Update `scripts/adhoc-sign.mjs`, `scripts/verify-mac.sh`, `scripts/verify-mac-in-app.mjs`, the native installer tests, `release-channel.mjs` and `stage-release-assets.mjs` (including the `Imnota-mac.zip` alias), `install.sh`, and the release documentation.
   - Why two releases: an installed universal build's updater looks for `-universal-mac.zip` and rejects any app that is not universal. Its users therefore need the bridge release before the switch. Otherwise their next update fails, although the app keeps running. Users who skip the bridge can reinstall with the current `install.sh`.
   - Acceptance:
     - Each part passes CI and the full nightly and stable gates on Apple Silicon.
     - An update from the last universal release through the bridge to the first arm64 release is verified on a real Mac.
     - Before/after macOS package job times are recorded.
   - Tier: updater, packaging and release publication. This is consequential and needs independent review.

### Phase 2: Test suite

1. **One error code per restore kind.**
   - Problem: `useProjectPersistence.restore.fixtures.tsx` runs every restore case for EIO, EACCES and EPERM. All three use the same `electron/files.ts` directory-sync path, and no test checks anything code-specific.
   - Change: map screenshot to EIO, text to EACCES and drawing to EPERM, which reduces 72 cases to 24. Measured saving: about 90 s of test time.
   - Review: this is persistence coverage, so it needs independent review.
2. **Cheaper test setup.**
   - Load `@testing-library/jest-dom` only when a DOM exists (`src/test/setup.ts`). Measured: summed setup time falls from 140 s to 64 s.
   - Add the `@vitest-environment node` declaration missing from 15 `electron/` and `src/shared` tests, which [the coverage map](pr-test-coverage.md) requires, and add a policy test that enforces it.
   - Keep a single Vitest project.
3. **Split the installer script tests by platform.**
   - Problem: `install.test.mjs` (58 s) and `update-macos.test.mjs` (50 s) block on child processes.
   - Change: split each into per-OS files so `node --test` runs them in parallel. Estimated: 66 s down to about 30 s.
   - Update the workflow references by file name in the same PR.
4. **Injectable grant cap.**
   - Problem: the prompt-bundle grant-cap test opens 129 real sessions. Measured: 3.5–14.8 s.
   - Change: inject the cap, test the behaviour with a small value, and assert the production constant once.

Not recommended, based on measurements:

- `isolate: false` leaks state between files.
- `pool: 'threads'` breaks the Windows exclusive-handle test.
- Disabling fsync saves only about 5 s and weakens durability coverage.
- Keep the 100-screenshot transaction test; it covers a large-workload correctness case.

### Phase 3: Application runtime

Measure each slice first. Use React Profiler commit counts and durations on a 100-screenshot collection, packaged time to first window, and renderer chunk sizes.

1. **Render boundaries.**
   - Problem: each description keystroke or annotation commit replaces `snapshot`, which `App` and `AppShell` select. Whole-store `useAppStore()` subscriptions remain in `Workspace`, `CollectionRail` (2), `ScreenshotComparison` (2), `Library` and `SettingsView`, and nothing in `src/renderer` uses `React.memo`.
   - Change: narrow those selectors, then memoize the rail row, inspector and canvas with stable props. Do one boundary per PR.
   - Done (#338): selectors narrowed and the three boundaries memoized together. In a 100-screenshot Profiler harness, a description keystroke re-renders 1 rail row instead of 200 and the inspector once instead of twice, and skips the canvas. An annotation commit re-renders only the canvas.
2. **Canvas frame cost.**
   - Cache pixelation output per annotation; today `AnnotationCanvas` rebuilds every region on each pointer move.
   - Batch pointer pan and draft updates per animation frame, following the wheel-input pattern from #243.
   - Split static image, annotation and draft/transformer layers.
   - Verify with native drawing checks.
3. **Main-process startup.**
   - Dynamically import `electron-updater`, `jszip` and the smoke-only fault controller. Measured in Node: about 240 ms and 85 ms to load the first two.
   - Run the diagnostics write and the settings read in parallel, and start the MCP sync after `createWindow`.
   - The updater path is consequential, so this needs independent review.
4. **Renderer bundle.**
   - The startup JavaScript is about 1.21 MB minified (measured).
   - Remove zod from that bundle: replace the sender-name schema and lazy-load the fault probe.
   - Lazy-load Settings, onboarding, What's New and the share dialogs.
   - Done (#339): zod is out of the startup bundle. The backup defaults and the screenshot-source schema were also pulling it in. Settings, onboarding and the Share bundles dialogs load lazily and are preloaded when the app is idle; onboarding and Share bundles show a modal loading shell until their chunk arrives. Search, the app dialogs, capture destination and What's New stay eager because they open by shortcut, hotkey or at boot. Initial chunks fall from 1211.7 kB to 1010.4 kB, and `main` from 606.2 kB to 403.5 kB.
5. **Thumbnails outside the snapshot.**
   - Problem: every snapshot re-sends all thumbnails as data URLs of about 50 kB each.
   - Change: serve thumbnails per item instead.
   - Write a short design first. It changes the snapshot contract and enables the rail virtualization in [the large-collection plan](large-collection-performance-plan.md).
6. **Smaller items.**
   - Bound and coalesce description undo history, which is currently unbounded with one entry per keystroke.
     Done (#338): a typing burst is one undo step, with at most 100 steps per screenshot.
   - Validate each PNG data URL once in the prompt-bundle path instead of twice. Measured: 49 ms per 8 MiB image per pass. Done (#335): the regex is replaced by a native decode check of about 2.5 ms; the IPC schema and the workflow each keep one check.
   - Convert the backdrop and What's New PNGs (about 15 MB) to WebP or AVIF. Run visual regression and record artwork provenance.

### Phase 4: Trimming

The audit found about 1,600–1,800 removable or mergeable lines out of about 85k production lines. The codebase is largely clean.

1. **Confirmed dead code (about 660 lines).**
   - About 37 unused CSS classes; verify with visual regression.
   - Uncalled helpers in `src/shared/utils.ts` (`DEFAULT_TAGS`, `DEFAULT_FIELDS`, `priorityColor`, `annotationLabel`).
   - Other uncalled code: `backupProjectFiles`, `describeCombinedDelivery`, `ownerStaticDir`, `WINDOWS_COPY_VARIANT_IDS`, and the duplicate `OCR_EXPORT_BUDGET_MS`.
   - The `projects:archive` and `recovery:clear` IPC channels, removed together from their handlers, contracts, preload, bridge type and boundary-test rows.
   - `scripts/verify-design-vm.ps1`.
2. **Decided removals (16 November 2026).**
   - Remove the legacy `exports:package` and `exports:annotated-image` ZIP export, together with its IPC contracts, preload methods and types. No UI uses it.
     - First move the smoke steps in `capture-smoke.ts` and `mixed-content-smoke.ts` to the real prompt-bundle export.
     - About 150 lines.
   - Done in [PR #333](https://github.com/Dytschgo/imnota/pull/333): remove Tailwind (`tailwindcss`, `@tailwindcss/postcss`, `postcss.config.js`) and replace it with a short local reset and an `sr-only` rule.
     - It currently supplies only those two things, and its source scan generates stray utilities such as `.collapse` and `.blur`.
     - Verify with the Windows visual baselines plus a macOS and Linux walkthrough screenshot review.
   - Remove the `recovery:save` write channel. The smoke test that needs a leftover legacy recovery file writes that file directly.
     - Keep the read and restore path for users upgrading with an old file.
     - This is persistence-adjacent, so it needs independent review.
   - Keep only `recoveryWarnings` in `HostedShareList` and remove `recoveryErrors` and its fallback.
     - The renderer and main process always ship together.
     - Update the Sharing settings and share dialog tests.
3. **Duplicate project button (decided 16 November 2026).**
   - Problem: `projects:duplicate` is implemented, hardened (#205) and documented in [the data format](data-format.md), but no UI calls it.
   - Change: add **Duplicate** to the project actions in the Library, open or select the new project on success, and show the existing error, including any retained incomplete folder.
   - Tier: application behaviour, with a UI test and a native walkthrough step. It is a user-visible change, so follow the [feedback delivery contract](feedback-delivery-contract.md) and update [the user guide](user-guide.md).
4. **Consolidation.**
   - Done (#335):
     - One PNG parsing module with per-caller limits, replacing 8 implementations.
     - One `loadKoffi` helper, replacing 3.
     - One project-creation queue shared by blank and template creation, with a regression test. The IPC router already serialized `projects:create`, so the race affected only direct callers of `createTemplateProject`.
5. **Recovery helper unification.**
   - Problem: about 14 helpers are copied across `content-trash.ts`, `screenshot-trash.ts` and `screenshot-transactions.ts`, and the copies have drifted.
   - Gate: start only after the [recovery unification design](recovery-unification-design.md) is approved. Independent review is required.
6. **Documentation.**
   - Move completed plans and worksheets to `docs/history`, with their inbound links: the hill-climb scorecard, the UI overhaul implementation and its concept images, UI feedback images, and the Windows copy comparison.
   - Fold or archive the orphaned pages.
   - Refresh `next-features-plan.md`, and refresh `implementation-plan.md` after 0.5.0 is published.

### Owner decisions

All decisions below were made on 16 November 2026:

- Apple Silicon-only macOS packaging on every channel, through a bridge release (Phase 1, item 3).
- Combine errno variants into single fault launches (Phase 1, item 2).
- Remove the legacy ZIP export, Tailwind, the recovery write channel and the duplicate share-warning field (Phase 4, item 2).
- Expose Duplicate project in the UI (Phase 4, item 3).

### Delivery status (16 November 2026)

Merged to `main`: #323 (this plan), #324, #325, #326, #327, #328, #329, #330, #331, #332, #333, #334, #335, #336, #337, #338 and #339. Every PR passed the full Validate workflow on its final head. Updater, persistence, IPC-validation, fault-evidence, canvas and CI changes also had an independent review, and that review's findings were fixed before merge.

Measured results. CI figures are single samples on hosted runners, whose speed varies by roughly 30% between runs:

- **macOS native installer transactions:** 597 s before, 202 s on #325's run and 321 s on the first post-merge `main` run (a slower runner). The eight expected-timeout cases now take about 10 s each instead of 35–66 s.
- **macOS package job:** 26.4 min before, 15.5 min on #325's run and 23.1 min on the slower post-merge run.
- **Windows package job:** 15.7 → 12.3 min. Windows native faults: 490 → 358 s.
- **Quality checks:** 4.7 → 3.6 min. Coverage run: 160 → 114 s.
- **Renderer:** initial JavaScript fell from 1211.7 kB to 1010.4 kB (gzip 363.7 → 308.3 kB). A description keystroke re-renders 1 rail row instead of 200.
- **Main process:** about 100 ms less to the first window load on Windows (measured on a dev build).
- **Code:** #329 removed about 840 net lines; #333 removed Tailwind and two dependencies.

Deferred, each with its own gate:

- Apple Silicon-only packaging, part 2: only after a bridge release (#328) has been published and confirmed (see [release readiness](release-readiness.md)).
- Thumbnails outside the snapshot (Phase 3, item 5): needs a short design first.
- Recovery helper unification (Phase 4, item 5): waits for approval of the [recovery unification design](recovery-unification-design.md).
- WebP artwork conversion, under verification: eight backdrops and the three large 0.4.0 What's New illustrations use lossless WebP; smaller screenshots remain PNGs. Asset bytes fall from 17,372,801 to 12,693,530 (4,679,271 bytes, 26.9%). Both artwork documents retain original provenance and add source/derived SHA-256 pairs, dimensions and encoder settings. Pillow and the application's Electron 45.3.2 / Chromium 156 decoder both produce identical RGBA pixels for all 11 source/derived pairs; independent review confirmed the pixels, hashes and references with no findings. Windows lint/typecheck, 18 focused tests and the full suite passed (2,901 application and 345 script tests; 7 and 21 skipped). Both clean Windows builds and native walkthroughs passed (39 assertion groups). Same-machine comparison against main passed 13/14 approved captures, including both backdrop views; four generic-backdrop settings captures are byte-identical. The remaining onboarding-intro mismatch is a roughly one-pixel content shift in an unchanged screen. Local comparison against committed CI baselines fails 8/14 captures on main and 9/14 on this branch, including that additional onboarding mismatch. The unchanged CI visual baseline gate remains required before merge; no baseline update is authorized.
- Keeping `marked` and DOMPurify out of the startup bundle: not started.

Follow-ups found during delivery:

- **Data loss, completed in [PR #342](https://github.com/Dytschgo/imnota/pull/342):** screenshot-keyed patches retain edits made before content loads, including single-click edits and explicit reversions. A pending patch counts as unsaved and blocks flush/export/close completion. Successful loading overlays only edited fields over disk content and queues the normal revisioned save. A failed load reports an error and retains the patch in memory for **Retry**; it does not write a replacement for unreadable content. Leaving and returning to the screenshot retains the patch. Explicit discard clears it. These patches are not crash-durable until normal saving succeeds; keep the window open and restore access to the source image before retrying. Independent review found no remaining blocking findings. On final head `2cc8f00`, the full Windows application/script suite and build plus native smoke passed, including source-context edit/reopen/remove verification. All supported packaged OS gates passed before merge as `bb1c6b0`.

- **Intermittent CI failures:**
  - Completed in [PR #344](https://github.com/Dytschgo/imnota/pull/344): the Share bundles error-ownership test captured the eager loading dialog and waited inside that detached shell after the real lazy dialog mounted. The follow-up observes the alert in the current document, then checks that the current Share bundles dialog owns the single alert. It retains the no-toast and recovery-button assertions, with no timeout increase or retries. The focused reproduction and full `corepack pnpm test` passed on Windows: all 222 application test files (2,894 tests, 7 skipped) and 323 script tests (21 skipped). All required CI passed before merge as `8a0977c`.
  - Installer-lifecycle rollback fixture, completed in [PR #345](https://github.com/Dytschgo/imnota/pull/345): its `ps` mock classified the shell by substring-matching its PID anywhere in the arguments. A synthetic replacement PID containing those digits was therefore reported as the shell, skipping quiescence and reaching a silent fixture safety exit. Four controlled overlap cases for graceful/TERM reproduce the reported exit-1/empty-output pattern and pass with exact self-query matching. The production installers are unchanged. Unmodified stress probes passed 160 runs (640 cases), so the historical CI PID values remain unconfirmed; retain that limit when attributing the earlier intermittent failures. The full Windows script suite passed 327 tests (21 skipped), and independent review passed all 42 installer-lifecycle tests with no findings. All required CI passed before merge as `20eb874`.
  - The macOS `native-fault-smoke` watch-revision regression timed out on its first directory watcher while the next case passed in 71 ms ([run evidence](https://github.com/Dytschgo/imnota/actions/runs/43879239780/job/133340755757)). The follow-up watches the edited file directly, crosses two check phases to guarantee an intervening poll before releasing the guarded write, and awaits the real notification and edit together. This uses macOS kqueue rather than cold FSEvents directory startup ([Node documentation](https://nodejs.org/docs/latest-v22.x/api/fs.html#availability)); it also propagates watcher errors. Byte equality, same-size replacement and preserved mtime assertions remain. No sleeps, retries or increased timeout. All four focused Windows cases pass; independent re-review cleared the two-phase ordering correction with no remaining blocking findings. The macOS CI job explicitly passed all four cases in 129 ms, and every required gate passed before merge in [PR #346](https://github.com/Dytschgo/imnota/pull/346) as `29d5d6a`.
  - Completed in [PR #343](https://github.com/Dytschgo/imnota/pull/343): the screenshot-comparison walkthrough sometimes focused its zoom control before the control has rendered. A save advances `projectRevision` and remounts the comparison images; the saved status does not establish image/control readiness. The follow-up waits for both new zoom controls and decoded images after each save, then observes the Done dialog dismissal. On Windows, `corepack pnpm build` and the full `corepack pnpm smoke` passed all 38 assertion groups on the comparison-fix implementation; independent review found no standards/spec issues. All three packaged OS jobs passed on final head `1e65727` before merge as `999f4c4`.
  - Fractional timestamp follow-up, completed in [PR #348](https://github.com/Dytschgo/imnota/pull/348): #347's macOS platform job reached the real edit but failed the unchanged mtime assertion at exactly 0.5 ms ([failure evidence](https://github.com/Dytschgo/imnota/actions/runs/44152947995/job/134300469340)). The external-edit helper restored `Date` fields, losing sub-millisecond precision from `Stats.*timeMs`. The fix restores numeric seconds from the precise millisecond fields. Both native watch-revision cases now seed fractional timestamps and enforce a stronger five-microsecond preservation bound; they fail with the Date-based helper and pass with the fix on Windows. No retry, sleep or tolerance widening. Independent review found no issues. Windows build, lint/typecheck and full tests passed (2,901 application tests and 327 script tests; 7 and 21 skips respectively). All required platform gates passed, with all four macOS cases passing in 125 ms, before merge as `1e1caab`.
- **Evidence check, under verification:** downloaded evidence must pass both its unchanged hash inventory and the current catalog's complete aggregate, exact case-set directory list, per-set reports and per-case evidence. Missing, duplicate, failed and retired sets fail closed even when their upload manifest has valid hashes. Reports remain bound to their set proof and version; case evidence is checked against its report digest and catalog fault requirements. All 18 corrupt-artifact regressions and the full Windows script suite passed (345 tests, 21 skipped). The new verifier accepted existing Windows/macOS/Linux artifacts from #346, and independent CI-gate review found no issues. The current platform CI run remains required before merge.

## Execution and completion

Use descriptive branches and coherent commits. Commit-message tooling, hard size gates, repository settings, and cleanup scripts are optional follow-ups with their own benefit and maintenance cost; they are not prerequisites for this plan.

For each authorized slice, state the user or engineering problem, scope, applicable verification tier, and expected evidence. Fix review findings before merge. Continue through the approved scope; seek clarification only for a material decision or authorization gap.

Completion means the requested change is reviewable, the applicable evidence is recorded, and any authorized merge or release has been verified. Report skipped or pending checks honestly. A shorter file, fewer tests, or a green rerun by itself does not establish a better release process.
