# Repository review — 2026-09-08

Reviewed the code and documentation at `107fc5920a6e829ec1b8dec10a21ad8a711e0fe8`, after [nightly publication](https://github.com/Dytschgo/imnota/releases/tag/v0.2.6-nightly.20260907.34169995806). This record covers the subsequent maintenance review; it does not change the published binaries.

## Release evidence

[PR #23](https://github.com/Dytschgo/imnota/pull/23) delivered hosted sharing and the remaining workflow fixes. [PR #24](https://github.com/Dytschgo/imnota/pull/24) corrected native screenshot capture timing after a nightly correctly rejected a partially painted onboarding screen. Capture now requires three matching actual pixel frames; approved baselines and comparison tolerances were not changed.

The final [nightly run](https://github.com/Dytschgo/imnota/actions/runs/34169995806) passed all platform jobs and published 13 assets. Public download checks verified platform binaries, all three nightly manifests and the exact source tag. Stable v0.2.5 stayed Latest. The live sharing service passed synthetic create/read/download/restart/revoke checks; see its [deployment record](../share-service/docs/deployment-verification.md).

## Plan and documentation disposition

| Document or draft                                                                        | Disposition                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root implementation plan                                                                 | Replaced the prospective phase list with shipped status, exact release evidence, open acceptance work and links to future proposals. The complete original specification remains linked at its immutable commit. |
| Mixed-content model and product roadmap drafts                                           | Incorporated useful uncommitted documentation from the original worktree, checked it against schema-4 code and updated shipped-versus-future wording. Originals were preserved.                                  |
| README, user guide, data format and architecture                                         | Updated screenshot-only/schema-3 descriptions, documented optional sharing and its privacy boundary, and corrected unreleased status claims.                                                                     |
| Stable/nightly plan                                                                      | Retained as a historical design record with a link to the implemented process and published evidence.                                                                                                            |
| Clipboard compatibility plan                                                             | Still relevant: actual receiving-editor acceptance remains unverified by native clipboard tests.                                                                                                                 |
| Feedback implementation plan, collection-04 review and September 5 engineering/PR audits | Retained as historical evidence. Their old test counts and findings are not current release claims.                                                                                                              |
| Implementation verification                                                              | Explicitly marked as the historical schema-3 benchmark; current status links replace the misleading opening statement.                                                                                           |
| Website build prompt in the original worktree                                            | Preserved as separate-site work. It is not an application implementation task and was not merged into this maintenance change.                                                                                   |

Future capture, PDF, full Excalidraw interchange, presets and history proposals remain in the roadmap. This cleanup does not implement them or treat a proposal as an accepted requirement.

## Open pull requests

All five open PRs were inspected; there were no open issues. These version-only major upgrades have failing required quality checks and existing changes-requested reviews. None qualifies for a safe merge. They remain open, with no protection bypass or review dismissal.

| PR and inspected head                                                         | Finding and disposition                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#4 Electron 44](https://github.com/Dytschgo/imnota/pull/4), `5c7a949`        | Clipboard API removals and async changes break type checks and platform packages. Defer for a coordinated clipboard migration and native receiving-app validation.                                                        |
| [#5 React-Konva 19](https://github.com/Dytschgo/imnota/pull/5), `a44483e`     | Runtime requires React 19 despite permissive peer metadata; the app fails to mount with the retained React 18. Defer for a coordinated renderer upgrade.                                                                  |
| [#6 Zod 4](https://github.com/Dytschgo/imnota/pull/6), `dff831d`              | Record schemas and inferred IPC/persistence types fail. Defer for explicit schema migration and recovery/security regression coverage.                                                                                    |
| [#7 React Hooks lint 7](https://github.com/Dytschgo/imnota/pull/7), `5e077b1` | Fresh isolated upgrade on current main reproduces 41 errors in nine source files, including persistence and export hooks. Defer for a scoped React behavior refactor; do not disable recommended rules to merge the bump. |
| [#8 Tailwind 4](https://github.com/Dytschgo/imnota/pull/8), `87fbeac`         | Existing PostCSS integration and v3 directives fail with a version-only bump. Defer for coordinated plugin/style migration and visual regression checks.                                                                  |

The Hooks reproduction changed only dependency files in a separate worktree. No runtime or lint-policy changes were integrated. Compiler-oriented lint findings alone do not prove a user-visible bug; any refactor must preserve persistence, cancellation and async identity behavior with regression tests.

## Major code finding and correction

The review found a data-loss path in `App.tsx`: both update entry points set the close bypass before calling the native installer, but never cleared it after installation failed. An edit made afterward could bypass the normal save-before-close flow.

Both entry points now share an install callback. A rejected handoff restores the guard immediately; native rollback status and newly dirty screenshot/content state also revoke the bypass. A successful handoff without new edits retains permission to quit, because Electron can schedule that quit after the IPC call returns. Regression coverage exercises rejection, asynchronous rollback, an abandoned resolved handoff followed by edits, and successful close without new edits. This correction is subsequent source work and is not in the already published nightly binaries.

The review also found that collection mutations acquired their busy state after awaiting the save preflight. Rapid actions could enter twice and create duplicate collections. The operation now takes a synchronous lock before saving and releases it on every success, failure or blocked save. Regression tests verify single admission during a deferred save and retry after blocked or rejected saves.

## Scope and remaining checks

The repository-wide review concentrates on data loss, persistence/recovery, export/resource handling, IPC boundaries, renderer async behavior and updates. The preceding sharing review covered the service/client security boundary in detail. Neither review substitutes for external editor paste trials, private-browser recipient visual QA, user sessions, photographic/high-entropy stress fixtures or long-running memory profiling.

Existing user and agent worktrees were preserved, including uncommitted files in the original checkout. Branch age or a squash merge is insufficient evidence that a worktree has no unique work; cleanup does not discard those files.
