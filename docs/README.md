# Documentation map

Start here when you need to understand the repository. `AGENTS.md` is the binding working agreement; this page routes agents to the document that answers a specific question. A proposal or historical record does not authorize implementation.

## Current guidance

- [Implementation status](implementation-plan.md) — shipped behaviour, release baseline and open acceptance or operating work.
- [Development](development.md) — local setup, quality commands and isolated native verification.
- [Architecture](architecture.md) — runtime boundaries, persistence, export and sharing responsibilities.
- [Data format](data-format.md) and [mixed-content model](mixed-content-model.md) — schemas, migrations and item contracts.
- [User guide](user-guide.md) and [troubleshooting](troubleshooting.md) — current user-visible behaviour and known limits.
- [Product roadmap](product-roadmap.md) — future product proposals and explicit boundaries.
- [Release readiness](release-readiness.md), [nightly builds](nightly-builds.md) and [stable release CI](stable-release-ci.md) — release and publication gates.
- [Nightly verification audit](nightly-verification-audit.md), [visual regression](visual-regression.md) and [verification timing](verification-timing.md) — evidence, visuals and test-loop history.
- [Clipboard receiver matrix](clipboard-receiver-matrix.md) and [clipboard compatibility plan](clipboard-images-plan.md) — receiver acceptance and fallback results.
- [User-feedback protocol](user-feedback-protocol.md) — consented manual sessions and evidence boundaries.
- [Test coverage map](pr-test-coverage.md), [CI routing](ci-routing.md) and [CI artifacts](ci-artifacts.md) — automated check ownership and classification.

- [Data-loss investigation](data-loss-investigation.md) � preservation steps, local diagnostics and the September Windows report.

## Proposal-only or validation plans

- [Engineering follow-up](engineering-follow-up-20260918.md) — Phase 0 housekeeping is complete; later extraction and native-evidence phases remain proposals.
- [Improvement plan](improvement-plan.md) — completed release/process work and conditional engineering candidates; listing a task does not authorize implementation.
- [Feedback follow-up](follow-up-plan-20260918.md) — small capture, shortcut and changelog follow-ups; proposal only.
- [Feedback observations](feedback-plan-20260918.md) — historical planning snapshot from the September feedback round.
- [Large-collection performance](large-collection-performance-plan.md) — measurement and scale plan; do not implement without budgets.
- [Capture display matrix](capture-display-matrix.md) — real display-source evidence and outstanding overlay/alignment checks.
- [Recovery unification](recovery-unification-plan.md) — recovery design plan; persistence changes require separate review.
- [Windows copy comparison](windows-copy-comparison.md) — manual verification worksheet for the current clipboard/capture changes.

## Historical evidence

- [History index](history/README.md) — finished execution plans moved out of the repository root.
- [Repository review](repository-review-2026-09-08.md) — dated disposition of older plans and dependency work.
- [Implementation verification](implementation-verification.md) — historical schema-3 benchmark and its limits.
- [Engineering audit](engineering-audit.md), [PR review](pr-review-2026-09-05.md) and [feedback implementation plan](feedback-implementation-plan.md) — older audits and release records.
- [Collection 16 plan](collection-16-plan.md), [stable/nightly design](stable-nightly-release-plan.md) and [backdrop records](backdrop-artwork.md) — dated implementation and design evidence.

Historical documents can contain old versions, branches, test counts or proposed behaviour. Use the current documents above when they disagree.

## Separate sharing service

- [Service README](../share-service/README.md) — service architecture, local commands and operational boundaries.
- [Deployment verification](../share-service/docs/deployment-verification.md) — deployed-service evidence and known manual gaps.
- [Hostinger deployment runbook](../share-service/docs/hostinger-deployment.md) — backup, restore, cleanup, monitoring and rollback.

The service has its own `package-lock.json` and must be installed separately with `npm ci --prefix share-service` before service tests or the desktop share contract are run.

## Agent navigation rules

- Start with [AGENTS.md](../AGENTS.md) for scope, safety and verification requirements.
- Use [implementation status](implementation-plan.md) for what is shipped and what still needs evidence.
- Use [user guide](user-guide.md) for current product behaviour, not an old design brief.
- Treat documents labelled proposal, plan or historical as context; make a separate product or engineering decision before implementing them.
- Keep manual evidence synthetic or explicitly authorized, and record platform, version, revision, expected result and actual result.
