# Verification timing and duplicate updater coverage

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
