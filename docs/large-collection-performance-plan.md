# Large-collection performance plan

Status: remaining scale plan. The first bounded-composition reuse implementation and its measurements are in [PR #116](https://github.com/Dytschgo/imnota/pull/116); the broader work below remains proposed until separately scoped.

Measured Windows stress on synthetic images already shows that export is the bottleneck. Photographic images will cost more. Treat this as a current UX issue for 20–50 item collections, not a future scale feature.

## Budgets to publish after the next measured run

Record import, reload, first prompt copy, peak renderer/main/GPU working set, and whether the UI stayed interactive for:

- 1, 10, 50, and 100 screenshots
- the same sizes with mixed text and drawings
- one photographic / high-entropy fixture (not only synthetic stripes)

Keep the isolated runner and disposable projects. Label single-machine numbers as local evidence.

## Work order

1. **Instrument, do not guess.** Profile import, thumbnail decode, canvas retain, and export separately.
2. **Bound decode.** Limit concurrent image decode for rail thumbnails and export. Drop decoded bitmaps that are not on screen or in the current export batch.
3. **Virtualise the collection rail.** Only mount visible rows. Keep drag-reorder, include/exclude, and mixed item types working.
4. **Export off the interactive path.** Render prompt PNGs in batches with progress, cancellation, and retry. Do not retain every annotated bitmap after a bundle is written.
5. **Split incrementally.** Write and release each prompt pair before starting the next, so peak memory does not grow with bundle count.
6. **Progress copy.** Show item N of M, estimated remaining work, and a working Cancel that leaves completed pairs and removes incomplete ones (already the storage contract).

## Acceptance

- Documented budgets for 1 / 10 / 50 / 100 mixed items, including one photographic fixture.
- Cancel during export is proven from the native UI, not only controller tests.
- A 50-item mixed collection remains usable: rail scrolling, item switching, and a cancellable export that does not sit near 1 GB after completion.

## Out of scope

- Claiming support for very large projects before those budgets exist
- Changing Picture-number or exclusion rules to make export cheaper
- Cloud offload of rendering

## Bounded composition reuse — Windows measurement, 2026-09-22

The export controller now retains at most 8,388,608 characters of composed output during one export, reuses those outputs after split planning, and releases them as bundles are written. Larger outputs are recomposed. Source revision and screenshot bytes/dimensions are checked before writing cached output; cancellation still prevents the write. Independent review covered these invalidation and cleanup paths.

One local before/after run used `node scripts/visual-performance.mjs`, separate disposable projects, and the same synthetic fixtures. Baseline: `a3f576e`; implementation: `65d44c1`. These are individual Windows measurements, not statistical performance guarantees. Targeted development checks also ran during parts of the session.

| Native scenario | Baseline render time | With reuse | Bundles |
| --------------- | -------------------: | ---------: | ------: |
| Mixed 10        |            23,979 ms |  22,025 ms |       6 |
| Mixed 20        |            20,454 ms |  20,022 ms |      13 |
| Mixed 100       |            57,604 ms |  55,335 ms |      66 |
| Dense 20        |            22,616 ms |  20,301 ms |      13 |

For dense 20, peak renderer working set fell from 1,033.6 MB to 924.9 MB and post-run renderer working set from 1,026.1 MB to 847.6 MB. GPU post-run working set increased from 738.8 MB to 915.0 MB; this change does not establish a GPU-memory improvement. Native walkthrough assertions passed in both runs. Reports and synthetic screenshots remain local verification artifacts.

Controller regression tests cover 1, 10, 20, 50, and 100 bundles, bounded-cache fallback, changed source pixels with unchanged metadata revision, cancellation, and replanning. The photographic/high-entropy fixture, native 50-item budget, and broader decode/rail work above remain open; this optimization does not meet all scale acceptance criteria.

## Image memory bounds - Windows investigation, 2026-09-22

A reported Windows incident involved about 20 screenshots. The exact image sizes, PC RAM, preceding actions and physical-file state are unknown. Memory pressure is a plausible crash trigger; this investigation has not linked it to removal of saved originals. The separate [diagnostics PR #119](https://github.com/Dytschgo/imnota/pull/119) records allowlisted process termination reasons, including `oom`, and a memory observation at termination. That observation is not a pre-crash peak and cannot explain an earlier incident retroactively.

The memory review candidate bounds thumbnail width and height to 220 pixels, with a 16 MiB encoded-data / 300-entry LRU cache and two yielding decode slots. Previously, a 100 x 30000 screenshot became a 220 x 66000 preview (about 55.4 MiB of raw RGBA pixels); it now produces a 1 x 220 preview. Original files are unchanged. The native decoder still loads the original, so these are preview/cache bounds, not a whole-process RAM cap.

Export now encodes its existing layer directly, disables unused hit testing, sets both layer and translucent-shape scratch surfaces to native pixel ratio, and releases decoded sources and temporary pixelation canvases after use. Existing export cache limits remain in place. The controller audit found that screenshot PNG payloads are not retained in its final plan; it retains metadata and thumbnails, and clears the bounded composition cache after each run. High working-set readings alone do not establish a retained-object leak.

One before/after run used the existing `node scripts/visual-performance.mjs` workflow on Windows, with disposable projects and the same ordered 1/10/20/50/100 landscape fixtures (1080p, 1600p and 4K). Baseline was `e0eb249` with loading-memory instrumentation; the comparison used this candidate. Native pixel verification additionally exercised DPR-2 browser emulation, opacity and pixelation. New tall and high-entropy fixtures ran after the comparable collection measurements. No forced garbage collection was used. These are single-machine observations; phases inherit earlier allocations and are not isolated cold-start measurements.

| Scenario / process measurement            | Before (MiB) | After (MiB) |
| ----------------------------------------- | -----------: | ----------: |
| Load 20: sampled main peak                |        467.5 |       323.6 |
| Load 50: sampled main peak                |        727.2 |       554.4 |
| Export 20: renderer after                 |        752.0 |       754.2 |
| Export 20: GPU process after              |        681.5 |       413.9 |
| Dense export 20: sampled renderer peak    |        883.3 |       850.5 |
| Dense export 20: sampled main peak        |        557.3 |       717.9 |
| Dense export 20: sampled GPU process peak |        939.4 |       939.4 |
| Export 100: renderer after                |        967.3 |      1002.3 |
| Export 100: main after                    |        604.5 |       389.8 |

The results are mixed: preview limits and removed canvas allocations are verified, but this run does not demonstrate a general reduction in renderer RAM or a leak fix. Export remains expensive. GPU figures are process working sets, not dedicated GPU memory; separate process peaks may occur at different times and must not be summed into one simultaneous peak. The 200 ms main-thread sampler can miss brief peaks during synchronous decoding. Further heap/retained-object profiling and repeated isolated runs are needed before publishing a total-memory budget or claiming support on low-RAM PCs.

The comparison passed 28 native assertion groups, including the 50-image load, a 100 x 30000 image, ten deterministic high-entropy 1024 x 1024 PNGs and complete 20/100-image exports. High-entropy and tall images retained every preview within 220 x 220. This does not substitute for the remaining photographic/mixed-content scale matrix. Local reports are `.git/imnota-verification-artifacts-memory-before/verification-report.json` and `.git/imnota-verification-artifacts-memory-after/verification-report.json`; synthetic artifacts remain uncommitted.

Prioritized follow-ups are recorded in [the improvement plan](improvement-plan.md): maximum-wait autosave during sustained editing, transactional import, and source-size validation before native decode. None is established as the reported incident's cause.
