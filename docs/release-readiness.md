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

macOS builds are currently ad-hoc signed, not Apple-notarised. Record actual Gatekeeper/install results and Intel/Apple Silicon coverage separately. CI now includes packaged Windows portable and extracted Linux AppImage smoke alongside the packaged Mac archive check. These are launch/core-workflow tests, not a substitute for testing NSIS/deb installation, Gatekeeper prompts or real update installation on target machines. Do not mark those manual checks passed solely from a package job.

Test the guard with `node --test scripts/release-readiness.test.mjs` (also included in `pnpm test`). See [nightly build instructions](nightly-builds.md) for channel selection, guarded publishing and remaining rollout validation.
