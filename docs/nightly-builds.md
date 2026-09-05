# Stable and nightly builds

Imnota has two update channels in the same public GitHub repository. Stable is the default. Nightly is an opt-in preview. Both use the same application and workspace format; switching channels does not move or migrate your project files.

## Choose a channel

Open **Settings → App updates → Update channel**. Selecting **Nightly (preview)** asks you to confirm and back up your workspace. **Keep Stable** cancels without changing preferences. The selected channel is saved locally and used by both Settings and the sidebar refresh button.

Checks do not automatically download or install anything. Use **Download update**, then **Restart to install** on supported native-updating builds. macOS uses **Open release download** because the current app is ad-hoc signed, not Apple-notarised. It opens the exact release page selected for that channel; replace the application and retain your workspace.

Channel switching is disabled while checking, downloading or awaiting installation. This avoids mixing a checked installer from one channel with another channel's UI. Failed checks/downloads allow retry. No available nightly is reported honestly rather than falling back to stable.

Switching back to Stable never automatically downgrades. If the installed nightly is newer, Imnota explains that and offers the selected stable release page. Back up before manually replacing a newer app; an older version may not understand a future project's schema.

## Build a nightly after merge

The **Build nightly prerelease** workflow is manual only. There is no nightly schedule yet, and a normal main push does not publish a release.

After this implementation is merged into main, an authorised maintainer can dispatch a build for an exact reviewed main commit:

```bash
git fetch origin main
gh workflow run nightly.yml --repo Dytschgo/imnota --ref main -f sha="$(git rev-parse origin/main)"
```

That command **publishes a prerelease after validation succeeds**. Run it only when a nightly publication is intended, not merely to check the workflow. GitHub's Actions UI also accepts the exact SHA. The guard rejects non-main workflow refs and commits outside main history.

Versions use the next patch of the candidate's stable package version: for example, `0.2.0` produces `0.2.1-nightly.20260905.1234`. A retried run adds a numeric attempt, such as `.2`. These are examples, not available downloads. The package's embedded version is overridden for that build without committing a version bump to main.

The workflow runs quality tests and builds Windows, macOS and Linux artifacts. Packaged smoke tests must confirm success from inside the application, including its expected nightly version. The collected `nightly.yml`, `nightly-linux.yml` and `nightly-mac.yml` manifests must match the version, filenames and SHA-512 hashes of staged assets. SHA-256 checksums are also generated.

Publication first stages a draft, then publishes a GitHub prerelease with `make_latest: false`. Stable update metadata and the stable installer's Latest alias are untouched. Download a nightly through the app's selected-channel link or the repository's prereleases, not the stable one-command installer.

## Stable releases

Stable tags must exactly match `vMAJOR.MINOR.PATCH`. Nightly tags are rejected by the stable release workflow before packaging/publication. Stable publication remains explicit and uses the [release-readiness process](release-readiness.md), including independent feature acceptance.

Stable tags must point to a commit in main's history. Assets are validated before publication. The release is initially published without becoming Latest; the public Mac installer test downloads the exact tag and verifies the running application version. Only a successful test permits a separate job to promote that release to Latest. Keep prior stable installers for recovery. Do not remove checks to force a release through.

## Update implementation

- Shared IPC accepts only `stable` or `nightly`; older/missing channel preferences default to Stable.
- Stable discovery reads GitHub's latest stable release; nightly discovery uses bounded pagination of public releases, excluding drafts and other prerelease formats. Network responses are time- and size-bounded.
- Windows/Linux native checks use a generic feed pinned to the exact selected GitHub release directory, not an unqualified channel feed. A missing nightly manifest cannot fall back to stable.
- Native checks must report that the exact version is available. Every installer URL must match an API-listed platform asset under that release. Automatic download, install-on-quit and downgrade are disabled.
- Update actions run outside the filesystem IPC queue, keeping workspace actions responsive during network checks. In-flight operations lock channel changes, and late native progress cannot replace a completed result.
- No account, token, telemetry or project upload is required. Update discovery contacts GitHub only for release information.

## Verification and remaining rollout steps

Local tests cover channel validation, version comparison, missing/invalid releases, pagination, network failure, confirmation/cancellation, settings persistence, download-state locking, exact asset URLs, native rejection and no automatic downgrade. The real Electron smoke includes Settings interaction and a persisted channel readback. Windows nightly packaging and packaged-app smoke can be run locally; Mac/Linux runners still need their first real workflow run after merge.

This implementation does not itself publish the first nightly, change branch protection, enable a schedule, or configure signing. Before broader rollout, run the workflow on an accepted main SHA and verify public downloads and update installation on the supported platforms. The former [channel plan](stable-nightly-release-plan.md) records the original decisions.
