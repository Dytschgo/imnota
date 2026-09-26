# Verification timing and duplicate updater coverage

## September 26 restore-test deadline

Windows [Validate run 36267088449](https://github.com/Dytschgo/imnota/actions/runs/36267088449) failed before packaging because `returns committed restore paths when both journal publication and recovery cleanup fail` exceeded Vitest's default five-second limit. It creates a historical snapshot, publishes a safety snapshot and restored project, injects journal/cleanup failures, verifies both project versions, and recovers the retained journal. The test now uses the existing 15-second `DURABLE_FILESYSTEM_TIMEOUT` allowance for multiple durable publications on Windows. Real filesystem operations, fault injection, assertions and recovery remain unchanged. No retries were added; fresh CI must pass.

## September 26 packaged smoke budget

Windows [Validate run 36265303628](https://github.com/Dytschgo/imnota/actions/runs/36265303628) at `07a2d9fb056e3a6f55fe095dda7dd1c72612e43d` retained a passing application report with all 27 assertion groups and a final workflow checkpoint at 224.909 seconds. The packaged process hit the launcher's four-minute limit; cleanup then reported a locked Chromium `DIPS` profile file. This run remains failed. The neighbouring stack run took 200 seconds overall, including a 177-second workflow, showing that portable extraction, startup and shutdown also consume the process budget.

The outer smoke process deadline is now six minutes, allowing the observed full walkthrough plus that overhead. Individual operation deadlines, failure assertions, cleanup ownership checks and the 15-minute stress deadline are unchanged. There are no retries. The new revision must pass fresh packaged verification; the retained application report alone does not satisfy the failed gate.

## Earlier updater timing audit

Profiling the existing [three-platform CI logs](https://github.com/Dytschgo/imnota/actions/runs/34284213202/attempts/2) identified duplicate packaged-updater execution on macOS. PR/main CI builds before `test:platform`, whose script suite already includes `scripts/update-macos.test.mjs`. The later Mac verification step invoked that entire file again.

In that run, the real ZIP installation/rollback-copy case took 19.47s in the platform suite and 20.30s in the repeated invocation. It exercised the same archive and test code twice. Other measured steps were:

| Platform | Platform tests | Packaged verification |
| -------- | -------------: | --------------------: |
| Linux    |            17s |                   39s |
| Windows  |            36s |                   78s |
| macOS    |            45s |                  104s |

These step timings include setup and platform-specific work. They identify investigation targets, not interchangeable coverage or guaranteed release savings. The logs come from an archive-cache experiment, but that experiment did not change tests or native verification. Build-cache results are [recorded separately](build-cache-experiment.md).

PR/main CI now sets `IMNOTA_REQUIRE_MAC_UPDATE_TEST=1` on the macOS platform-suite step. The existing test-file startup assertions require macOS, Bash, and the packaged ZIP, so the real updater case cannot silently skip because its archive is missing. The suite must succeed before the existing signature/architecture checks and native walkthrough in `verify-mac.sh` run. Linux and Windows still execute the same platform/script suites without the Mac-only requirement. No test case, native assertion, or package target is removed.

The second updater-file invocation is removed from PR/main CI. Stable CI retains its required post-package updater invocation because its platform suite runs before packaging; nightly routing is unchanged. This improvement shortens PR/main verification and does not claim a direct nightly or stable timing reduction.

Validation includes Actionlint, formatting, existing routing/updater tests, independent review, and full hosted CI with the real updater case visibly passing once on macOS. Compare the platform-suite and Mac-verifier steps together, since enforcement moved between them; preserve failed attempts and runner variance when reporting timings. A revert of this workflow change restores the duplicate invocation without affecting application data or release assets.

## September 22 validation audit

Validate's Linux quality job no longer rebuilds and repeats the native walkthrough. The Linux package job already runs the same TypeScript/Vite build through `package:linux`, then invokes `scripts/smoke.mjs` against the extracted AppImage. Both launch paths clear the Vite development URL and run the same built renderer, fixture workflow, report checks, and timeout. Packaged Windows and macOS walkthroughs, Windows visual comparisons, and every assertion in the smoke workflow remain. Local `pnpm smoke` remains available. CI deliberately gives up the extra unpackaged Linux launch check; neither smoke path verifies the Vite development server.

In successful main [Validate run 35657289923](https://github.com/Dytschgo/imnota/actions/runs/35657289923) at `11f555416e17229dfff2b0252e199add5f07f115`, quality's redundant build took 21 seconds and unpackaged smoke took 73 seconds; packaged Linux verification took 65 seconds. Removing those steps avoids 94 seconds of work at that run's timings, not a promised reduction in merge latency: package jobs run in parallel and may remain the critical path. Nightly and stable workflow steps are unchanged.

The same audit found five newer portable renderer test files repeated in all package jobs and a nested `.claude/worktrees/` checkout leaking 140 foreign tests into local discovery. See the [coverage map](pr-test-coverage.md) and [development guidance](development.md) for the scoped exclusions and added policy regression tests. No application test assertions were deleted. Lint, type checking, workflow lint, formatting, service security, filesystem tests, and visual tolerances retain distinct responsibilities and were kept.

## September 26 native drag synchronization

macOS [Validate run 36267669950](https://github.com/Dytschgo/imnota/actions/runs/36267669950) failed the real outside-crop arrow assertion. The trusted mouse-up trace reached `(1120, 614)`, beyond the cropped image's right edge at `1104`, but the persisted arrow endpoint remained inside the crop. The driver had released the gesture after fixed 16 ms move intervals without observing delivery to the renderer. It now waits for a trusted pointer move at the requested endpoint with the button held, followed by two animation frames, before releasing. The existing bounded evaluation deadline still fails if that event never arrives. Cleanup releases the button and removes the listener even on failure. Native input and the persisted outside-crop assertion remain; no retries or application-state mutation were added. Driver regression tests cover delayed delivery, ignored untrusted/wrong-coordinate/button-up events, and missing-event failure.
