# Imnota product roadmap

Reviewed 2026-09-08 against the published mixed-content and hosted-sharing nightly. This consolidates the earlier local roadmap draft. The [implementation plan](../implementation%20plan.md) is the source of current delivery status; future items below need their own scope and acceptance decision.

This roadmap builds on the existing local-first workflow:

```text
Capture or import evidence -> explain it -> arrange context -> export a portable handoff
```

The roadmap is ordered by user value and implementation risk. The mixed-content model is the foundation for the items below.

## Now: validate the shipped foundation

### 1. Broaden mixed-content acceptance

Screenshots, Markdown text blocks and drawings are implemented in one ordered collection, with migration, autosave, reorder, duplicate, delete/Undo and export coverage. The README, user guide and data-format docs now describe schema 4. Before adding more types, broaden real-workload verification:

- exercise keyboard and empty-state workflows with realistic mixed sequences;
- verify malformed-content recovery and external edits against representative project copies;
- retain regression coverage for ordered Markdown, PNG and editable drawing source exports;
- manually verify the recipient and target-editor workflows in the current implementation plan.

Acceptance: a project containing text -> drawing -> screenshot -> text survives close/reopen, reorder, hide, duplicate, delete/Undo and export without losing identity or order.

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

### 4. Clipboard compatibility

Keep the combined copy action, but make the fallback path explicit and dependable:

- Copy Markdown only;
- Copy image only;
- Copy both as files when supported;
- open the export folder;
- copy the generated file paths.

Build a compatibility matrix for common coding editors and browsers on Windows, macOS and Linux. The UI should explain what was copied and offer the next best action when a target rejects a clipboard representation.

### 5. Local backup and version history

Add an opt-in local history for project metadata and content files. A history entry should be atomic, inspectable and restorable without a server.

Proposed first version:

- automatic snapshots before migrations and destructive project-wide operations;
- a manual “Create snapshot” action;
- retention by count and age;
- restore to a new project or restore in place with a confirmation;
- a visible backup location and an exportable archive;
- no silent deletion of the user’s original files.

Acceptance: a user can recover a previous mixed-content project after an accidental edit, failed migration or corrupted content file.

## Later: workflow acceleration

### 6. Search across all content

Project search already includes stored context. Extend it to item-level results across collection names, screenshot titles/descriptions, full text-block Markdown, drawing titles and annotation text where useful. Results should identify the collection, item type and match location, then focus the item without changing its order.

Start with an in-memory index built from local files. Add an on-disk index only if measured project sizes make it necessary.

### 7. Export presets

Replace the single default export preference with named local presets. A preset may control included content, annotation metadata, original-image inclusion, Markdown structure and image quality. Presets must be versioned and portable, with a clear fallback when a future setting is unknown.

Do not add arbitrary template scripting in the first version.

### 8. Workflow templates

Offer local templates for common handoffs:

- bug report;
- UI review;
- feature request;
- design-to-code brief;
- architecture handoff.

A template should create a collection structure and text prompts, not lock users into a cloud service or AI provider. Users should be able to edit and duplicate templates.

## Later: capture and interchange

### 9. Built-in screen capture

Add capture only after the import workflow is validated. The first version should be deliberately narrow:

- rectangular region capture;
- window capture where supported;
- delayed capture and repeat-last-region;
- privacy-conscious confirmation before saving;
- direct insertion into the active collection;
- platform-specific permission and failure states.

Avoid building a full recording, OCR or image-editing suite. Preserve the original capture and use the existing annotation tools.

### 10. PDF export

PDF should be a presentation/export format, not the canonical project format. Define a stable print layout first:

- collection title and context;
- ordered text, drawing and screenshot items;
- readable pagination and image scaling;
- annotation and exclusion treatment;
- selectable Markdown text where possible;
- deterministic filenames and export metadata.

Test fonts, long text, large images, page breaks and redaction privacy on all supported desktop platforms. Keep PDF export separate from prompt-bundle export so each format can optimise for its recipient.

### 11. Rich Markdown formatting controls

Add lightweight controls only where they reduce Markdown friction. The source Markdown remains authoritative.

Candidate controls:

- heading level;
- bold, italic, inline code and links;
- bulleted and numbered lists;
- quote and code block;
- insert screenshot/drawing reference.

Do not turn text blocks into a rich-text proprietary format. Provide a Markdown source/preview toggle, keyboard shortcuts, sanitised preview and a plain-text escape hatch.

### 12. Full Excalidraw compatibility

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
