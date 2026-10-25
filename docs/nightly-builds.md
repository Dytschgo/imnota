# Stable and nightly builds

Imnota has two update channels in the same public GitHub repository. Stable is the default. Nightly is an opt-in preview. Both use the same application identity; changing the channel preference alone does not move or migrate project files. Opening a project with a newer installed version can migrate its data format.

## Choose a channel

Open **Settings → App updates → Update channel**. Selecting **Nightly (preview)** asks you to confirm and back up your workspace. **Keep Stable** cancels without changing preferences. The selected channel is saved locally and used by both Settings and the sidebar refresh button.

Checks do not automatically download or install anything. Use **Download update**, then **Restart to install** on supported native-updating builds. macOS offers **Run update in Terminal** and a copyable command. The bundled helper downloads the exact selected release, verifies it, requests a graceful quit within one 60-second bound (including the quit request), replaces the app and reopens it. The previous app remains available for automatic rollback until final signature verification succeeds and the same replacement process is observed running from the installed bundle on successive polls within 30 seconds. An accepted open request alone does not commit the update; missing or exited replacement processes trigger rollback. Before restoring, it requests quit of the verified replacement, waits, then sends TERM only to PIDs still verified inside its physical bundle. If that 10-second shutdown cannot be confirmed, it preserves the failed replacement at a reported path while restoring the previous app; quit that remaining process before reopening the restored app. After success it removes the rollback copy and recognized older Imnota app backups in that installation folder. If automatic restoration fails, the helper reports the preserved old app path for manual recovery. It does not require Developer ID signing, administrator privileges or removal of quarantine.

Recovery paths are relative to the verified physical installation folder. The
quick installer keeps the previous app at `.imnota-install.*/previous-Imnota.app`;
the Terminal updater keeps it at `.imnota-backups.noindex/.rollback-<pid>.app`,
with separate `.imnota-update.*` staging. An unconfirmed replacement shutdown
preserves the failed app at `.imnota-install.*/failed-Imnota.app` or
`.imnota-update.*/failed-Imnota.app`, respectively. If moving it aside fails, it
remains at `Imnota.app` and the previous app stays at its reported rollback path.
Preserve these recovery files after interruption; restore the previous app before
removing a stale `.imnota-update.lock`, after confirming no installer is running.

Channel switching is disabled while checking, downloading or awaiting native installation. Failed checks/downloads allow retry. Nightly checks compare the latest nightly with the latest stable release and offer the newer version. For example, stable `0.2.2` supersedes `0.2.2-nightly.20260905.1234`; a later `0.2.3-nightly` becomes eligible again. The preference remains Nightly throughout, and an already newer installed version is never downgraded.

Switching back to Stable never automatically downgrades. If the installed nightly is newer, Imnota explains that and offers the selected stable release page. Back up before manually replacing a newer app; an older version may not understand a future project's schema.

Current builds migrate schema 1/2 projects to schema 3 when opened. Adding a drawing or text block upgrades schema 3 to schema 4 while retaining a versioned metadata backup. Back up the whole workspace folder before trying a newer build. Reinstalling an older app does not reverse migration; see the [migration and rollback procedure](data-format.md) before returning to an older version.

## Build a nightly after merge

The **Build nightly prerelease** workflow runs daily at 02:17 UTC (04:17 in Zurich during summer time, 03:17 during winter time) and accepts manual dispatches. Scheduled runs skip publication when the latest published nightly already contains the current `main` commit. A normal main push does not publish a release.

After each scheduled or manual attempt, the workflow checks for staleness. If `main` differs from the latest published nightly and that nightly is more than 48 hours old, it opens or comments on the **Nightly is stale** issue. This check depends on the workflow running; it cannot detect GitHub disabling a schedule after prolonged repository inactivity.

Current branch protection enforces an up-to-date `quality` check. Validate's aggregate now requires every applicable job in that workflow, including all platform package and service/security jobs, under the [explicit docs-only and event skip policy](ci-routing.md). Branch protection does not enforce approving reviews. For this release process, the release owner must also obtain an independent review and verify all PR platform package and security checks for the exact head before merging. Do not use an administrator bypass. The nightly workflow separately gates publication on quality and all three platform builds. Stronger remote review enforcement is a separate repository-policy change, not part of publishing a nightly.

An authorised maintainer can dispatch a build for an exact reviewed main commit:

```bash
git fetch origin main
gh workflow run nightly.yml --repo Dytschgo/imnota --ref main -f sha="$(git rev-parse origin/main)"
```

