# Stable and nightly builds

Status: plan, not an enabled distribution system. Prepared on 2026-09-05 with Luna (`gpt-5.6-luna`), Terra (`gpt-5.6-terra`) and Astra review. The local release-readiness gate is a separate implementation; no nightly release, channel selector or GitHub protection change has been published.

## Product decision

Use one public repository, `Dytschgo/imnota`, with two release channels. Stable stays the default. Nightly is an explicit opt-in for people testing changes. A merge to main must never publish a stable release automatically.

|                 | Stable                                    | Nightly                                                              |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Audience        | Daily use                                 | Early testing                                                        |
| Version example | `0.3.0`                                   | `0.3.0-nightly.20260905.1234`                                        |
| Git tag         | `v0.3.0`                                  | `v0.3.0-nightly.20260905.1234`                                       |
| GitHub release  | Published release, eligible for Latest    | Prerelease, never Latest                                             |
| Update channel  | `latest`                                  | `nightly`                                                            |
| Publication     | Explicit release request after acceptance | Manual dispatch initially; optional scheduled build after validation |

Examples are naming examples, not releases that exist. Nightly versions use the next intended stable version plus date and a unique CI run identifier. Never reuse tags or overwrite an existing version's binaries.

## What the audit found

- `.github/workflows/ci.yml` already runs quality checks and packages Windows, macOS and Linux. Packaged Mac archives are launched; equivalent installed Windows/Linux smoke checks are missing.
- `.github/workflows/release.yml` currently matches `v*.*.*`, publishes publicly, and then tests the public Mac installer. That pattern also matches prerelease tags. It must be classified before any nightly tags are introduced.
- `scripts/release.mjs` already requires a clean, exact `origin/main` commit and a version prepared through a PR. A local release gate cannot prevent someone manually pushing a tag.
- Terra's read-only GitHub audit found only `quality` required by branch protection and administrator enforcement disabled. Treat this as a point-in-time finding; recheck before configuring required checks. Historical audit documents are not proof of current protection.
- macOS currently uses ad-hoc signing and manual replacement through the download page. Adding a channel choice does not enable signed automatic Mac installation.

## Settings and update behaviour

Add **Update channel** to Settings → App updates, with **Stable (recommended)** and **Nightly (preview)** choices. Reuse the existing update control and semantic styles. The sidebar refresh button checks the selected channel; it does not reload the page or switch channels.

Persist `updateChannel: 'stable' | 'nightly'` in local settings, defaulting missing values to stable. Validate this enum through the existing typed IPC contract. Show installed version, selected channel, update progress and actionable failures.

Switching to nightly requires confirmation: “Nightly builds may contain unfinished changes. Back up your workspace before switching.” Changing the setting checks for a release but does not silently install it. Disable switching while downloading/installing so a queued stable update cannot be mistaken for a nightly update, or vice versa. Cancel/discard stale check results using a generation identifier.

Switching back to stable must not silently downgrade or rewrite project files. Explain when the installed nightly is newer than stable. Wait for a newer stable release or offer the exact stable installer with a backup warning. Keep existing projects and settings when replacing the app.

### Pinned updater behaviour to preserve

Inspected locally: `electron-updater@6.8.9`, `out/providers/GitHubProvider.js` and `out/AppUpdater.js`.

- Set channel explicitly to `nightly` and `allowPrerelease = true` for nightly. The provider matches the first prerelease identifier against the custom channel.
- Stable uses `latest` and `allowPrerelease = false`.
- Assigning `channel` sets `allowDowngrade = true` internally. Explicitly set it back to `false` **after** every channel assignment.
- The provider may fall back to a default manifest if a prerelease manifest is missing. Validate release assets before publication and test missing-manifest behaviour; do not rely on fallback for correct channel separation.
- Mac manual update discovery must use the same channel selection rules, exclude drafts, paginate if necessary, validate release/version/asset names and open the exact selected release. `/releases/latest` is stable-only and must not be used for nightly downloads.

