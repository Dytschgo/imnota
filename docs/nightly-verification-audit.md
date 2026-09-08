# Nightly verification audit

The audit covers workflow scheduling, test commands, shared smoke entry points, and release gates. It does not claim that every individual assertion in the application suite has been reviewed.

## Measured baseline

[Successful nightly 34266014334](https://github.com/Dytschgo/imnota/actions/runs/34266014334), commit `cededd36170bf4639cb8abe34c918cab6a0c0bea`, GitHub-hosted runners:

| Work                                             | Duration | Decision                                                                                               |
| ------------------------------------------------ | -------: | ------------------------------------------------------------------------------------------------------ |
| Guard through publication                        |  10m 25s | Baseline wall time                                                                                     |
| Quality job before packages can start            |   2m 43s | Run alongside packaging                                                                                |
| Formatting + lint                                |      15s | Keep: cheap, distinct checks                                                                           |
| Type checking                                    |      12s | Keep: renderer and Electron contracts                                                                  |
| Application and script tests                     |      44s | Keep: meaningful regression and boundary coverage                                                      |
| Share service install, tests, audit and contract |       7s | Keep: security and desktop/service compatibility                                                       |
| Extra release-channel and asset-staging tests    |      <1s | Remove duplicate invocation; already in `pnpm test`                                                    |
| Quality build + unpackaged Linux walkthrough     |      69s | Remove from nightly; each package builds and runs the same smoke entry point against the distributable |
| macOS packaging                                  |   3m 21s | Keep: required universal archive and installer                                                         |
| macOS archive/native verification                |   1m 22s | Keep: architecture, signature, launch and user flows                                                   |
| Windows native verification + visual comparison  |   1m 28s | Keep: user flows and all 14 approved visuals                                                           |
| Linux packaged verification                      |      39s | Keep: extracted AppImage launch and user flows                                                         |

## Changes and expected effect

Packaging now depends only on the exact-main-commit guard. Publication still depends on successful guard, quality, and every package job. No failure is ignored and no publish condition is relaxed. All jobs use the same immutable commit from the guard.

Removing the serial quality dependency would have shortened this run by roughly 2m 43s, from 10m 25s to about 7m 42s (26%), assuming similar queue and runner timings. This is a projection from the observed job graph, not a measured optimized run. Removing the duplicate quality build/walkthrough also avoids about 69 seconds of runner work. These savings are not additive wall-time savings once quality runs alongside packaging.

The tradeoff is that package runners can spend work on a candidate whose quality checks later fail. Those artifacts cannot publish. This favors release latency over early cancellation of runner work.

## Coverage retained and further findings

- All existing application tests, script tests, format, lint, type checks, service security checks and contract checks remain in nightly quality.
- Release-channel and asset-staging tests still run once through `pnpm test`.
- The three actual distributables still build and run native verification. Windows visual tolerances and baselines are unchanged.
- Manifest validation, complete asset-set validation, SHA-256 generation, draft-first publication, and stable-release isolation remain intact.
- PR/main CI still runs its unpackaged walkthrough and full platform suites. The removed nightly walkthrough therefore retains developer-build coverage there, as well as packaged coverage in nightly.
- PR CI repeats the full suite across the platform matrix. Some renderer-only tests could eventually run on Linux alone, but platform filesystem, path, symlink, update and native tests must remain. This audit does not delete those suites without a separate coverage map.
- Two native test readiness problems were corrected. The Markdown search check now waits for the search dialog to close and the matching content to load, instead of accepting the old editor behind the dialog. Double-clicks now queue both trusted click pairs before yielding, preventing main-process scheduling between clicks from exceeding the canvas double-click window. A driver regression test checks that ordering. Assertions and visual tolerances remain intact; no automatic retries were added.

## Validation

Validate workflow syntax and the dependency graph, confirm every package still builds and verifies the guard SHA, and confirm publication requires all gates. Run formatting and the existing release tests. Compare a future optimized hosted nightly against the baseline above before claiming a measured speedup.
