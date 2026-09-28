# Recovery unification design

Status: design for review, drafted 2026-09-26. It refines the [recovery unification plan](recovery-unification-plan.md). No code changes until this design is approved. Each implementation slice below is a separate PR that needs independent review, as required for persistence and recovery changes in [AGENTS.md](../AGENTS.md#scope-and-safety).

## What the code does today

| Concern                  | Screenshots                                                                 | Text blocks and drawings                                                                 |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Multi-file save          | `screenshot-transactions.ts`, `.imnota-transactions`, `txn-` tokens         | The same journal, through `screenshot-transaction-adapter.ts`                            |
| Delete and Undo          | `screenshot-trash.ts`, `.imnota-undo`, `delete-` tokens, manifest version 2 | `content-trash.ts`, `.imnota-content-undo`, `content-delete-` tokens, manifest version 1 |
| Recovery on open         | `recoverScreenshotTrashTransactions`                                        | `recoverContentTrashTransactions`                                                        |
| Renderer delete and Undo | `deleteScreenshotNow` and `undoDeletedScreenshot` in `App.tsx`              | The content delete handler and `undoContent` in `App.tsx`                                |
| Project restore          | Local history (`backup-service.ts`)                                         | Local history                                                                            |

**Saves are already unified.** Text and drawing saves commit through the screenshot transaction journal. The remaining work for saves is naming, not behaviour.

**Delete and Undo are duplicated.** The two trash modules (about 1,800 lines together) share the same phases (`prepared → trashing → deleted → undoing → restored`), the same byte records (present, size, SHA-256 and blob), the same content backups, and the same `metadataBefore`, `metadataDeleted`, `undoBefore` and `undoAfter` checkpoints. They differ only in:

- the journal directory and token prefix;
- the manifest version and item field (`screenshot` or `item`);
- the error class;
- how the item is removed from, and reinserted into, `project.json`.

**Local history stays separate.** It is an explicit, project-level restore, not per-item Undo.

## Decisions this design asks for

1. **No on-disk format change.** New deletes keep writing today's directories, token prefixes and manifest versions, and recovery keeps reading both. Reverting any slice is then safe, and v0.3.0 can still recover journals written by newer builds. A single journal format stays out of scope until there is a reason beyond tidiness.
2. **One user-facing delete and Undo flow.** Screenshots, text blocks and drawings use the same confirmation, toast wording, Undo action and failure messages. The text and drawing wording changes to match screenshots.

## Target structure

- `electron/item-trash.ts`: one engine for delete, Undo and recovery. It owns phases, byte records, backups, manifest validation, checkpoint writes and cleanup.
- An **item adapter** per kind supplies:
  - the journal directory, token prefix and manifest version;
  - the manifest item field and validator;
  - `removeFromProject(project, id)` and `insertIntoProject(project, record, token)`;
  - the item's relative file paths;
  - the error type to throw, so existing IPC error codes and messages stay stable.
- `screenshot-trash.ts` and `content-trash.ts` become thin adapters that keep their current exported functions, so IPC handlers and callers do not change in the extraction slice.
- The renderer gets one `useItemDeletion` flow that calls the existing IPC channels (`screenshots:delete` or `content:delete`, and their Undo counterparts) by item kind.

## Failure behaviour contract

The refactor must not change any recovery outcome. Before any production code moves, slice 1 records the current outcome of both implementations for every interruption point, as executable tests:

- a failure injected before, during and after each phase write (`prepared`, `trashing`, `deleted`, `undoing`, `restored`);
- a failure injected at each content backup write, `project.json` write and OS-trash move;
- reopening through a fresh service after each failure;
- external edits to `project.json` between delete and Undo, and between an Undo failure and reopen;
- foreign-project, malformed, reused-blob and unknown journal entries;
- a cleanup failure after a committed delete or Undo.

For each case the test asserts:

- the recovery status (`baseline-restored`, `deletion-committed` or `undo-committed`);
- whether Undo is still available;
- the resulting item order in `project.json`;
- byte-exact item files;
- which journal files remain.

If screenshots and content currently produce **different** outcomes for the same case, the slice 1 PR lists the difference and it is decided explicitly: the safer outcome wins, and nothing is guessed. The ambiguous `undoing` state described in the September 22 notes stays preserved and unresolved.

## Implementation slices

1. **Characterization tests (tests only).** A table-driven matrix runs the contract above against both trash modules on real temporary directories. There are no production changes. Run it on Windows, macOS and Linux, because it exercises real filesystem behaviour.
2. **One renderer flow (UI only).** Add `useItemDeletion`, align the wording, and share one toast and Undo path. Persistence is unchanged. Verification: App tests, the affected UI screenshots, and a native smoke of delete and Undo for each kind.
3. **Engine extraction.** Add `item-trash.ts` and turn both trash modules into adapters. Directories, formats and exported APIs are unchanged. Acceptance: the slice 1 matrix and all existing trash, mixed-content and backup tests pass unchanged. Verification: the platform tier on all three operating systems, plus the packaged smoke. Needs independent review.
4. **Naming.** Rename `screenshot-transactions` to `file-transactions` in code only; the `.imnota-transactions` directory keeps its name. This is a mechanical move.
5. **Native walkthrough.** In the isolated smoke profile, edit all three kinds, interrupt a save through the existing failure seam, reopen, delete each kind, Undo, then restore a local-history snapshot.

Slices 1, 2 and 4 are independent. Slice 3 depends on slice 1.

## Rollout and rollback

- Ship each slice to nightly first. Promote to stable only after at least one nightly cycle with no new recovery or persistence diagnostics.
- Because formats do not change, rolling back is a plain revert of the slice. Journals written by any build stay readable by every other build.
- Recovery never deletes unrecognised journal content. As today, it reports a warning and preserves the content.

## Out of scope

- Merging local history into per-item Undo.
- A new journal for capture, sharing, clips or PDF.
- Migrating existing journals to a single format.
- Cloud backup.

## Acceptance

A reviewer can describe delete, Undo, interrupted save and project restore once, and the description is true for screenshots, text blocks and drawings. The slice 1 matrix is the evidence.
