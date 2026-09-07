# Implementation verification

Status: local implementation accepted with the platform and coverage limits below. This is not release approval.

The implementation follows [implementation plan.md](../implementation%20plan.md). Work is committed locally on `feature/imnota-implementation`; no release, push, cloud service, AI integration, or user recruitment was performed.

## Implemented areas

- Schema 3 collections, lossless legacy migration, descriptions and priority, screenshot ordering and export visibility, archive/restore, and local preferences.
- Annotation tools, inline text, numbered text references, expanded export bounds, crop/redaction handling, and export contrast correction.
- Automatically split PNG/Markdown prompt pairs, timestamped storage, fresh primary copy actions, same-session clipboard fallbacks, previews, progress, cancellation, and cleanup retry.
- Responsive desktop shell, collection rail, inspector, isolated replayable onboarding, themes, optional glass, and configurable shortcuts.
- Transactional screenshot persistence, recovery journals, OS-trash recovery snapshots, file watching, and optimistic revision checks.
- Extracted typed application modules, updated user/developer/data-format documentation, onboarding art prompts, and a user-feedback protocol.

## Final verification

Runtime/build revision: `5a1e734`. Subsequent handoff changes are documentation only.

| Check                             | Result                                                                                              | Scope                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Automated tests                   | 310 application tests and 34 script tests passed                                                    | One existing packaged-macOS fixture skipped                                                   |
| Formatting, lint, typecheck       | Passed                                                                                              | Integrated source and documentation                                                           |
| Production build                  | Passed                                                                                              | Renderer JavaScript 638.29 kB minified / 194.86 kB gzip; Vite large-chunk warning remains     |
| Independent high-risk review      | Accepted corrected transaction/trash helpers, native recovery integration, and renderer persistence | No remaining concrete review finding                                                          |
| Final isolated Windows stress run | All 14 assertion groups passed                                                                      | Includes ordinary smoke workflow, 1/10/20/100 mixed-resolution fixtures and dense annotations |
| Native clipboard                  | Real text, HTML and PNG representations verified                                                    | Receiving-editor paste compatibility cannot be inferred                                       |
| Export pixels                     | Decode, dimensions, crop privacy, opaque redaction and expanded bounds passed                       | Retained synthetic PNG/Markdown pairs visually inspected                                      |
| Responsive UI                     | Four desktop sizes captured in light/dark; repaired toolbar and Settings layouts visually accepted  | Reviewed artifacts, not automated pixel-diff baselines                                        |
| Collections                       | Archive/restore, reorder/IDs, excluded-row selection and eye toggles passed dedicated UI tests      | Native collection/storage behavior also has domain tests                                      |

The final native run used `.git/imnota-verification-artifacts-final-stress-01`. Its report, desktop captures, and `verified-pixel-prompt` / `verified-dense-prompt1` PNG and Markdown files are local, ignored verification artifacts. Temporary profiles and synthetic projects were cleaned by the isolated runner.

Independent review caught and corrected save/recovery races. The last regression verifies that a screenshot edit saved during project reopening produces S3, and that the UI, accepted revision, and exported context adopt S3 rather than the earlier S2 open response. Same-project reopening now always rereads authoritative disk state after pending screenshot saves.

Native input verifies text creation, Enter, reopening, editing, Escape, and reopening again. It also exercises pan, crop, redaction, and drawing an arrow outside image bounds. Export checks cover fresh timestamped sets, complete PNG/Markdown pairs, stable exclusion references, native clipboard contents, recovery, file watching, stale CAS rejection, and fixture-only trash/Undo.

## Measured performance

Measured on this Windows development machine using mixed 1920×1080, 2560×1600, and 3840×2160 synthetic images:

| Collection                      | Import | Project reload | Prompt operation                | Prompt pairs                          | Renderer memory after export |
| ------------------------------- | ------ | -------------- | ------------------------------- | ------------------------------------- | ---------------------------- |
| 1 screenshot                    | 53 ms  | 11 ms          | Separate pixel fixture verified | 1                                     | Not profiled separately      |
| 10 screenshots                  | 594 ms | 18 ms          | 8.91 s for two fresh actions    | 6 per action; one screenshot excluded | 882 MB                       |
| 20 screenshots                  | 1.31 s | 18 ms          | 9.34 s for one fresh action     | 13                                    | 867 MB                       |
| 100 screenshots                 | 9.01 s | 66 ms          | 58.57 s for one fresh action    | 66                                    | 906 MB                       |
| 20 screenshots / 200 text notes | 1.28 s | 33 ms          | 10.91 s for one fresh action    | 13                                    | 947 MB                       |

The dense fixture includes eight inside-source notes and two outside-source notes per screenshot. All 200 unique text markers and all Picture 1–20 / Note 1–10 headings occur exactly once across the generated per-prompt Markdown files. The first dense pair was visually checked for visible text, numbered badges, white background, picture headers, and inclusion of outside annotations.

Dense export memory was sampled every 200 ms, with 53 readings:

| Process     | Baseline | Sampled peak | Immediately after |
| ----------- | -------- | ------------ | ----------------- |
| Main        | 199 MB   | 318 MB       | 315 MB            |
| Renderer    | 123 MB   | 1,034 MB     | 947 MB            |
| GPU process | 160 MB   | 928 MB       | 914 MB            |

These are resident working-set samples, not heap measurements or guaranteed absolute peaks. Peaks for different processes need not occur simultaneously. GPU-process working set is not a dedicated VRAM measurement. The benchmark includes prior activity in the same app process; it does not establish a memory leak or long-running steady state.

Prompt timings include dialog preparation and the complete fresh-copy action. Project reload timings measure project loading, not full application startup. Synthetic stripes compress well, so photographic/high-entropy images may behave differently. A first stress attempt exceeded the small-fixture 30-second test deadline while still progressing; the harness now uses a bounded workload-based deadline without relaxing product quality or resource limits.

## Remaining platform and coverage limits

- macOS launch, Linux packaging, and paste acceptance inside individual coding editors were not exercised here.
- Cancellation and failed-write cleanup have controller/storage tests, but real native UI interruption during export has not been tested.
- Edge-pan math and pointer ownership have tests; the native sequence does not measure a held drag of an existing annotation at the viewport edge.
- Desktop captures are reviewed evidence, not a complete automated visual-regression suite.
- High-entropy screenshots, long-running memory behavior, bounded thumbnail decoding concurrency, and renderer bundle splitting are useful follow-ups. The dense export's memory use is material; this report does not claim universal low-resource performance.
- User-feedback sessions are prepared, not conducted. No users were contacted.

## Test isolation deviation

Use the isolated runner in [development.md](development.md) for native verification. It creates temporary profiles/workspaces and validates cleanup paths.

An early worker development launch used the default app profile rather than an isolated profile and wrote application cache/session data. No before-state snapshot exists, so absence of other effects cannot be established. The user was informed; no cleanup or restoration of that real profile was attempted. All subsequent acceptance runs used the isolated runner.
