# Documentation-only PR validation

Validate runs full application and platform checks for main-branch pushes and for every PR except a conservatively classified prose-only change. Nightly and stable workflows are unchanged.

The classifier accepts only ordinary non-executable files at `README.md`, `AGENTS.md`, or under `docs/` with a lowercase `.md` extension. Nested directory and file names allow letters, digits, underscores, and hyphens. Spaces, unusual paths, other document locations, workflow/configuration changes, symlinks, executable-bit changes, mixed changes, or uncertain classification retain full checks. These paths are not TypeScript/Vite inputs or electron-builder package inputs, and no repository build/runtime script reads them. Revisit this policy if that changes.

The classifier compares the exact PR base and head commits using NUL-delimited raw Git output, with rename detection disabled. Moving source into a document therefore still exposes the source deletion. A base branch that has advanced can cause extra full validation; the classifier deliberately tolerates this conservative result. Empty diffs, invalid hashes, absent history, Git errors, unexpected modes/statuses, and excessive diff output all select full validation.

Every existing quality, platform-package, and share-service matrix job still reports its original check name. For prose-only PRs, package/service jobs report an explicit documentation-only step. Quality installs the pinned dependencies and runs the existing complete formatting check. CodeQL and dependency review continue unchanged. Application/native steps run when the classifier reports anything except successful `docs_only=true`, including a failed classifier job. Cancellation still cancels dependent work.

Formatting cannot establish whether prose, links, commands, or agent instructions are correct. Review those under [AGENTS.md](../AGENTS.md); the shortcut changes application CI work, not documentation review responsibilities.

`scripts/ci-changes.test.mjs` runs through the shared script-test command in full quality, every platform package test run, and release suites. Its real Git fixture exercises CLI output and source-to-document renames; focused cases cover malformed, mixed, missing, and non-regular input. A configuration PR must pass full hosted checks. Verify a subsequent useful prose-only PR before claiming hosted routing savings, including the original required `quality` context and every matrix check result.

To restore full PR validation, remove the classifier conditions from Validate. No branch protection or release setting needs to change.

## Superseded runs and workflow linting

Validate and CodeQL use a concurrency group keyed by the pull request number, so a newer push to the same PR cancels the validation still running for the superseded revision instead of competing with it for runners. Main-branch pushes are keyed by commit and never cancel each other, so every merged revision is still validated in full. Before this change, one branch produced four complete eight-minute Validate runs within 25 minutes while its earlier revisions were already obsolete.

Quality also lints the workflow files with a pinned `actionlint` container before the application checks, so a workflow expression, unknown input, or shell mistake fails the PR instead of the first run that happens to reach it. The container's bundled shellcheck runs at warning severity: style hints stay advisory rather than blocking a release workflow nobody is editing.

## Pinned actions, time limits, and least privilege

Every action in the four workflows is pinned to a full commit SHA with its release version in a trailing comment, and the `actionlint` container is pinned by image digest as well as tag. A moved or compromised tag therefore cannot change what a release workflow executes. Dependabot's `github-actions` updater rewrites both the SHA and the version comment; it does not update the container reference inside the `run` step, so bump that tag and digest together by hand. Validate, CodeQL, nightly, and stable use the same version of each action. Nightly and stable previously ran older `pnpm/action-setup` and `actions/setup-node` majors than the PR checks that validated the same commands, and paired `actions/upload-artifact` v7 with `actions/download-artifact` v4.

Every job has a `timeout-minutes` limit so a hung step fails within minutes instead of holding a runner for the six-hour default. Recent main runs measured package jobs at 5 to 10 minutes, quality at about 2.5 minutes, each share-service job under a minute, and CodeQL at 1 to 2 minutes. The limits are 45 minutes for package jobs (two packaged walkthroughs, each with its own [six-minute launcher deadline](verification-timing.md#september-26-packaged-smoke-budget)), 30 for CodeQL, 20 for quality, 15 for share-service jobs, 10 for dependency review, and 5 for classification. Nightly uses the same package and quality limits, with 30 minutes for publication and 10 for its guard; [stable limits](stable-release-ci.md#parity-with-nightly-gates) are recorded with that workflow. A classifier that times out does not report success, so the dependent jobs run full validation.

Quality runs `scripts/secret-scan.mjs` on every PR, including documentation-only ones, because prose can carry a pasted credential. Dependency review keeps only `contents: read`; it posts no PR comment, so `pull-requests: write` was unnecessary. Dependabot now also opens version updates for `share-service/`, whose separate lockfile previously received only security updates.

Some repeated work is deliberate and stays. Each package job installs the share service and runs `test:share-contract` so the hosted contract is exercised on every OS, and quality repeats it because `quality` is the check branch protection requires. The Mac verifier and the Windows and Linux packaged verifiers run twice per job in different modes: the full walkthrough, then bundle copy and paste. Merging those launches would need script changes and a new coverage review, not a workflow edit.

## Hosted verification

The first results revision in [PR #39](https://github.com/Dytschgo/imnota/pull/39), `0ec531c463615a93017daed9ee96c31218635da0`, passed [Validate 34280717233](https://github.com/Dytschgo/imnota/actions/runs/34280717233) and [CodeQL 34280717328](https://github.com/Dytschgo/imnota/actions/runs/34280717328) on attempt 1. All six original platform/service matrix jobs reported success through their documentation step; application steps were explicitly skipped. Quality installed dependencies and passed formatting, while CodeQL and dependency review executed normally. Every original check context reported success.

Validate's first job started at 21:27:38 UTC and its last finished at 21:28:18 on 8 September 2026: 40s. CodeQL completed at 21:28:39, making the combined job span 61s. Quality took 31s; matrix success markers took 4 to 7 seconds. Workflow-level queue delay was zero at API resolution, with first jobs starting 3s after creation. Dependent jobs started 3 to 12 seconds after classification finished. This single prose-only comparison replaces the roughly 8m 56s Validate job span of [documentation PR #35](https://github.com/Dytschgo/imnota/actions/runs/34276483712); it is not an application-build speed claim or a guaranteed latency.

PR #38's configuration revision separately passed full validation in [run 34279834586](https://github.com/Dytschgo/imnota/actions/runs/34279834586). An earlier superseded revision's run was cancelled after a regression-fixture correction; no failing current-head check was bypassed.
