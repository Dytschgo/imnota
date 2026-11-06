# Visual feedback hillclimb

Status: implementation in progress. Authorized scope is comparison, exact-bundle handoff and persistent quick capture access. Later research candidates are excluded. No merge or publication is authorized by this plan.

## Scoring contract

There are 24 fixed acceptance outcomes and six quality gates. Each is **passed**, **failed** or **unverified**. A pass requires an observed outcome on the recorded revision; implementation or a test count alone earns no points. Composite outcomes pass only when all their clauses pass. Keep failed and unverified counts separate. Do not change the denominator to improve the result. Record evidence and platform beside each outcome as work proceeds.

The target is 24/24 acceptance outcomes and 6/6 quality gates, with zero unresolved review findings. This is engineering acceptance, not evidence of increased user value. User-task timing and clarification rates remain unmeasured until consented sessions occur; no participants are contacted by this work.

## Acceptance outcomes

| ID  | Observable outcome                                                                                                            | Status     | Evidence |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| C1  | Create an optional Current / Expected pair from two distinct screenshots in the active collection.                            | unverified |          |
| C2  | Change the pair to Before / After and preserve each screenshot's independent annotations and description.                     | unverified |          |
| C3  | Save, close and reopen the project with the same pairing and roles.                                                           | unverified |          |
| C4  | Compare annotated, cropped and redacted images side by side; show unequal source dimensions honestly.                         | unverified |          |
| C5  | Linked zoom and pan work for comparable images; keyboard controls and narrow layouts remain usable.                           | unverified |          |
| C6  | Export labels the roles in Markdown and PNG without changing ordinary collection order or numbering.                          | unverified |          |
| C7  | Excluded or removed counterparts produce an explicit incomplete comparison; Undo restores the relationship.                   | unverified |          |
| C8  | Removing a pair preserves images and existing project workflows; failed saves preserve editable selections and a retry route. | unverified |          |
| H1  | Copy an agent instruction identifying the exact prepared export, without relying on latest.                                   | unverified |          |
| H2  | Retrieve that instruction's bundle through the existing MCP interface and obtain its matching Markdown and images.            | unverified |          |
| H3  | Show which collection and included items belong to the prepared handoff.                                                      | unverified |          |
| H4  | Editing content after preparation distinguishes saved evidence from current edits.                                            | unverified |          |
| H5  | Reopening the exact saved files does not silently replace them with a newer export.                                           | unverified |          |
| H6  | Disabled agent access offers setup guidance without enabling access or modifying editor configuration.                        | unverified |          |
| H7  | Copy failures have an actionable retry or file fallback and do not claim receiving-app acceptance.                            | unverified |          |
| H8  | Missing or removed exports report their unavailable state without selecting a different bundle.                               | unverified |          |
| Q1  | A successful capture can remain in a persistent non-modal card after selection closes.                                        | unverified |          |
| Q2  | Copy uses the intended capture and reports failure accurately.                                                                | unverified |          |
| Q3  | Annotate opens the intended capture without discarding other pending captures.                                                | unverified |          |
| Q4  | Add commits the intended capture to the chosen active collection exactly once.                                                | unverified |          |
| Q5  | Discard dismisses only the intended buffered capture and creates no project item.                                             | unverified |          |
| Q6  | Native drag exposes the intended PNG where supported and provides an honest fallback otherwise.                               | unverified |          |
| Q7  | Card placement, keyboard operation and focus behave correctly on supported capture platforms.                                 | unverified |          |
| Q8  | Closing, failure and repeated captures leave no stuck buffers, duplicate commits or silent loss.                              | unverified |          |

## Quality gates

| ID  | Gate                                                                                                         | Status     | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | -------- |
| G1  | Touched-file formatting and final diff inspection pass.                                                      | unverified |          |
| G2  | Lint and application/native type checks pass.                                                                | unverified |          |
| G3  | Targeted regressions and the full existing application/script suite pass.                                    | unverified |          |
| G4  | Production build and Windows native walkthrough cover changed user paths.                                    | unverified |          |
| G5  | Independent review covers persistence/native failure behavior; material findings are resolved and rechecked. | unverified |          |
| G6  | Affected macOS and Linux paths have native evidence; unsupported capabilities are explicit.                  | unverified |          |

## Delivery boundaries

Use separate reviewable PRs for the three independently useful milestones. Preserve existing files, local-first operation, opt-in sharing, read-only agent access and platform capability limits. Record the head SHA, commands, platform and artifacts with each result. No existing test, native gate or failure boundary may be weakened to improve the score.

Comparison metadata uses the existing project save authority. Missing screenshot references must remain recoverable through Undo; viewing or exporting cannot resurrect or include deleted/excluded image bytes. Save failures retain the user's selections for retry. Older builds do not understand new metadata; document the compatibility boundary before publication.
