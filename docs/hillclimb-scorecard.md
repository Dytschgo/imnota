# Visual feedback hillclimb

Status: implementation in progress. Authorized scope is comparison, exact-bundle handoff and persistent quick capture access. Later research candidates are excluded. No merge or publication is authorized by this plan.

## Scoring contract

There are 24 fixed acceptance outcomes and six quality gates. Each is **passed**, **failed** or **unverified**. A pass requires an observed outcome on the recorded revision; implementation or a test count alone earns no points. Composite outcomes pass only when all their clauses pass. Keep failed and unverified counts separate. Do not change the denominator to improve the result. Record evidence and platform beside each outcome as work proceeds.

The target is 24/24 acceptance outcomes and 6/6 quality gates, with zero unresolved review findings. This is engineering acceptance, not evidence of increased user value. User-task timing and clarification rates remain unmeasured until consented sessions occur; no participants are contacted by this work.

## Acceptance outcomes

| ID  | Observable outcome                                                                                                            | Status     | Evidence                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| C1  | Create an optional Current / Expected pair from two distinct screenshots in the active collection.                            | passed     | Windows native selection and persisted metadata; comparison UI regressions                       |
| C2  | Change the pair to Before / After and preserve each screenshot's independent annotations and description.                     | passed     | Windows native mode change and unchanged screenshot records; independent annotation-render tests |
| C3  | Save, close and reopen the project with the same pairing and roles.                                                           | passed     | Windows native window reopen and saved role selection                                            |
| C4  | Compare annotated, cropped and redacted images side by side; show unequal source dimensions honestly.                         | passed     | Reviewed native comparison-current-expected.png; shared crop/redaction renderer                  |
| C5  | Linked zoom and pan work for comparable images; keyboard controls and narrow layouts remain usable.                           | passed     | Windows native linked keyboard zoom/pan and 1080px layout; viewer regressions                    |
| C6  | Export labels the roles in Markdown and PNG without changing ordinary collection order or numbering.                          | passed     | Reviewed native comparison-export.md/png; split/identity-stamping regressions                    |
| C7  | Excluded or removed counterparts produce an explicit incomplete comparison; Undo restores the relationship.                   | passed     | Real-filesystem two-delete/Undo test and missing/excluded viewer/export regressions              |
| C8  | Removing a pair preserves images and existing project workflows; failed saves preserve editable selections and a retry route. | passed     | Native relationship-only removal; failed-save/flush/retry UI regressions                         |
| H1  | Copy an agent instruction identifying the exact prepared export, without relying on latest.                                   | passed     | Windows native clipboard exact ID; controller saved-grant regressions                            |
| H2  | Retrieve that instruction's bundle through the existing MCP interface and obtain its matching Markdown and images.            | passed     | Windows native loopback get_bundle; byte-identical saved Markdown and PNG                        |
| H3  | Show which collection and included items belong to the prepared handoff.                                                      | passed     | Reviewed 1280px saved collection/item scope; UI and controller scope tests                       |
| H4  | Editing content after preparation distinguishes saved evidence from current edits.                                            | passed     | Windows native edit/reopen shows changed content and retains the original ID and files           |
| H5  | Reopening the exact saved files does not silently replace them with a newer export.                                           | passed     | Controller exact-path open after edits; no regeneration; real native grant validation            |
| H6  | Disabled agent access offers setup guidance without enabling access or modifying editor configuration.                        | passed     | Windows native access-off guidance; disabled copy; preferences remain off                        |
| H7  | Copy failures have an actionable retry or file fallback and do not claim receiving-app acceptance.                            | passed     | UI failed-copy retry and exact-file fallback; copy-only success wording                          |
| H8  | Missing or removed exports report their unavailable state without selecting a different bundle.                               | passed     | Real-filesystem missing PNG and expired grant regressions; explicit unavailable errors           |
| Q1  | A successful capture can remain in a persistent non-modal card after selection closes.                                        | unverified |                                                                                                  |
| Q2  | Copy uses the intended capture and reports failure accurately.                                                                | unverified |                                                                                                  |
| Q3  | Annotate opens the intended capture without discarding other pending captures.                                                | unverified |                                                                                                  |
| Q4  | Add commits the intended capture to the chosen active collection exactly once.                                                | unverified |                                                                                                  |
| Q5  | Discard dismisses only the intended buffered capture and creates no project item.                                             | unverified |                                                                                                  |
| Q6  | Native drag exposes the intended PNG where supported and provides an honest fallback otherwise.                               | unverified |                                                                                                  |
| Q7  | Card placement, keyboard operation and focus behave correctly on supported capture platforms.                                 | unverified |                                                                                                  |
| Q8  | Closing, failure and repeated captures leave no stuck buffers, duplicate commits or silent loss.                              | unverified |                                                                                                  |

## Quality gates

| ID  | Gate                                                                                                         | Status     | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | -------- |
| G1  | Touched-file formatting and final diff inspection pass.                                                      | unverified |          |
| G2  | Lint and application/native type checks pass.                                                                | unverified |          |
| G3  | Targeted regressions and the full existing application/script suite pass.                                    | unverified |          |
| G4  | Production build and Windows native walkthrough cover changed user paths.                                    | unverified |          |
| G5  | Independent review covers persistence/native failure behavior; material findings are resolved and rechecked. | unverified |          |
| G6  | Affected macOS and Linux paths have native evidence; unsupported capabilities are explicit.                  | unverified |          |