That command **publishes a prerelease after validation succeeds**. Run it only when a nightly publication is intended, not merely to check the workflow. GitHub's Actions UI also accepts the exact SHA. The guard rejects non-main workflow refs and commits outside main history.

Versions use the next patch of the candidate's stable package version: for example, `0.2.0` produces `0.2.1-nightly.20260905.1234`. A retried run adds a numeric attempt, such as `.2`. These are examples, not available downloads. The package's embedded version is overridden for that build without committing a version bump to main.

The workflow runs quality tests, including the tracked-file secret scan, and builds Windows, macOS and Linux artifacts. Every job has a time limit, recorded with the [pinned-action policy](ci-routing.md#pinned-actions-time-limits-and-least-privilege). Packaged smoke tests must confirm success from inside the application, including its expected nightly version. The collected `nightly.yml`, `nightly-linux.yml` and `nightly-mac.yml` manifests must match the version, filenames and SHA-512 hashes of staged assets. SHA-256 checksums are also generated.

Nightly and stable macOS package jobs run **Verify native Mac installer transactions** against that candidate's exact universal ZIP; nightly uses the overridden nightly version for the fixture's release metadata and version assertions (the stable-only quick installer uses a stable-shaped fixture URL redirected to the same ZIP). The archive must exist and the native transactions must pass before publication. These native filesystem/signature/process tests simulate GUI startup; the packaged walkthrough and public-download checks remain separate gates.

Failed packaged walkthroughs on all three platforms retain screenshots, `verification-failure.json` (including renderer diagnostics when available), and progress/capture files in Actions artifacts for 7 days: `smoke-failure-evidence-nightly-<platform>` or `smoke-failure-evidence-release-<platform>`. The stable public Mac check uses `smoke-failure-evidence-public-mac-release` with the same retention. These names stay outside the `nightly-*` / `release-*` distributable download patterns. See [development](development.md) for evidence limits and [release readiness](release-readiness.md) for the first-run checks.

Publication first stages a draft, then publishes a GitHub prerelease with `make_latest: false`. Stable update metadata and the stable installer's Latest alias are untouched. Download a nightly through the app's selected-channel link or the repository's prereleases, not the stable one-command installer.

## Stable releases

Stable tags must exactly match `vMAJOR.MINOR.PATCH`. Nightly tags are rejected by the stable release workflow before packaging/publication. Stable publication remains explicit and uses the [release-readiness process](release-readiness.md), including independent feature acceptance.

Stable tags must point to a commit in main's history. Assets are validated before publication. The release is initially published without becoming Latest; the public Mac installer test downloads the exact tag and verifies the running application version. Only a successful test permits a separate job to promote that release to Latest. Keep prior stable installers for recovery. Do not remove checks to force a release through.

## Update implementation

- Shared IPC accepts only `stable` or `nightly`; older/missing channel preferences default to Stable.
- Stable discovery reads GitHub's latest stable release; Nightly also compares it with the latest eligible nightly found through bounded pagination. Drafts and other prerelease formats are excluded. Network responses are time- and size-bounded.
- Windows/Linux native checks use the chosen release's own channel manifest and exact GitHub release directory. Selecting a newer stable candidate uses its stable manifest; an invalid manifest is never replaced with an unrelated feed.
- Native checks must report that the exact version is available. Every installer URL must match an API-listed platform asset under that release. Automatic download, install-on-quit and downgrade are disabled.
- Update actions run outside the filesystem IPC queue, keeping workspace actions responsive during network checks. In-flight operations lock channel changes, and late native progress cannot replace a completed result.
- No account, token, telemetry or project upload is required. Update discovery contacts GitHub only for release information.

## Verification and remaining rollout steps

Local tests cover channel validation, version comparison, missing/invalid releases, pagination, network failure, confirmation/cancellation, settings persistence, download-state locking, exact asset URLs, native rejection and no automatic downgrade. The real Electron smoke includes Settings interaction and a persisted channel readback. The [September 21 nightly run](https://github.com/Dytschgo/imnota/actions/runs/35645731983) published `v0.2.9-nightly.20260921.35645731983` for `bf8d24e664778a4d643a295350af6e5561a09ace` after its Windows/macOS/Linux package checks. Its manifests, assets, and installed application version matched that candidate; stable v0.2.8 remained Latest.

A normal merge does not immediately publish a nightly, change branch protection or configure signing. The next scheduled run selects current `main`; manual dispatches select an exact accepted SHA. Each publication needs a fresh workflow run and public-download verification. Broader clean-machine update/install and receiving-editor checks remain separate from CI. The former [channel plan](history/stable-nightly-release-plan.md) records the original decisions.
