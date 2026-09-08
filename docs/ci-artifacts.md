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

The macOS upload contained 814 files. Times use GitHub job-step timestamps rounded to seconds; the workflow-level queue delay was zero at API timestamp resolution. The installer contents have not changed in this experiment. Record the candidate run's bytes, upload times, scheduling delay, and reruns in its PR before merging. A single comparison is evidence for this run, not a promise about every runner or upload.

To recover the previous artifact shape, revert the Validate upload step to `path: release/` and its default compression. No application data or release-channel migration is involved.