## Comparison milestone evidence

Product source revision: `04021755a8743867a8a48588fe83025b5d6f19ea`. The verification runs used the identical working-tree source immediately before that commit. Overall acceptance count: **8 passed, 0 failed, 16 unverified (24 total)**. The six aggregate quality gates stay unverified until the applicable evidence covers all three milestones.

Comparison-specific checks passed on Windows: touched-file Prettier and diff inspection, lint, typecheck, production build, 175 focused regression tests, and the full suite (182 application test files; 2,498 application tests passed, three skipped; 237 script tests passed, 14 skipped). Skips are existing platform limitations, not passed checks. The final isolated native walkthrough passed all 33 assertion groups and includes trusted selection, both comparison modes, save/reopen, exact saved export, native keyboard-linked zoom/pan and supported narrow layout. No installed or packaged macOS/Linux result is claimed.

Local native evidence is retained outside tracked source in the common Git directory under `imnota-verification-artifacts-comparison-20261106e/`: `verification-report.json`, `comparison-current-expected.png`, `comparison-before-after-narrow.png`, `comparison-export.md` and `comparison-export.png`. The two viewer captures and actual exported PNG were visually inspected. The PNG's first included visual says Expected / Picture 2; Picture 1 stays excluded.

Independent Standards and Spec reviews, followed by a final review of the export correction, reported no material findings. The final review recorded WIP base `8d2bc4f933b11b6a3cc040ae4f3229ff08b8d2e1` and tracked diff hash `3ec1050010e6034b0217ece7e6acdf9b1e47701f`, and also inspected the six untracked source/test/scorecard files committed above.

Retained failure history: initial native attempts exposed a Settings precondition in the walkthrough and an unsupported 960px viewport (the production minimum is 1064px); both verification setup errors were corrected. A stronger native saved-export check then exposed comparison summary loss while stamping export identity. A regression failed before the fix and passed afterward; the final native run verifies the corrected saved output. An existing deadline-control test failed during the initial full run, passed in isolation, and passed in the final full run; its intermittent cause is not established and no deadline was relaxed. Visual baseline reconciliation and supported-platform CI evidence remain open.

## Comparison platform follow-up

Revision `0447c9e75abc1eeef8dc7bad218dba08357fee48` moves the entry beside the Collection heading and makes the native mode-selection setup portable on macOS. Windows, macOS and Linux packaged walkthrough jobs passed in [Validate 42144955870](https://github.com/Dytschgo/imnota/actions/runs/42144955870). All 14 approved Windows visual checks passed without changing their baselines or tolerances; the 1280 × 800 light/dark workspace candidates were inspected to verify the compact entry and preserved toolbar layout. Local lint, type checks, build, 89 focused tests and the full suite also passed (2,498 application tests plus 237 script tests; existing skips unchanged).

The overall initial CI attempt failed in the unchanged persistence-ledger runner-window test in the Linux service-security job. Its failure log is retained. Failed jobs were explicitly rerun once, and [attempt 2](https://github.com/Dytschgo/imnota/actions/runs/42144955870/attempts/2) passed; the initial failure is not erased or counted as a pass. No test timeout or assertion was changed.

## Exact handoff milestone evidence

Product revision: `ee34a94e59c54f2bfc920d038b108cb0a3639939`; documentation-only PR head `3c1afc8a5756a1247128514b817513846a5b7e09`. [PR #307](https://github.com/Dytschgo/imnota/pull/307) is a draft. [Validate 42145260875](https://github.com/Dytschgo/imnota/actions/runs/42145260875) passed all Windows, macOS and Linux package/native, quality and service-security jobs. Local Windows lint, types, build and the full application/script suite passed (182 application files; 2,495 application tests passed, three skipped; 237 script tests passed, 14 skipped). The complete Windows walkthrough passed 33 assertion groups, including real clipboard instruction copy, loopback MCP retrieval with exact saved Markdown/PNG bytes, access-off guidance and changed-content labeling. Both 1280 × 800 handoff captures were visually inspected in `imnota-verification-artifacts-handoff-20261106b/` under the common Git directory.

Controller/UI and real-filesystem regressions cover included-item scope, exact-file opens without regeneration, copy failure/retry, expired grants and missing PNGs. Independent Standards and Spec reviews reported no material findings. Receiving-editor acceptance is not claimed. The user-requested six-check Lab Manager Playwright run remains unverified: the manager thread identified stale MCP adapters and a native app/broker executable mismatch, and no approved source policy currently covers this checkout. No Playwright pass is inferred from the native or unit results.

Current cumulative acceptance: **16 passed, 0 failed, 8 unverified (24 total)**. Quick capture and all six aggregate gates remain unverified until their applicable work is complete. These counts describe the separate reviewed source revisions above, not an integrated or released application.

## Delivery boundaries

Use separate reviewable PRs for the three independently useful milestones. Preserve existing files, local-first operation, opt-in sharing, read-only agent access and platform capability limits. Record the head SHA, commands, platform and artifacts with each result. No existing test, native gate or failure boundary may be weakened to improve the score.

Comparison metadata uses the existing project save authority. Missing screenshot references must remain recoverable through Undo; viewing or exporting cannot resurrect or include deleted/excluded image bytes. Save failures retain the user's selections for retry. Older builds do not understand new metadata; document the compatibility boundary before publication.
