# UI improvements: merge and nightly plan

Status at final PR preparation: execution authorized on 2026-09-09; #44 through #50 are merged. #51 contains the complete reviewed candidate. Final main checks and nightly publication remain pending.

## Outcome and scope

Land the eight UI-feedback PRs separately, resolve the integration findings, and publish one verified nightly from the final immutable main commit. Preserve the original girl backgrounds alongside the four generic backgrounds. Keep stable publication, dependency upgrades and data-format changes outside this work.

The source review is Grok's `grok-review-24d3e61d.md`, supplied from `C:/Users/DYLANF~1/AppData/Local/Temp/grok-DylanFerraro/`. The original feedback and implementation evidence remain in [UI-Improvemnts.md](UI-Improvemnts.md).

## Current evidence

Remote main is `6215c64c1b48efa6aafc33169fdf45844a787ac1`. All eight UI PR heads below have completed checks with no failures. These checks validate their current bases, not the future combined release. Recheck all heads and requirements when execution starts.

| Order | PR                                                                             | Current head | Current base |
| ----- | ------------------------------------------------------------------------------ | ------------ | ------------ |
| 1     | [#44 Navigation and header](https://github.com/Dytschgo/imnota/pull/44)        | `1c7e37b`    | main         |
| 2     | [#45 Dialogs and previews](https://github.com/Dytschgo/imnota/pull/45)         | `2d63aab`    | main         |
| 3     | [#46 Collection cleanup and trash](https://github.com/Dytschgo/imnota/pull/46) | `c97388e`    | #44 branch   |
| 4     | [#47 Stale delete banner](https://github.com/Dytschgo/imnota/pull/47)          | `ce3dbd3`    | #46 branch   |
| 5     | [#48 Toolbar and tooltips](https://github.com/Dytschgo/imnota/pull/48)         | `a41d403`    | main         |
| 6     | [#49 Drawing canvas](https://github.com/Dytschgo/imnota/pull/49)               | `c5f11b4`    | main         |
| 7     | [#50 Glass and transparency](https://github.com/Dytschgo/imnota/pull/50)       | `af1475b`    | main         |
| 8     | [#51 Generic backdrops](https://github.com/Dytschgo/imnota/pull/51)            | `ba640e4`    | #50 branch   |

Exclude #4 Electron, #5 React-Konva, #6 Zod, #7 React Hooks lint, #8 Tailwind and #41 Vitest. These are dependency/tooling major upgrades, including the newer test-runner PR. All currently have failed checks; none belongs in this UI nightly.

Remote main currently requires an up-to-date `quality` check, linear history and resolved conversations. It requires zero formal approving reviews. The repository's delivery process additionally calls for independent review and all platform/security checks. Do not bypass any gate or alter protection. Squash merging is available and fits linear history.

## Grok findings and proposed disposition

### 1. Conflicting visual baselines: confirmed integration blocker

The branches contain reviewed images of different partial UIs. A screenshot is a single image; Git cannot combine the new header from one with the toolbar from another. Their individual green checks are valid, but do not establish combined compatibility.

Preserve eight separate PRs and green checks at every landing stage. Refresh each next branch against actual main, resolve source conflicts, then capture and approve any changed baselines for that cumulative UI. Do not merge failing code first and postpone all baselines to the last PR: current visual gates must keep working throughout.

For PNG conflicts, neither side is an approved final answer. An existing side may be retained temporarily only to run capture CI on the updated branch; record it as provisional. Download packaged Windows runner captures and differences from that exact source revision, review every affected pair, and replace only intentional changes. Keep the 14-image matrix and tolerances unchanged. Record source revision/run, Windows environment, Electron version, DPR and review date. Rerun CI before merge. The final #51 state must contain the complete combined matrix; no later branch may overwrite it with an earlier partial state.

### 2. Glass surface coverage: resolve before #50 lands

Source inspection confirms different light/dark surface lists: library/settings are only in the light image override, while dialogs use the generic glass rule. This is a coverage concern; identical selectors alone would not prove correct appearance because nested surfaces can add tint and body-portaled dialogs have different backdrops.

Inspect the combined editor, library, settings, rename and share dialogs in both themes with an active image. Define one intentional surface policy: use the same outer chrome coverage in both themes, with theme-specific opacity/blur; avoid double tint on nested panels. Preserve the requested earlier dark appearance rather than redesigning dark mode to match light. Decide the modal treatment explicitly from readability and actual wallpaper visibility; a more opaque modal is acceptable only as a documented deliberate exception. Record before/after captures and independent acceptance. Put any necessary correction and regression coverage in #50, then propagate it to #51.

Acceptance: the wallpaper is visibly present where intended, text remains readable, portal dialogs are centered and unclipped, no-image/fallback behavior works, native desktop glass stays separate, and canvas/export backgrounds remain unchanged.

### 3. Tooltips: document the original scope

The requested sticky descriptions were the annotation-tool popovers. Keep their hover/click/leave/Escape/keyboard fix. Native titles on View controls, drawing tools and eye/trash controls are intentionally retained for this release; they are not the custom description that was sticking. Record this distinction in #48's description and verification notes. Reproduce a sticky title elsewhere if reported before expanding the shared tooltip component. Do not remove accessible button names.

### 4. Narrating CSS comments: small cleanup

Remove the pre-#33 history narration in #50 and the obvious row-action narration in #46. Retain comments that explain a real constraint, such as avoiding a second wallpaper blur/tint. No new tests solely for comments.

### 5. Orphaned CSS: confirmed cleanup

The combined source has definitions but no renderer references for `.inspector-drawer-close`, `.collection-count`, `.export-state`, `.danger-zone*` and `.canvas-actions`. Recheck all callers and responsive rules before deleting. Remove header leftovers in #44 and collection leftovers in #46; preserve any grouped selector that still applies to live controls. Verify rendered UI and run existing static checks. Do not broaden this into a full stylesheet rewrite.

### 6. Collection heading grid: small correction

Update `.collection-control-heading` from three tracks to two, matching the label and new-collection button in #46. Check narrow widths, long labels and button reachability. Include this with the collection cleanup.

## Execution phases

### A. Prepare and resolve review findings

1. Fetch current refs; record exact heads, current release/channel state, check results and outstanding review conversations. Preserve the dirty original checkout and all unrelated files.
2. Use the existing isolated worktrees. Reuse the local integration branch as a review fixture, but reconcile it with current remote heads before relying on it; it is not the release source.
3. Apply findings 2, 4, 5 and 6 in their owning PR branches. Document finding 3's scope. Run focused checks and obtain independent review for the corrections.
4. Propagate parent corrections to dependent branches using normal commits/merges. No force-push or published-history rewrite. Keep PR descriptions aligned with final behavior.
5. Rehearse the complete source combination locally to expose source/layout problems before starting main merges. Record baseline conflicts separately; local visual evidence does not replace approved runner captures.

### B. Land the eight PRs sequentially

Use the table's order. For each PR:

1. Update its branch with the latest main. After its original parent lands, retarget #46, #47 or #51 to main. Retain parent branches until their children are retargeted and verified.
2. Resolve source conflicts by preserving all previously landed behavior. Check the actual diff against main contains only the intended next outcome and corrections; squash-merged parent history must not cause duplicated changes.
3. Resolve visual conflicts using the reviewed cumulative-capture procedure above. Never treat accepting ours/theirs as final baseline approval.
4. Run affected tests, formatting, lint and type checks. Require full app/script, security and Windows/macOS/Linux package checks on the exact updated candidate. Inspect the visual results and any new failures.
5. Obtain independent acceptance of the final diff and material corrections; resolve review threads with evidence. Recheck head identity and current checks immediately before merging.
6. Squash merge using an expected-head guard, without administrator bypass. Verify the resulting main commit and PR state. Refresh the next branch from that real main state and repeat.

Do not dispatch nightly during partial landing. If a step fails, repair that branch and rerun the relevant checks; do not drag an unresolved failure into subsequent merges.

### C. Accept the combined release candidate

After #51 lands, fetch main and record the full 40-character candidate SHA. Confirm the final diff includes all eight outcomes and no excluded dependency upgrades. Verify the final main candidate and compare the resulting tree with the reviewed final PR, accounting for commit-only squash differences.

- Run the repository's full required quality checks and verify packaged behavior on all three supported OSes.
- Confirm the final 14 Windows captures represent the combined UI and pass strict comparison.
- Inspect compact, laptop and wide layouts; open/collapsed navigation; header save status; adjacent history buttons; row delete targeting and pending saves; immediate working undo; tooltips; full-space previews; drawing/screenshot canvas consistency.
- Cover light/dark, no image, generated and existing character backgrounds, settings/library/editor, portaled dialogs and transparency fallbacks. Verify existing selections persist and exports remain neutral.
- Use synthetic projects and copies of representative legacy fixtures. These UI PRs must not add a new project migration or alter recovery formats.
- Update UI-Improvemnts.md with resolved Grok findings, merged SHAs and actual combined evidence. Any release documentation change to main must land before selecting the final release SHA.

### D. Publish one nightly and verify it

Execution of this phase publishes a prerelease. It is not a dry-run command. Only run it as part of the subsequently authorized execution of this plan.

Dispatch the existing workflow from main with the accepted SHA:

```powershell
gh workflow run nightly.yml --repo Dytschgo/imnota --ref main -f sha=<accepted-40-character-main-sha>
```

The workflow is manual only; normal merges do not publish. It validates an immutable main-history commit, derives the nightly version without a committed package-version bump, and gates publication on quality plus Windows/macOS/Linux packaged verification and strict Windows visuals.

Wait for the entire workflow, including publication. Verify the published tag resolves to the accepted SHA; embedded versions, expected platform assets, all three nightly update manifests and checksums agree. Download public assets and verify their hashes; distinguish checksum verification from an actual install/launch test. Perform available real nightly launch/update checks and disclose any platform acceptance that remains CI-only. Confirm the release is a prerelease and stable Latest/update metadata remain unchanged. Provide the exact nightly link, version and verification results.

### E. Failure and recovery

Before publication, repair and reverify; do not dispatch a known failing candidate. If a merged UI change must be reversed, use a reviewed revert and regenerate affected baselines, without rewriting main. If the new nightly has a post-publication defect, prepare a corrected newer nightly through the same gates; keep previous assets available and avoid silent automatic downgrades. Existing schema compatibility rules still apply when manually returning to an older app.

## Completion checklist

- [x] All six Grok findings have evidence-backed dispositions.
- [ ] #44 through #51 are merged separately with verified cumulative baselines.
- [x] #4 through #8 and #41 remain outside the candidate.
- [ ] Combined exact main candidate has complete quality, package and visual evidence.
- [ ] Nightly publication succeeds and public release/version/assets/manifests are verified.
- [ ] Stable remains unchanged; final nightly link and any real-platform test limits are reported.

## Execution record at final PR preparation

All seven merges below passed their complete cumulative quality, security and platform checks before landing. Parent branches were retained and dependent PRs retargeted without rewriting published history.

| PR  | Main merge commit                          |
| --- | ------------------------------------------ |
| #44 | `4c2b5e23665ef57a172388647c74239d532695d7` |
| #45 | `e3045f1fe977403f363175636f8041430368108e` |
| #46 | `13873690b9b9774bde5af2d2d2df265d52bcb671` |
| #47 | `f0b724952c209f3bc41a2d8dc707696c2ad79627` |
| #48 | `79a02aa8e802e65e284c58e40172db0af0e5d2be` |
| #49 | `0d588b0b4a1a4a1c7c7a81f8c4f7170ad489bd06` |
| #50 | `ab87f730f1063799c6b145f74a7a1e78bc88750e` |
| #51 | Final candidate prepared; merge pending    |

- All six Grok findings have dispositions in [UI-Improvemnts.md](UI-Improvemnts.md). The header and collection cleanup, two-column heading, common outer glass coverage and deliberate modal/tooltip exceptions were independently reviewed.
- Cumulative Windows baseline updates were reviewed against exact packaged runner captures and differences. Strict tolerances and all 14 captures remain unchanged. Source integration preserved the reviewed cumulative images rather than reverting to older partial-UI snapshots.
- The actual rename and sharing components were checked over active wallpaper in both themes, including body portals, viewport bounds and close-to-opener focus. Fixtures used synthetic data without saving or uploading.
- Drawing verification exposed early engine input, selected-tool state and initial canvas geometry problems. PR #49 includes the readiness/selection fixes and bounded native state/layout checkpoints. Real gestures and connector persistence assertions remain intact; there are no gesture retries or skipped gates. The corrected local Windows walkthrough passed all 18 assertion groups.
- Complete candidate `44c3661` matches integration source `373bf15` across application code, assets, dependencies, scripts and workflows. Its [cumulative CI run](https://github.com/Dytschgo/imnota/actions/runs/34297782958) passed quality and all three packaged platforms: 592 application tests in 80 files, 42 script tests and the sharing contract check. The macOS-only script test is skipped in Linux quality and exercised in its platform pipeline.
- Updating #51 to main at `ab87f73` produced the identical reviewed tree before these final documentation edits. Exact final-head checks and subsequent main verification remain required.
- Independent release preflight found no substantive blocker, conditional on final main checks, nightly gates and public-download verification. There are no dependency upgrades, new project migrations or weakened workflows in this candidate.
- Draft #52 appeared during execution. It concerns hosted sharing and remains outside the approved eight-PR plan, alongside excluded dependency PRs #4-#8 and #41.
- Stable Latest was recorded as `v0.2.5`, release ID `384332841`. Recheck after nightly publication. No nightly has been dispatched at this record's preparation point.