Keep the current application identity and installation model initially. This is a channel switch, not two simultaneously installed apps. Separate app identities and separate workspaces would be a later product decision.

## Repository and pipeline design

1. Feature branches target protected main. Each PR includes acceptance criteria, automated regression tests, manual evidence where relevant, known limitations and an independent review.
2. CI builds preview artifacts for each platform without publishing a release. Add installed-artifact smoke checks for Windows/Linux and preserve Mac verification. Use synthetic project data.
3. Add a single fail-closed release classifier. Stable tags must match `^v[0-9]+\.[0-9]+\.[0-9]+$`; nightly tags must match the defined nightly version pattern. Reject any other format before jobs with write permissions. Ensure workflow triggers cannot launch both publication paths for one tag.
4. Nightly candidates come from reviewed main, initially via manual workflow dispatch. Run quality, smoke and package checks before publishing a GitHub prerelease with `make_latest: false`. A later schedule should skip unchanged commits.
5. Build channel-specific metadata (`nightly*.yml` vs `latest*.yml`), checksums and all assets referred to by those manifests. Explicitly set electron-builder release/channel options rather than inheriting today's stable `releaseType`. Validate every referenced filename and hash.
6. Stable promotion requires an explicit maintainer release request and accepted evidence for the exact candidate commit. Build the stable version, retain draft assets until verification succeeds, and only then publish as Latest. Do not rename a nightly binary into a stable release: its embedded version differs.
7. Verify public downloads after publication using the **exact tag**, not whichever release happens to be Latest. Retain previous stable assets for recovery. If verification fails, stop further promotion and notify the maintainer; never claim success from the upload job alone.

Publishing jobs need narrow write permissions; PR validation remains read-only apart from existing review annotations. Do not run untrusted PR code in a privileged publishing workflow. Signing remains optional and uses repository secrets only. Do not create fake credentials.

Updating required checks or administrator enforcement is a separate repository-policy change requiring owner authorization. The planned required set includes quality, the platform package/smoke checks and security analysis; verify exact check names before applying it.

## Feature acceptance process

Use [the release-readiness process](release-readiness.md). Before merging a feature, check the behaviour in a preview build rather than only checking that it compiles. Before tagging stable, revalidate the integrated candidate and record the exact SHA, version, CI/artifact evidence, platform checks, independent reviewer, known limitations and recovery procedure.

Clipboard changes specifically require tests of crop/redaction, inclusion/order, failure preservation and the exact target AI app versions. An Electron clipboard test is not evidence that ChatGPT, Claude or Copilot accepted both text and an attachment. Until those tests pass, keep combined copy explicitly experimental with a separate-image fallback.

## Delivery order and acceptance

1. Land the local release-readiness process and tests. No remote policy change.
2. Implement validated channel settings, selector and update-state race handling. Test old settings default to stable, confirmation/cancel, persistence and switching during a check.
3. Implement channel-aware discovery for both native updater and Mac manual downloads. Test stable never selects nightly, nightly never reads a stable alias, absent releases, network failures and no automatic downgrade.
4. Separate release classification, build manifests and publish jobs. Dry-run with synthetic versions and inspect all platform assets. Verify normal PR CI needs no signing secrets.
5. Publish the first nightly only after explicit approval, then test install/update end to end with synthetic workspaces. Verify reopening after a channel change and rejecting unsupported project schemas.
6. Promote stable only after independent acceptance. Schedule nightlies only after the manual path is proven.

No project schema changes are needed for channels. Before any future schema-changing nightly, add backup/migration tests and a clear warning that an older stable app may refuse newer data. Never automatically downgrade project data.

## Reference

The proposal follows [electron-builder release channels](https://www.electron.build/docs/tutorials/release-using-channels/) and [GitHub release controls](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), with updater behaviour checked against the repository's pinned source rather than assumed from newer documentation.
