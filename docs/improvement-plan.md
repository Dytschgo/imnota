# Imnota improvement plan

Goal: shorten the time from a reviewed change to a verified release while preserving data integrity and platform coverage. Work in small, complete PRs under [AGENTS.md](../AGENTS.md). This plan distinguishes completed work, the next measured experiment, and later candidates; listing a task does not authorize its implementation.

## Completed baseline

[PR #34](https://github.com/Dytschgo/imnota/pull/34) delivered:

- [x] Nightly quality and packaging run concurrently after the exact-main-commit guard. Publication still requires quality and every package job to succeed.
- [x] Remove duplicate release-test invocation and the extra nightly build/unpackaged Linux walkthrough. Packaged verification remains on all three OSes; PR/main CI retains the unpackaged walkthrough.
- [x] Correct premature Markdown-search assertions and native double-click scheduling in the smoke driver without weakening assertions or adding automatic retries.

The [baseline nightly](https://github.com/Dytschgo/imnota/actions/runs/34266014334) took 10m 25s from guard start to publication-job completion. The [optimized nightly](https://github.com/Dytschgo/imnota/actions/runs/34274745361) took 7m 17s: 3m 08s, or about 30%, less in that single comparison. Queue, runner, and upload timing vary; this is observed evidence, not a guaranteed improvement. See the [verification audit](nightly-verification-audit.md) for the original measurements and coverage rationale.

## 1. Working agreement and verification tiers

Current documentation-only slice:

- [x] Replace hard PR-size stops with warnings and justified exceptions.
- [x] Keep cohesive backend/UI/test changes and required dependency updates together.
- [x] Allow agents to complete an approved plan without pausing at every slice.
- [x] Define documentation, application, platform, build/CI, and release verification tiers in [AGENTS.md](../AGENTS.md#verification-by-impact).
- [x] Correct stale assumptions and move broad refactors into a conditional backlog.

Acceptance: both documents agree, commands and local links are valid, and it is clear that no existing CI gate or repository setting changes in this slice. The tiers guide local work now; automated routing requires the next reviewed CI change.

## 2. Next experiment: remove redundant PR test execution

Before changing the matrix, map the current tests by the behavior they protect and record their durations. Include Electron, renderer, shared-code, script, and service tests. A directory name or jsdom environment alone does not prove OS independence.

Proposed change after that map is reviewed: run the full application suite once in Linux quality; keep the identified OS-sensitive subset on Windows/macOS. Retain native packaged walkthroughs and necessary filesystem, clipboard, path, update, and recovery coverage. Preserve service-specific checks. Do not remove all macOS launch verification because Linux smoke passed.

Deliver one CI PR containing the coverage map and the narrowly scoped routing change. If the map finds no safe reduction, retain the checks and report the evidence instead.

Acceptance:

- Every existing test has an execution location; tests removed from a repeated OS run still run in the full suite.
- A new test cannot silently escape both the full suite and the applicable platform checks. Document how OS-sensitive additions are classified and reviewed.
- Unknown or broadly affecting changes use the broader checks; required-check names still report a result.
- No release/publish gate is weakened. Compare representative successful PR runs before and after, recording runner queue time separately.

## 3. Follow-up speed and reliability work

Choose the next item from measured cost and failure frequency, rather than implementing this entire list automatically.

| Candidate                     | Investigation and acceptance                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR artifact uploads           | Identify consumers. Upload useful failure evidence and review artifacts; avoid redundant unpacked output when nobody uses it. Keep the complete release asset set, including updater blockmaps. Measure upload duration and bytes.                                                                                 |
| Electron/build caches         | Inspect actual per-OS cache locations, hit rates, restore cost, and downloaded bytes. Key caches for the relevant OS, architecture, and dependency versions; retain integrity checks. Compare cold and warm runs before promising savings.                                                                         |
| Documentation-only CI routing | Specify safe path classification, including changes to instructions, build docs, and workflows. Skip application work only for changes proven to be prose-only; preserve required-check reporting.                                                                                                                 |
| Stable release duplication    | Stable release currently repeats static checks and the full suite per platform. Evaluate one quality job alongside packaging, preserving exact-candidate gating, platform tests, public-install verification, and promotion checks. Nightly already has concurrent quality; do not reintroduce its old dependency. |
| Slow or flaky tests           | Collect test durations and failure traces on each OS. Replace unnecessary waiting or oversized fixtures while retaining real locking, atomic-write, recovery, and native-input coverage. Track failed attempts as well as green-run speed.                                                                         |
| Reduced PR macOS package      | Pilot a single-architecture ZIP only if the architecture/signature verifier and artifact contract are adapted together. Keep relevant native launch coverage and full universal DMG/ZIP verification for release candidates. Treat lost PR architecture coverage as an explicit tradeoff.                          |

For each implemented experiment, record the before/after commit and run URLs, event type, runner/architecture, check coverage, job durations, queue delay, artifact sizes, and reruns. Use multiple comparable runs when possible; label single-run comparisons and estimates clearly. Roll back an optimization that creates coverage gaps or unreliable evidence.

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
