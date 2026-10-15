# Feature checks before release

This process adds a local, fail-closed guard to `pnpm release`. It does not change GitHub branch protection or the publishing workflow. A maintainer can still bypass the local command by manually creating a tag; remote enforcement is a separate planned change.

## Before merging a feature

1. State what the user should be able to do and what must remain unchanged in the PR.
2. Add a regression test, run format/lint/type/test/build checks and launch a preview build. Record the behaviour observed, not just “tested”.
3. Check changed interactions with synthetic screenshots and an existing project copy. Include persistence, recovery and exports when affected.
4. Have an independent reviewer inspect the code and evidence. Resolve findings before merging. Do not bypass configured GitHub checks.

For clipboard changes, record exact OS and target-app/browser versions and whether text, image or both arrive. Never treat writing Electron clipboard formats as proof that an AI application accepted an attachment. Keep unverified combined-copy compatibility labelled experimental.

## After merge, before a stable tag

The release version and changelog must already be merged. Pull main and collect acceptance evidence for that exact commit. Existing PR evidence can support it only where the tested code is unchanged; re-run integrated checks for the candidate. Do not change source or version files after acceptance.

Save a local JSON record outside the tracked source, for example `.git/release-evidence.json`. This avoids making the evidence's own commit change the candidate SHA. Link to retained CI runs/artifact hashes and manual results in each evidence string. Do not include screenshots, secrets or personal workspace paths. Preserve a redacted copy with the release's acceptance records after review.

```bash
# Replace 0.3.0 with the version already merged into package.json.
corepack pnpm release 0.3.0 --evidence .git/release-evidence.json --dry-run
# Run only when explicitly asked to publish that accepted version:
corepack pnpm release 0.3.0 --evidence .git/release-evidence.json
```

Both commands require complete evidence, a clean main branch and the exact `origin/main` commit. The dry-run fetches and validates but does not create a tag or publish. The real command runs quality checks before tagging. `patch`, `minor` and `major` only identify a version to prepare; they do not bypass the version PR.

## Evidence record

Copy this intentionally incomplete template and replace every unverified value with observed results. It is **not** a passing acceptance record. All three platforms require package and installed-artifact smoke evidence. If a platform cannot be checked, keep the release blocked rather than claiming success.

```json
{
  "schemaVersion": 1,
  "candidate": { "sha": "EXACT_MAIN_COMMIT_SHA", "version": "0.3.0" },
  "featureChecks": [{ "name": "Describe the changed behaviour", "status": "not-run", "evidence": "" }],
  "platformChecks": {
    "windows": {
      "package": { "status": "not-run", "evidence": "" },
      "installSmoke": { "status": "not-run", "evidence": "" }
    },
    "macos": {
      "package": { "status": "not-run", "evidence": "" },
      "installSmoke": { "status": "not-run", "evidence": "" }
    },
    "linux": {
      "package": { "status": "not-run", "evidence": "" },
      "installSmoke": { "status": "not-run", "evidence": "" }
    }
  },
  "acceptance": {
    "status": "pending",
    "author": "",
    "reviewer": "",
    "rollbackAcknowledged": false,
    "knownLimitationsAcknowledged": false
  },
  "rollback": { "plan": "" },
  "knownLimitations": []
}
```

Passing checks use `status: "passed"` with nonempty evidence. Acceptance uses `status: "accepted"`, different author/reviewer names and both acknowledgements set to true. Record reviewer/date, CI run URL, tested artifact/version/hash and platform/architecture in evidence. Empty limitations means no known limitations, not “not checked”.

The validator checks completeness and candidate identity. It cannot authenticate the reviewer, verify that an evidence URL is truthful or substitute for actual feature testing. Review the referenced results before accepting the record.

## Recovery and known limits

Keep the prior stable installer available. If a release fails, stop promotion and tell users which tested version to reinstall. Back up workspaces before testing schema changes; older versions may reject newer project data. Do not silently downgrade project files or delete backups.

