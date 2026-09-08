# Documentation-only PR validation

Validate runs full application and platform checks for main-branch pushes and for every PR except a conservatively classified prose-only change. Nightly and stable workflows are unchanged.

The classifier accepts only ordinary non-executable files at `README.md`, `AGENTS.md`, or under `docs/` with a lowercase `.md` extension. Nested directory and file names allow letters, digits, underscores, and hyphens. Spaces, unusual paths, other document locations, workflow/configuration changes, symlinks, executable-bit changes, mixed changes, or uncertain classification retain full checks. These paths are not TypeScript/Vite inputs or electron-builder package inputs, and no repository build/runtime script reads them. Revisit this policy if that changes.

The classifier compares the exact PR base and head commits using NUL-delimited raw Git output, with rename detection disabled. Moving source into a document therefore still exposes the source deletion. A base branch that has advanced can cause extra full validation; the classifier deliberately tolerates this conservative result. Empty diffs, invalid hashes, absent history, Git errors, unexpected modes/statuses, and excessive diff output all select full validation.

Every existing quality, platform-package, and share-service matrix job still reports its original check name. For prose-only PRs, package/service jobs report an explicit documentation-only step. Quality installs the pinned dependencies and runs the existing complete formatting check. CodeQL and dependency review continue unchanged. Application/native steps run when the classifier reports anything except successful `docs_only=true`, including a failed classifier job. Cancellation still cancels dependent work.

Formatting cannot establish whether prose, links, commands, or agent instructions are correct. Review those under [AGENTS.md](../AGENTS.md); the shortcut changes application CI work, not documentation review responsibilities.

`scripts/ci-changes.test.mjs` runs through the shared script-test command in full quality, every platform package test run, and release suites. Its real Git fixture exercises CLI output and source-to-document renames; focused cases cover malformed, mixed, missing, and non-regular input. A configuration PR must pass full hosted checks. Verify a subsequent useful prose-only PR before claiming hosted routing savings, including the original required `quality` context and every matrix check result.

To restore full PR validation, remove the classifier conditions from Validate. No branch protection or release setting needs to change.
