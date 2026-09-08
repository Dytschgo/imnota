# Documentation-only PR validation

Validate runs full application and platform checks for main-branch pushes and for every PR except a conservatively classified prose-only change. Nightly and stable workflows are unchanged.

The classifier accepts only ordinary non-executable files at `README.md`, `AGENTS.md`, or under `docs/` with a lowercase `.md` extension. Nested directory and file names allow letters, digits, underscores, and hyphens. Spaces, unusual paths, other document locations, workflow/configuration changes, symlinks, executable-bit changes, mixed changes, or uncertain classification retain full checks. These paths are not TypeScript/Vite inputs or electron-builder package inputs, and no repository build/runtime script reads them. Revisit this policy if that changes.

The classifier compares the exact PR base and head commits using NUL-delimited raw Git output, with rename detection disabled. Moving source into a document therefore still exposes the source deletion. A base branch that has advanced can cause extra full validation; the classifier deliberately tolerates this conservative result. Empty diffs, invalid hashes, absent history, Git errors, unexpected modes/statuses, and excessive diff output all select full validation.

Every existing quality, platform-package, and share-service matrix job still reports its original check name. For prose-only PRs, package/service jobs report an explicit documentation-only step. Quality installs the pinned dependencies and runs the existing complete formatting check. CodeQL and dependency review continue unchanged. Application/native steps run when the classifier reports anything except successful `docs_only=true`, including a failed classifier job. Cancellation still cancels dependent work.

Formatting cannot establish whether prose, links, commands, or agent instructions are correct. Review those under [AGENTS.md](../AGENTS.md); the shortcut changes application CI work, not documentation review responsibilities.

`scripts/ci-changes.test.mjs` runs through the shared script-test command in full quality, every platform package test run, and release suites. Its real Git fixture exercises CLI output and source-to-document renames; focused cases cover malformed, mixed, missing, and non-regular input. A configuration PR must pass full hosted checks. Verify a subsequent useful prose-only PR before claiming hosted routing savings, including the original required `quality` context and every matrix check result.

To restore full PR validation, remove the classifier conditions from Validate. No branch protection or release setting needs to change.

## Hosted verification

The first results revision in [PR #39](https://github.com/Dytschgo/imnota/pull/39), `0ec531c463615a93017daed9ee96c31218635da0`, passed [Validate 34280717233](https://github.com/Dytschgo/imnota/actions/runs/34280717233) and [CodeQL 34280717328](https://github.com/Dytschgo/imnota/actions/runs/34280717328) on attempt 1. All six original platform/service matrix jobs reported success through their documentation step; application steps were explicitly skipped. Quality installed dependencies and passed formatting, while CodeQL and dependency review executed normally. Every original check context reported success.

Validate's first job started at 21:27:38 UTC and its last finished at 21:28:18 on 8 September 2026: 40s. CodeQL completed at 21:28:39, making the combined job span 61s. Quality took 31s; matrix success markers took 4 to 7 seconds. Workflow-level queue delay was zero at API resolution, with first jobs starting 3s after creation. Dependent jobs started 3 to 12 seconds after classification finished. This single prose-only comparison replaces the roughly 8m 56s Validate job span of [documentation PR #35](https://github.com/Dytschgo/imnota/actions/runs/34276483712); it is not an application-build speed claim or a guaranteed latency.

PR #38's configuration revision separately passed full validation in [run 34279834586](https://github.com/Dytschgo/imnota/actions/runs/34279834586). An earlier superseded revision's run was cancelled after a regression-fixture correction; no failing current-head check was bypassed.
