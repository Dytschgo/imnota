# Electron download cache experiment

The archive-cache pilot in [PR #42](https://github.com/Dytschgo/imnota/pull/42) did not establish worthwhile savings. The final change removes the experimental workflow additions and records the evidence. Existing dependency caches, verification, packaging, and release workflows remain unchanged.

## Method and integrity

Both full `pull_request` Validate attempts used commit `4ecbb8eabffaf5c1abb156a082b818cc19059b40`: [cold attempt 1](https://github.com/Dytschgo/imnota/actions/runs/34284213202/attempts/1), then [warm attempt 2](https://github.com/Dytschgo/imnota/actions/runs/34284213202/attempts/2). The cold run passed and saved all three caches before the unchanged revision was rerun. This was one deliberate measurement rerun, with no failed attempts or automatic retries.

The pilot restored Electron ZIPs from the default Linux, macOS, and Windows cache locations, plus only the builder cache's `downloads` directory. Keys included OS, runner architecture, and the exact lockfile hash, with no fallback restore keys. All entries were scoped to `refs/pull/42/merge`. The existing pnpm dependency cache was already warm in both attempts.

Source inspection of the installed Electron downloader versions (`@electron/get` 2.0.3 and 3.1.0) confirmed checksum validation on cached archives. A local synthetic test against each version demonstrated one cold download, warm reuse without another download, and rejection/redownload after corrupting the cached bytes. Builder helpers retain their pinned archive checksums; Electron packaging still fetches `SHASUMS256.txt` on warm hits. Extracted helper directories were deliberately excluded: their existing fast path checks completion metadata/file counts rather than archive content integrity. Extraction therefore remains part of every build.

## Observed results

Times below are seconds from GitHub job/step timestamps. A zero means no full second at that resolution. The affected subtotal includes cache restore, dependency installation, packaging, and cache save; it excludes tests, native verification, and artifact upload.

| Runner / architecture | Cold package | Warm package | Cold restore / save | Warm restore / save | Cold install | Warm install | Cold affected subtotal | Warm affected subtotal | Cold job | Warm job |
| --------------------- | -----------: | -----------: | ------------------: | ------------------: | -----------: | -----------: | ---------------------: | ---------------------: | -------: | -------: |
| ubuntu-latest / X64   |          149 |          152 |               0 / 2 |               1 / 0 |            6 |            6 |                    157 |                    159 |      242 |      234 |
| windows-latest / X64  |          145 |          146 |               1 / 3 |               4 / 0 |           10 |           11 |                    159 |                    161 |      336 |      342 |
| macos-latest / ARM64  |          267 |          211 |              0 / 16 |               7 / 0 |            9 |           11 |                    292 |                    229 |      511 |      431 |

Package-job scheduling delay (`created_at` to `started_at`) was 3s on Linux/Windows and 8s on macOS in both attempts. macOS retained universal x64/arm64 packaging despite its ARM64 runner.

The warm logs show actual downloader hits, not just successful cache restoration: 4 on Linux, 5 on Windows, and 4 on macOS, with zero archive misses. Saved cache sizes were 125,765,591, 142,129,977, and 254,873,823 bytes respectively: 522,769,391 bytes total, separate from pnpm caches and package artifacts. Warm exact-key hits did not save another copy.

Cold download traces were already short. Conservative approximate windows, including the Electron ZIP transfer through the subsequent checksum-request start, sum to under 1.2s on Linux, 2.0s on Windows, and 2.3s on macOS. Helper transfer completion uses the logged progress callback, so these are diagnostic estimates, not precise network benchmarks. The earlier 100% callbacks alone understate transfer/write completion. Warm runs still fetch Electron checksums, hash archives, and extract them.

Linux and Windows showed no improvement in the affected subtotal. macOS's 63s lower subtotal cannot be attributed to avoiding roughly two seconds of observed transfers; its cold cache save alone cost 16s, and runner/build variation affects much larger portions of the job. An [earlier uncached PR run](https://github.com/Dytschgo/imnota/actions/runs/34282924402), at `fd0f8877cb66ea3966523e1b76b20cc29686d4e2` with the same application/dependencies, packaged in 180s Linux, 169s Windows, and 220s macOS. These varying totals are context, not a causal speedup estimate.

Both attempts passed full quality, platform-sensitive and script suites, native packaged walkthroughs on all three OSes, Windows visual checks, and sharing security checks. Package artifact selection and compression were unchanged. No stable or nightly release was created for this measurement.

## Decision

Do not retain or extend this cache to nightly/stable workflows. Windows/macOS restore costs exceed the observed transfers; Linux is approximately break-even at best and showed no measured benefit. Another cache adds storage, invalidation, and maintenance without demonstrated release-speed value. Independent review agreed with removing it.

This is a single cold/warm pair, not a general claim that Electron caching never helps. Revisit only if repeated traces show materially slower downloads, or a different runner/dependency setup changes the balance. Cache hits alone and noisy whole-job improvements are insufficient evidence. All tests and release gates remain in place.
