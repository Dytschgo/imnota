## Summary

## What changed

## Testing

- [ ] `corepack pnpm format:check`
- [ ] `corepack pnpm lint`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`

## Notes for reviewers

## Feature acceptance

- Expected user behaviour and unchanged behaviour:
- Preview build / commit tested:
- Observed result and regression test:
- Persistence, export and recovery checks (if affected):
- Known limitations and recovery approach:

## Release readiness (when this PR prepares a stable release)

- [ ] Local evidence JSON records changed-behaviour checks and Windows/macOS/Linux package/install-smoke results.
- [ ] A reviewer distinct from the release author accepted the evidence and acknowledged rollback and known limitations.
- [ ] After merge, collect evidence for the exact main commit and run `corepack pnpm release <version> --evidence <local-json-path> --dry-run` before tagging.

This local command is an additional release guard, not remote branch protection; it cannot prevent manual tag creation.

See [release-readiness instructions](../docs/release-readiness.md).
