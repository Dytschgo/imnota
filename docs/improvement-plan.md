# Imnota improvement plan

Goal: shorten the time from a reviewed change to a verified release while preserving data integrity and platform coverage. Work in small, complete PRs under [AGENTS.md](../AGENTS.md). This plan distinguishes completed work, the next measured experiment, and later candidates; listing a task does not authorize its implementation.

## Completed baseline

[PR #34](https://github.com/Dytschgo/imnota/pull/34) delivered:

- [x] Nightly quality and packaging run concurrently after the exact-main-commit guard. Publication still requires quality and every package job to succeed.
- [x] Remove duplicate release-test invocation and the extra nightly build/unpackaged Linux walkthrough. Packaged verification remains on all three OSes; PR/main CI retains the unpackaged walkthrough.
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

[PR #36](https://github.com/Dytschgo/imnota/pull/36) mapped all tests and retained the full suite in Linux quality. Each package job now repeats the 37 unexcluded application test files and all script tests. The 41 exact renderer exclusions were reviewed for simulated or platform-independent behavior; new tests remain in platform runs by default. See the [coverage map](pr-test-coverage.md).

In one successful PR-run comparison ([before](https://github.com/Dytschgo/imnota/actions/runs/34276483712), [after](https://github.com/Dytschgo/imnota/actions/runs/34277727340)), the package test step fell from 82s to 36s on Windows, 85s to 52s on macOS, and 42s to 20s on Linux. All native, visual, security, and quality checks passed. Workflow-level queue delay was zero at API timestamp resolution in both runs; runner scheduling and total job times vary. No test cases were deleted and release gates were unchanged.

The reviewed coverage map accounts for every existing test and defaults new tests to full platform coverage. Full packaged walkthroughs, Windows visuals, hosted sharing contracts, and service security checks remain. No required check or publication gate was removed.

## 3. Follow-up speed and reliability work

Choose the next item from measured cost and failure frequency, rather than implementing this entire list automatically.

Completed follow-up experiments:

- [PR #37](https://github.com/Dytschgo/imnota/pull/37) retains useful [CI review artifacts](ci-artifacts.md) without duplicate unpacked folders. All three archive inventories were inspected after native verification. Stored package bytes fell about 46%; upload steps fell from 29s to 6s on Windows, 29s to 4s on Linux, and 83s to 8s on macOS in one successful before/after PR comparison.
- [PR #38](https://github.com/Dytschgo/imnota/pull/38) introduces conservative [documentation-only PR routing](ci-routing.md). Every original check name still reports. Full formatting, CodeQL, and dependency review remain; main pushes and uncertain or mixed changes retain full application/platform verification. A subsequent prose-only documentation PR verifies the hosted shortcut before savings are claimed.

Both changes received independent review. Measurements and limitations are recorded in the linked documents and PRs. These completed slices establish a faster release process without turning the remaining candidates into automatic refactors.

| Candidate                     | Investigation and acceptance                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR artifact uploads           | Completed in PR #37; monitor artifact usefulness and upload measurements.                                                                                                                                                                                                                                          |
| Electron/build caches         | Inspect actual per-OS cache locations, hit rates, restore cost, and downloaded bytes. Key caches for the relevant OS, architecture, and dependency versions; retain integrity checks. Compare cold and warm runs before promising savings.                                                                         |
| Documentation-only CI routing | Implemented in PR #38; verify the first prose-only PR and retain conservative classification.                                                                                                                                                                                                                      |
| Stable release duplication    | Stable release currently repeats static checks and the full suite per platform. Evaluate one quality job alongside packaging, preserving exact-candidate gating, platform tests, public-install verification, and promotion checks. Nightly already has concurrent quality; do not reintroduce its old dependency. |
| Slow or flaky tests           | Collect test durations and failure traces on each OS. Replace unnecessary waiting or oversized fixtures while retaining real locking, atomic-write, recovery, and native-input coverage. Track failed attempts as well as green-run speed.                                                                         |
| Reduced PR macOS package      | Pilot a single-architecture ZIP only if the architecture/signature verifier and artifact contract are adapted together. Keep relevant native launch coverage and full universal DMG/ZIP verification for release candidates. Treat lost PR architecture coverage as an explicit tradeoff.                          |

For each implemented experiment, record the before/after commit and run URLs, event type, runner/architecture, check coverage, job durations, queue delay, artifact sizes, and reruns. Use multiple comparable runs when possible; label single-run comparisons and estimates clearly. Roll back an optimization that creates coverage gaps or unreliable evidence.

Deferred after this pass:

- The observed macOS dependency cache already restored about 230 MB in roughly 9s and reused all 802 packages without package downloads. Electron/build-helper downloads remain a separate candidate, but no cold/warm pilot establishes that another cache would repay its restore and maintenance cost yet.
- Stable-release deduplication needs its own tag/public-install/promotion validation. This pass changes no stable release contract and does not publish a stable version just to benchmark it.
- Keep universal macOS PR packaging and all native verification. Reducing architecture coverage is a separate tradeoff, not necessary for these measured savings.
- Structural work below remains conditional on a demonstrated defect or maintenance boundary. No mass IPC, persistence, state, lint, or test-runner migration is required to release the current improvements.

## 4. Structural improvements, driven by recurring problems

These are candidates for focused investigation, not prerequisites for releasing or commitments to a specific architecture.

- **IPC boundaries:** extract one domain from `electron/main.ts` when its coupling makes changes or tests difficult. Preserve IPC validation, behavior, and ownership. Evaluate testability and review effort rather than a target line count.
- **Persistence and recovery:** characterize journal replay, partial writes, conflict handling, undo, and restart recovery before consolidation. Compare screenshot/content semantics before proposing a shared abstraction. Require independent review and a recovery plan for changes to data-loss paths.
- **Renderer state and canvas/export code:** use repeated defects or change friction to select one boundary. Pilot a focused hook, reducer, or module; do not migrate every state owner or force new libraries in one effort.
- **Types and lint:** narrow duplicated types one domain at a time. Evaluate existing violations before enabling repository-wide compiler/lint failures; use a workable baseline or include the necessary fixes. A global rule does not automatically apply only to new code.
- **Smoke harness packaging:** measure startup loading and packaged size separately. Dynamic import defers loading but does not exclude emitted files under current packaging globs. Any exclusion needs an explicit artifact design and a way to verify the actual shipped application.
- **Test runner or browser-driver migration:** pilot one representative flow only if it improves reliability or maintenance. Preserve trusted input, native clipboard, packaging, filesystem, and recovery evidence. Consolidating reports alone does not justify replacing working runners.
- **Assets, styles, and docs:** investigate demonstrated resolution problems, duplication, and stale guidance. Keep intentional bundled artwork and approved visual baselines. Archive obsolete plans with links, and do not rewrite published history to remove old assets.

## Execution and completion

Use descriptive branches and coherent commits. Commit-message tooling, hard size gates, repository settings, and cleanup scripts are optional follow-ups with their own benefit and maintenance cost; they are not prerequisites for this plan.

For each authorized slice, state the user or engineering problem, scope, applicable verification tier, and expected evidence. Fix review findings before merge. Continue through the approved scope; seek clarification only for a material decision or authorization gap.

Completion means the requested change is reviewable, the applicable evidence is recorded, and any authorized merge or release has been verified. Report skipped or pending checks honestly. A shorter file, fewer tests, or a green rerun by itself does not establish a better release process.
