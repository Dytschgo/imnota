# Imnota implementation plan

Updated 2026-09-08 after the published nightly. This is the current delivery status and remaining work; it replaces the earlier prospective phase list. The [original specification at the release commit](https://github.com/Dytschgo/imnota/blob/107fc5920a6e829ec1b8dec10a21ad8a711e0fe8/implementation%20plan.md) remains available for detailed acceptance requirements.

## Released baseline

- Stable: [v0.2.5](https://github.com/Dytschgo/imnota/releases/tag/v0.2.5).
- Nightly: [v0.2.6-nightly.20260907.34169995806](https://github.com/Dytschgo/imnota/releases/tag/v0.2.6-nightly.20260907.34169995806), commit `107fc5920a6e829ec1b8dec10a21ad8a711e0fe8`.
- Nightly [build and publication](https://github.com/Dytschgo/imnota/actions/runs/34169995806) passed Windows, macOS and Linux checks. All 13 public assets, three channel manifests and the release tag were verified. Stable remained Latest.
- Hosted static sharing is deployed at `app.imnota.xyz`; see the [deployment evidence](share-service/docs/deployment-verification.md).

The product remains an open-source, local-first handoff tool. Screenshots, drawings and Markdown text blocks form one ordered collection. Local editing, copy and export require neither an account nor the sharing service. Hosted sharing is an explicit upload of finalized artifacts, with expiry and revocation; it is not project synchronization or an AI integration.

## Completed implementation

| Area from the original plan          | Current behavior and evidence                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collections and migration            | Schema 3 collection workflow; schema 4 adds drawings/text while preserving screenshot identity. Ordered items, archive/restore, include/exclude and legacy migration have persistence and native coverage.                                                |
| Screenshot and annotation workflow   | Import/paste/drop, canvas tools, text references, pan/zoom, expanded bounds, crop and opaque redaction. Native checks inspect exported pixels and clipboard representations.                                                                              |
| Inspector and deletion               | Description and priority; responsive inspector drawer with focus handling; deletion preference, OS trash and local Undo. Async deletion captures the intended item before pending saves.                                                                  |
| Prompt bundles                       | Current-collection PNG/Markdown pairs, automatic splitting, readable numbering, previews, fresh timestamped exports, progress/cancel and separate clipboard/file fallbacks.                                                                               |
| Onboarding, appearance and shortcuts | Replayable sample workflow, light/dark/system themes, optional glass, configurable shortcuts and persistence.                                                                                                                                             |
| Application boundaries               | Typed bridge and domain helpers; dedicated persistence, shortcuts, canvas, export and settings modules. Annotation/drawing code loads separately from the main shell. Further extraction needs a concrete maintenance benefit.                            |
| Reliability                          | Transaction journals, recovery, external-change watching, stale-revision checks, conflict preservation and recoverable deletion across mixed content.                                                                                                     |
| Drawings and text                    | Local Excalidraw editor, editable drawing JSON with PNG output, Markdown source/preview, mixed ordering, duplicate, include/exclude, autosave and delete/Undo. Full arbitrary `.excalidraw` interchange is a separate proposal.                           |
| Hosted sharing                       | Reviewed artifact manifest, one-use browser pairing, bounded native upload, local history and receipt recovery, expiring/revocable links, sanitized previews and downloads. Private server storage, quota enforcement and scheduled cleanup are deployed. |
| Release verification                 | Unit/security/contract tests, three-platform package and native checks, 14 approved Windows visual comparisons and an isolated 100-image/dense-annotation stress workflow. Nightly publication preserves stable metadata.                                 |

The former plan's ban on all server work was superseded by its later hosted-static-sharing requirement. Cloud sync, collaboration and runtime AI calls remain outside the product boundary.

## Remaining acceptance and operational work

These are open verification or operating tasks, not claims that the implementation is absent.

1. **Recipient and clipboard checks.** Manually exercise the hosted recipient page in a private browser and test actual paste into the target coding editors on Windows, macOS and Linux. Record exact versions, image/Markdown results and fallbacks. Automated HTTP and Electron clipboard checks do not establish receiving-app behavior. Follow the [clipboard matrix](docs/clipboard-images-plan.md).
2. **Representative performance.** Profile photographic/high-entropy screenshots, mixed collections and long-running sessions. The synthetic 100-image and 200-note checks pass, but dense export uses roughly 1 GB of renderer working set on the measured Windows machine. Establish budgets before changing decode concurrency, row rendering or export scheduling.
3. **Sharing operations.** Exercise the documented off-host backup/restore procedure with paired metadata and artifacts. Daily metadata backups and cleanup exist; unattended off-host backups and provider access-log retention controls are not claimed. Preserve the receipt secret with recoverable backups.
4. **User feedback.** Run the prepared, consented developer/QA sessions and prioritize repeated workflow blockers. No participants have been contacted and no telemetry has been added.
5. **Platform rollout.** Broaden clean-machine install/update testing. Apple notarisation and broader Linux distribution compatibility remain separate release work; passing CI does not imply either.

## Future product proposals

The [product roadmap](docs/product-roadmap.md) consolidates still-relevant proposals: measured scale improvements, clipboard compatibility, local history, broader search, export presets/templates, screen capture, PDF export, Markdown controls and full Excalidraw interchange. They are proposals for separate scoped work, not features included in this nightly or authorized for implementation by this cleanup.

## Maintenance and review

Post-nightly source maintenance restores save-before-close protection after failed updates and prevents duplicate collection actions during pending saves. These changes follow the published baseline above; they do not alter its binaries. The repository review records their regression coverage and any subsequent fixes.

Use [the current repository review](docs/repository-review-2026-09-08.md) for the disposition of older plans and open dependency PRs. Version-only major dependency changes must demonstrate application startup and the affected workflows before merge; green compilation alone is insufficient.

For each subsequent change, preserve user work, use an isolated branch, verify meaningful behavior, obtain independent review where risk warrants it and pass the applicable CI checks. Merge through the normal PR process. A merge alone does not publish a new nightly or promote stable.
