# Imnota product roadmap

Release baseline: v0.3.0 stable, published 2026-09-26. The item-level status below was last reconciled against main `a3f576e` on 2026-09-22; linked follow-up PRs are not claims of a published release. The [implementation status](implementation-plan.md) is the source of current delivery status; future items below need their own scope and acceptance decision.

This roadmap builds on the existing local-first workflow:

```text
Capture or import evidence -> explain it -> arrange context -> export a portable handoff
```

The roadmap is ordered by user value and implementation risk. The mixed-content model and the shipped capture workflow are the foundation for the items below. Capture validation remains an acceptance task, not an unimplemented feature.

## Now: validate the shipped foundation

### Approved scope: optional local agent access

The September 21 PR review and nightly request includes the optional local MCP interface in PR #104. Its scope is read-only access to the selected local workspace and already prepared bundles, enabled explicitly in Settings. It adds no hosted model calls, account, upload, telemetry, capture command, or editor configuration changes. Browser-origin and non-loopback requests are rejected; workspace containment, links, recovery files and sharing secrets remain guarded. A busy port must leave access disabled with an actionable error. Users can turn access off to close the listener; existing workspace files and exports remain unchanged.

External agent skill installation is outside this delivery. The app does not insert installation instructions into exported prompts. Acceptance requires independent security review, real loopback failure/recovery tests and the existing supported-platform package checks.

### 1. Broaden mixed-content acceptance

Screenshots, Markdown text blocks and drawings are implemented in one ordered collection, with migration, autosave, reorder, duplicate, delete/Undo and export coverage. The README, user guide and data-format docs now describe schema 4. Before adding more types, broaden real-workload verification:

- exercise keyboard and empty-state workflows with realistic mixed sequences;
- verify malformed-content recovery and external edits against representative project copies;
- retain regression coverage for ordered Markdown, PNG and editable drawing source exports;
- manually verify the recipient and target-editor workflows in the current implementation plan.

Acceptance: a project containing text -> drawing -> screenshot -> text survives close/reopen, reorder, hide, duplicate, delete/Undo and export without losing identity or order.

### Decision: on-device OCR stays export-scoped

Copy Bundle includes recognised text when enabled and the operating system provides a local OCR engine. Recognition runs only while creating that Markdown, reads only the pixels being exported, and does not persist recognised text in the project. Unsupported platforms, redacted screenshots, failures and the export-wide time budget simply omit the section while the export still succeeds. This is not a commitment to an OCR suite, background indexing, cloud recognition or a new product surface.

### 2. Validate the existing import-to-copy workflow

Run 5-8 moderated sessions with people who regularly give visual feedback to developers or coding agents. Use disposable projects and real, anonymised examples.

Measure:

- time from launch to first successful copied prompt;
- import, annotation and export errors;
- hesitation around collection order, visibility and prompt splitting;
- whether the receiving coding tool accepts the copied Markdown and image;
- which missing feature would have prevented completion.

Do not add telemetry by default. Record consented observations manually, group findings by frequency and severity, and fix repeated blockers before expanding the product surface.

## Next: reliability and scale

### 3. Large-collection performance

Investigate the current high memory and export times before promising support for very large projects. Work in this order:

1. profile import, thumbnail decode, canvas rendering and export separately;
2. virtualise collection rows and bound concurrent image decoding;
3. move expensive export work out of the interactive renderer where practical;
4. reduce duplicate bitmap retention and split large bundles incrementally;
5. add fixtures containing photographic, high-resolution and mixed-content projects;
6. exercise the existing progress, cancellation and retry states under those workloads.

Acceptance: documented budgets for import, reload, export time and peak memory on representative 1, 10, 50 and 100-item projects.

