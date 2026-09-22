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
