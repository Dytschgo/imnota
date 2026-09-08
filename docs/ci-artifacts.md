# CI review artifacts

The Validate workflow builds and verifies the same Windows, Linux, and universal macOS packages as before. Its `imnota-windows-latest`, `imnota-ubuntu-latest`, and `imnota-macos-latest` artifacts retain top-level installers and archives, updater manifests and blockmaps, and builder diagnostic YAML when produced. Unpacked application folders and intermediate packaging output remain available to the native verification steps on the runner but are not uploaded again.

No repository workflow or script consumes these `imnota-*` artifacts. They are downloads for review and troubleshooting. The separate Windows visual/failure evidence artifact still uploads with `always()`. Nightly and stable publication use their own artifact contracts and are unchanged by this CI-only adjustment.

Package artifacts use upload compression level 0 because their installers and archives are already compressed. The [upload-artifact documentation](https://github.com/actions/upload-artifact#altering-compressions-level-speed-v-size) recommends this for large files that do not compress well. Small diagnostic YAML travels with them; visual evidence keeps its existing compression. Missing upload matches fail the job. This check does not assert that every expected installer exists: the existing package and native verification steps still establish the package result.

## Baseline and measurement

The preceding documentation-only [PR run 34276483712](https://github.com/Dytschgo/imnota/actions/runs/34276483712), head `fa853a749d88c5c2ae6b78f419b3c5824e1bf4e9`, uploaded all of `release/`:

| Runner                                    | Artifact bytes | Upload step |
| ----------------------------------------- | -------------: | ----------: |
| `windows-latest`                          |    593,500,710 |         34s |
| `ubuntu-latest`                           |    600,723,798 |         28s |
| `macos-latest` (arm64, universal package) |  1,315,661,684 |         80s |

The macOS upload contained 814 files. Times use GitHub job-step timestamps rounded to seconds; the workflow-level queue delay was zero at API timestamp resolution. This experiment changed no application/package input or package target; separate builds are not claimed to be byte-identical. Candidate measurements are recorded below and in PR #37. A single comparison is evidence for this run, not a promise about every runner or upload.

To recover the previous artifact shape, revert the Validate upload step to `path: release/` and its default compression. No application data or release-channel migration is involved.

## Verified result

[PR #37](https://github.com/Dytschgo/imnota/pull/37), head `b4eb869e3ffecff70f3db8bb36200c13c99251d9`, passed [Validate run 34278871246](https://github.com/Dytschgo/imnota/actions/runs/34278871246) and CodeQL on its first attempt. Independent review accepted that revision. The closest baseline is the successful preceding [PR #36 run 34277727340](https://github.com/Dytschgo/imnota/actions/runs/34277727340), head `1791b495bc0dded1bfda45387ac65f7ce52a7b9d`, with the same application and test routing.

| Runner  |  Before bytes | After bytes | Before upload | After upload | Before package job | After package job |
| ------- | ------------: | ----------: | ------------: | -----------: | -----------------: | ----------------: |
| Windows |   593,500,705 | 356,457,764 |           29s |           6s |               364s |              355s |
| Linux   |   600,724,420 | 388,581,619 |           29s |           4s |               303s |              254s |
| macOS   | 1,315,661,924 | 599,707,488 |           83s |           8s |               538s |              396s |

Total stored package bytes fell about 46%. Both runs were PR events with zero workflow-level queue delay at API timestamp resolution; runner scheduling, build, and native-check times vary. The whole package-job difference must not be attributed solely to uploading. Neither comparison run required a rerun.

Remote ZIP directory inspection confirmed five Windows members (NSIS and portable EXEs, NSIS blockmap, manifest, debug YAML), four Linux members (AppImage, deb, manifest, debug YAML), and six macOS members (universal ZIP/DMG, both blockmaps, manifest, debug YAML). All members were top-level and nonempty. The optional effective-config YAML was not emitted in this run. Separate Windows visual evidence remained present.