The first measured follow-up is [PR #116](https://github.com/Dytschgo/imnota/pull/116), which reuses composed prompt outputs within a fixed per-export budget. Windows synthetic before/after evidence shows lower render times and renderer working set in that run; photographic fixtures and native 50-item budgets remain open.

### 4. Clipboard compatibility

Keep the combined copy action, but make the fallback path explicit and dependable:

- Copy Markdown only;
- Copy image only;
- Copy both as files when supported;
- open the export folder;
- copy the generated file paths.

Build a compatibility matrix for common coding editors and browsers on Windows, macOS and Linux. The UI should explain what was copied and offer the next best action when a target rejects a clipboard representation.

### 5. Verify local backup and version history

Local snapshots, retention, inspection, restore, and archive export are implemented; see [Backups and history](user-guide.md#local-backup-and-version-history). The next work is failure/recovery evidence across mixed content and supported operating systems, not a new storage framework. Preserve byte-exact content and unrelated files through failed writes, rollback, reopen, and retry.

The September 22 recovery follow-up is [PR #115](https://github.com/Dytschgo/imnota/pull/115): completed content Undo must retry journal cleanup without blocking reopen or replaying stale content over later edits. Its status is independent of release publication.

## Later: workflow acceleration

### 6. Search across all content

Saved-text search across projects, collections, screenshots, annotations, Markdown and drawings is implemented, including navigation to the matching item. The user guide documents limits and partial-result reporting. Measure large-workspace latency and completeness before proposing an on-disk index; screenshot-pixel OCR indexing is separate from export-scoped OCR.

### 7. Export presets

The first scoped implementation is [PR #117](https://github.com/Dytschgo/imnota/pull/117): named device-local presets for the existing copy format and recognised-text option. Applying one saves both options together. Presets do not yet change image quality, original-image inclusion, annotation metadata or Markdown structure. Portable preset files and their version/fallback contract remain future work requiring separate scope.

Do not add arbitrary template scripting in the first version.

### 8. Refine workflow templates

The shipped local templates cover common handoffs:

- bug report;
- UI review;
- feature request;
- design-to-code brief;
- architecture handoff.

Future work may refine these templates from observed feedback. They create local collections and text prompts, do not lock users into a cloud service or AI provider, and remain editable after creation.

## Later: export and interchange

### 9. PDF export

PDF should be a presentation/export format, not the canonical project format. Define a stable print layout first:

- collection title and context;
- ordered text, drawing and screenshot items;
- readable pagination and image scaling;
- annotation and exclusion treatment;
- selectable Markdown text where possible;
- deterministic filenames and export metadata.

Test fonts, long text, large images, page breaks and redaction privacy on all supported desktop platforms. Keep PDF export separate from prompt-bundle export so each format can optimise for its recipient.

### 10. Rich Markdown formatting controls

Add lightweight controls only where they reduce Markdown friction. The source Markdown remains authoritative.

Candidate controls:

- heading level;
- bold, italic, inline code and links;
- bulleted and numbered lists;
- quote and code block;
- insert screenshot/drawing reference.

Do not turn text blocks into a rich-text proprietary format. Provide a Markdown source/preview toggle, keyboard shortcuts, sanitised preview and a plain-text escape hatch.

### 11. Full Excalidraw compatibility

The current drawing editor uses Excalidraw technology and an Excalidraw-compatible direction, but the first version intentionally restricts tools and source data. Full compatibility is a separate milestone:

- preserve unknown elements, app state and files without lossy rewriting;
- import `.excalidraw` files with validation and safe size limits;
- export `.excalidraw` files with a documented fidelity guarantee;
- support the required element types, bindings, groups, frames, libraries and text behaviour;
- retain a stable rendered PNG for prompt export;
- add round-trip fixtures against files created by current Excalidraw releases.

Do not claim full compatibility until import -> edit -> export round trips preserve supported content and unknown data according to the published contract.

## Explicitly not planned in this roadmap

Cloud sync, team accounts, real-time collaboration, hosted AI integrations, telemetry by default, monetisation, mobile layouts and two-way Markdown synchronisation remain outside this roadmap. They require separate product decisions and would change Imnota’s local-first boundary.
