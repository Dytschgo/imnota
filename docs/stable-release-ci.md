# Stable release CI

The stable workflow runs formatting, lint, type checks, and the complete application/script suite once in Linux `quality`. After classification succeeds, quality and all three package jobs run concurrently. Each package job retains `test:platform`, including the reviewed platform-sensitive application files and all script tests. The separate duplicate release-channel/asset-staging invocation is removed because those tests already belong to the script suite.

The classifier accepts a stable tag only when its peeled commit matches the checkout, belongs to main, and its package version matches the tag. It exports that immutable SHA. Quality, packaging, asset staging, and the public Mac installation verifier all check out that same SHA.

Publication requires successful classification, quality, and every platform package job. The package targets, native walkthroughs, required Mac updater check, asset patterns, manifests, checksums, draft/publication sequence, and permissions retain their existing contracts. The published Mac download must still install and pass its walkthrough before promotion to Latest. A failed quality job cannot publish merely because packaging succeeded. A failed public-install job prevents Latest promotion; the already published non-Latest release remains available as in the previous workflow.

## Evidence and limits

The older successful [stable run 34164395030](https://github.com/Dytschgo/imnota/actions/runs/34164395030), at `bd33da45fac5bf05f20e6cdb9f66c5db709b3bdf`, spent about 59s on Linux, 83s on Windows, and 52s on macOS in each repeated format/lint/type/full-test/release-test block. That revision predates current application changes, so these numbers demonstrate repeated work rather than predict current savings. No new stable version is published just to benchmark this cleanup; actual stable elapsed time and public-install execution must be recorded at the next real stable release.

For this change, validate the workflow with Actionlint, review the job dependencies and failure paths, and exercise the actual classifier shell against a disposable Git repository with a local bare origin. Cases cover a valid annotated stable tag, tag/package-version mismatch, nightly tag, tag/checkout mismatch, and a candidate outside main. Failed cases must write no classification outputs. Existing release-channel, asset-staging, and release-readiness tests cover the corresponding tag, manifest, checksum, and acceptance contracts.

Full PR validation exercises the same platform test/package/native commands, while independent workflow review checks stable-only ordering and gates. This does not claim that PR CI executes the tag-triggered publication or public-download installation jobs. Nightly and ordinary PR workflow routing are unchanged by this slice.

Rollback is a revert of the workflow change before creating the next stable tag. No data migration, package version bump, new trigger, or branch-protection change is needed.