macOS app rollback copies now last only until installation commits: the quick installer checks the installed executable and signature, and both paths require installed signature verification and observation of the same running replacement process from the installed bundle on successive polls within 30 seconds. Both request a graceful quit first and refuse replacement if the app or quit request exceeds one 60-second deadline. Rollback first requests quit of the verified replacement and waits, then uses TERM only for PIDs still verified inside the replacement bundle, within a 10-second shutdown deadline. An unconfirmed stop preserves the failed replacement at a reported recovery path while restoring the previous app; quit that remaining process before reopening the restored app. Missing or exited replacements trigger restoration even when `open` accepts the request. Both then retire recognized old Imnota app backups after checking the bundle identifier, including managed rollback bundles. Project backups are separate. Verify repeated successful installs leave no app rollback bundles, failure restores the previous app (or reports its preserved path if the restore itself fails), and unrelated look-alikes survive; record native macOS evidence and independent review before shipping. Use the [storage audit and walkthrough](development.md#installer-and-updater-storage-audit) for Windows/Linux cache expectations and interrupted-transaction recovery. Reinstall the prior tested release for a downgrade after success; do not depend on a retained local app rollback copy.

Recovery paths are relative to the verified physical installation folder. The
quick installer keeps the previous app at `.imnota-install.*/previous-Imnota.app`;
the Terminal updater keeps it at `.imnota-backups.noindex/.rollback-<pid>.app`,
with separate `.imnota-update.*` staging. An unconfirmed replacement shutdown
preserves the failed app at `.imnota-install.*/failed-Imnota.app` or
`.imnota-update.*/failed-Imnota.app`, respectively. If moving it aside fails, it
remains at `Imnota.app` and the previous app stays at its reported rollback path.
Preserve these recovery files after interruption; restore the previous app before
removing a stale `.imnota-update.lock`, after confirming no installer is running.

macOS builds are currently ad-hoc signed, not Apple-notarised. Record actual Gatekeeper/install results and Intel/Apple Silicon coverage separately. CI now includes packaged Windows portable and extracted Linux AppImage smoke alongside the packaged Mac archive check. These are launch/core-workflow tests, not a substitute for testing NSIS/deb installation, Gatekeeper prompts or real update installation on target machines. Do not mark those manual checks passed solely from a package job.

Nightly and stable macOS package jobs also gate publication on **Verify native Mac installer transactions** against the exact built universal ZIP. The archive path is checked before the suite runs; nightly supplies the candidate's embedded version rather than the source package version. The stable-only quick installer uses a stable-shaped fixture URL for the same candidate ZIP; updater fixtures use the actual nightly identity. Confirm the native suite executes its transaction cases without skipping in the first real nightly and stable runs. It exercises native filesystem/signature/process boundaries with simulated GUI startup and does not replace the packaged walkthrough or public install gate.

Packaged-smoke failure artifacts are retained for 7 days in Actions as `smoke-failure-evidence-ci-<os>`, `smoke-failure-evidence-nightly-<platform>` and `smoke-failure-evidence-release-<platform>`; the stable public Mac check uses `smoke-failure-evidence-public-mac-release`. They contain any captures/progress plus `failure.png` and `verification-failure.json` when the application can produce them. The JSON retains renderer state and a timestamped, bounded post-failure responsiveness/event-loop sample, including the failed locator's computed visibility and bounds when available. An unavailable renderer is explicit; pre-launch failures can have no application evidence. On the first real failed walkthrough, confirm the upload runs despite failure, inspect these files (especially a missing/hidden `.library` target), and confirm evidence is absent from published release assets. A successful run alone does not prove the failure upload path. No timeout extension or readiness retry is added.

Test the guard with `node --test scripts/release-readiness.test.mjs` (also included in `pnpm test`). See [nightly build instructions](nightly-builds.md) for channel selection, guarded publishing and remaining rollout validation.
