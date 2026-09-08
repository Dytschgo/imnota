# Working in Imnota

Keep changes easy to review, verify, release, and recover. This file describes the working agreement; [the improvement plan](docs/improvement-plan.md) tracks proposed engineering work. A backlog item is not authorization to execute it.

## Scope and safety

- Follow the user's requested scope and existing authorization. Continue through an approved plan without asking again at every slice; pause for material scope changes, missing critical decisions, or actions outside that authorization.
- Keep Imnota local-first. Preserve existing optional sharing through explicit user action. New accounts, cloud sync, hosted AI calls, telemetry, or major product expansion need a documented product decision in [the roadmap](docs/product-roadmap.md).
- Preserve user files and unrelated working-tree changes. Use an isolated worktree when needed. Do not rewrite published history, discard another person's work, change branch protections, or bypass failed checks.
- Treat persistence, recovery, migrations, permissions, and release publication as consequential changes. Define failure behavior and recovery, and obtain independent review before shipping changes to these paths.
- Never commit credentials, signing keys, personal workspace contents, recovery data, or generated installers/build directories. Synthetic test fixtures, approved visual baselines, and bundled product artwork are allowed; review their provenance and size. Prefer release attachments for distributable binaries.

## Small, complete changes

- Branch from current `main` with a descriptive name such as `fix/export-ready-state`, `feat/project-icons`, or `docs/release-process`. Do not rename existing branches just to match this convention.
- Aim for one independently reviewable outcome per PR. Its schema, IPC, UI, tests, and documentation may belong together. Split unrelated changes and genuinely separable outcomes.
- More than 500 inserted lines or 15 changed files is a review warning, not an automatic failure. Exclude generated content and lockfiles from the line budget. Propose a split or explain why a cohesive change, fixture set, or mechanical move is safer together. Size alone does not require user approval.
- Keep required dependency and lockfile updates with the change that needs them; explain the dependency. Separate unrelated upgrades and incidental lockfile churn.
- Prefer focused fixes. Extract from large modules when it improves a clear boundary or testability; do not require a refactor before every small fix or use line-count targets as acceptance criteria.
- Keep mechanical moves distinguishable from behavior changes. Reuse canonical shared types and schemas. Avoid new `any` where a concrete type or `unknown` with narrowing works.
- Use concise Conventional Commit titles, for example `fix(export): wait for the current plan`. Squash or rebase according to the repository's allowed merge methods; the resulting commits must be coherent and revertible. Do not rewrite shared history to tidy commit messages.

## Verification by impact

Choose verification from the behavior and execution paths affected, not just a filename. Start with targeted checks and broaden when changes, failures, or uncertain boundaries justify it.

These tiers guide local verification and future CI routing. They do not change existing workflow requirements: required CI checks must still pass, even when the current workflow runs more than a tier needs. Change routing only in a separately reviewed CI change.

| Change                                                  | Evidence needed                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation only                                      | Format touched documents; check links, commands, factual claims, and conflicting instructions. No application build or native smoke solely for prose edits.                                                                                                      |
| Application behavior                                    | Lint and type checks; regression tests for changed behavior and failure boundaries; affected UI verification. Run the full application suite before merging behavior changes until reviewed CI routing provides equivalent coverage.                             |
| Filesystem, persistence, updates, or native integration | Relevant tests on each affected supported OS, including path aliases, locking, failure/recovery, or native input as applicable. Use packaged verification when packaging or host behavior matters. Linux checks do not substitute for macOS or Windows evidence. |
| Build, dependencies, or CI configuration                | Validate configuration and the job graph; build affected targets; verify packaged behavior where relevant. Ensure classification cannot silently omit a required check.                                                                                          |
| Nightly or stable release                               | Verify the exact candidate, actual supported distributables, native walkthroughs, applicable visuals, manifests, complete assets and checksums. Preserve the channel-specific gates and verify the published result.                                             |

Use existing commands rather than inventing duplicate check runners:

- Format touched files: `corepack pnpm exec prettier --check <files>`; use `--write` on those files when fixing formatting. `corepack pnpm format` formats the entire repository.
- Static checks: `corepack pnpm lint` and `corepack pnpm typecheck`.
- Tests: `corepack pnpm exec vitest run <test-files>` for targeted application tests, `node --test <script-tests>` for script tests, and `corepack pnpm test` for the full application/script suite.
- Build and walkthrough: `corepack pnpm build`, then `corepack pnpm smoke`; use the existing platform verification scripts for packaged applications.
- Sharing changes: run the relevant service tests and `corepack pnpm test:share-contract` with the service dependencies installed.

Keep regression tests with the code they protect. Prefer observable outcomes and failure boundaries over assertions that mirror implementation. Native verification should wait for the intended state, content, revision, or save completion; arbitrary delays and automatic retries must not hide failures. Preserve real filesystem/native coverage when replacing timing logic with deterministic tests.

## Delivery loop

1. State the intended outcome, affected areas, verification tier, and any useful PR boundaries. Resolve routine details within the approved scope.
2. Implement the smallest complete change. Keep fixes for review findings in the same PR; record unrelated findings without silently expanding scope.
3. Inspect the final diff and run relevant checks. Review UI changes visually and record evidence. Obtain independent review for consequential changes and when practical for substantial behavior changes.
4. Describe the user problem, resulting behavior, tests actually run and their platform, and material risks or deferred work. Update living documentation when behavior changes. Distinguish pending checks from passed checks.
5. When merging or publishing is authorized, finish it after verifying the current reviewed revision and required gates, then verify the result. Remove only the task's merged branch after checking its identity; preserve local work. Otherwise leave a reviewable PR and state what remains.

See [development](docs/development.md), [release readiness](docs/release-readiness.md), and [nightly verification audit](docs/nightly-verification-audit.md) for supporting details. Workflow files and branch protections determine the checks currently enforced.
