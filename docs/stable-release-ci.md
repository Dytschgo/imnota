# Stable release CI

The stable workflow runs the tracked-file secret scan, formatting, lint, type checks, the complete application/script suite, and the share-service gates once in Linux `quality`. After classification succeeds, quality and all three package jobs run concurrently. Each package job retains `test:platform`, including the reviewed platform-sensitive application files and all script tests. The separate duplicate release-channel/asset-staging invocation is removed because those tests already belong to the script suite.

The classifier accepts a stable tag only when its peeled commit matches the checkout, belongs to main, and its package version matches the tag. It exports that immutable SHA. Quality, packaging, asset staging, and the public Mac installation verifier all check out that same SHA.

Publication requires successful classification, quality, and every platform package job. The package targets, native walkthroughs, required Mac updater check, asset patterns, manifests, checksums, draft/publication sequence, and permissions retain their existing contracts. The published Mac download must still install and pass its walkthrough before promotion to Latest. A failed quality job cannot publish merely because packaging succeeded. A failed public-install job prevents Latest promotion; the already published non-Latest release remains available as in the previous workflow.

## Parity with nightly gates

Stable publication previously had weaker gates than a nightly prerelease. Stable `quality` now also installs the share service and runs its tests, `npm audit --omit=dev --audit-level=high`, and `pnpm test:share-contract`, as nightly `quality` does. The Windows package job compares the packaged walkthrough's screenshots with the approved `tests/visual/win32` baselines and retains them as the `windows-visual-evidence-release` artifact. That name deliberately falls outside the `release-*` pattern the publish job downloads, so evidence can never be staged as a release asset.

`quality` in Validate, nightly, and stable also runs `scripts/secret-scan.mjs`, which before ran only from the local `scripts/release.mjs`. It reads the checked-out index, reports filenames only, and needs no Git history. It is a guard against known credential patterns and forbidden data paths in tracked files, not a history scan or a substitute for review.

The audit gate depends on the advisory database at the time of the tag. A high-severity advisory published against a share-service production dependency after the PR merged blocks stable publication until it is fixed or patched on main and a new version is tagged. That is the intended behaviour; do not remove the gate to force a release through.

Every job has a `timeout-minutes` limit: 45 minutes for package jobs, 30 for publish and the public Mac installation, 20 for quality, 10 for classification, and 5 for Latest promotion. The v0.4.0 run below measured at most 8m 13s for a package job, 2m 10s for quality, and 2m 03s for the public installation, so the limits bound a hung step without constraining a normal run. A publish job that times out during upload leaves the draft release unpublished. Runs for the same tag queue in one concurrency group with `cancel-in-progress: false`, so a re-pushed tag or a re-run cannot race an in-flight publication and never cancels it.

These additions were validated with Actionlint and line-by-line review. PR CI exercises the same share-service, contract, secret-scan, and Windows visual commands in Validate, but cannot execute the tag-triggered workflow; the next stable release is their first execution here, including `actions/download-artifact` v8, which fails on a digest mismatch instead of warning.

## Evidence and limits

The older successful [stable run 34164395030](https://github.com/Dytschgo/imnota/actions/runs/34164395030), at `bd33da45fac5bf05f20e6cdb9f66c5db709b3bdf`, spent about 59s on Linux, 83s on Windows, and 52s on macOS in each repeated format/lint/type/full-test/release-test block. That revision predates current application changes, so these numbers demonstrate repeated work rather than predict current savings.

The first subsequent stable release, [v0.4.0 run 36604925452](https://github.com/Dytschgo/imnota/actions/runs/36604925452), passed at `b0cec89daddedcdad79b44022142177b098c6a09` on 2026-09-29. From workflow creation to completion of Latest promotion it took 12m 41s. Quality took 2m 10s; the concurrent package jobs took 4m 58s on Windows, 4m 52s on Linux and 8m 13s on macOS. These timings include the current tests, builds and runner conditions; they are not a controlled comparison with the older revision.

The public Mac installation job took 2m 03s: it downloaded the published archive, verified its checksum, installed it and confirmed Imnota 0.4.0 with 26 native assertion groups before Latest promotion. The release has all 16 expected assets, including three update manifests and checksums; published asset digests match `SHA256SUMS.txt`, the downloaded manifests name 0.4.0, and the download aliases match their versioned files. This verifies the exact release, not later revisions. The Mac walkthrough ran on Apple Silicon; Intel execution, physical Gatekeeper prompts, NSIS/deb installation and compatibility with external clipboard receivers remain unverified.

For changes to this workflow, validate it with Actionlint, review the job dependencies and failure paths, and exercise the actual classifier shell against a disposable Git repository with a local bare origin. Cases cover a valid annotated stable tag, tag/package-version mismatch, nightly tag, tag/checkout mismatch, and a candidate outside main. Failed cases must write no classification outputs. Existing release-channel, asset-staging, and release-readiness tests cover the corresponding tag, manifest, checksum, and acceptance contracts.

Full PR validation exercises the same platform test/package/native commands, while independent workflow review checks stable-only ordering and gates. This does not claim that PR CI executes the tag-triggered publication or public-download installation jobs. Nightly and ordinary PR workflow routing are unchanged by this slice.

Rollback is a revert of the workflow change before creating the next stable tag. No data migration, package version bump, new trigger, or branch-protection change is needed.
