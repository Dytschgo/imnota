# Recovery unification plan

Status: plan only. Do not implement in this change.

Screenshot saves, mixed-content delete/Undo, and local history currently work, but they are three similar systems. The goal is one user-visible recovery model so screenshots, drawings, and text are handled the same way.

## What exists today

| Path                                             | Owns                                            | User-visible outcome                                     |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------- |
| Screenshot transactions (`.imnota-transactions`) | Multi-file screenshot saves and reopen recovery | Restore interrupted edits or keep the last saved project |
| Content trash (`.imnota-content-undo`)           | Drawing and text delete/Undo                    | Move to OS trash, Undo from the in-app notice            |
| Screenshot trash (`.imnota-undo`)                | Screenshot delete/Undo                          | Same idea as content trash, separate journal             |
| Local history                                    | Project snapshots and restore                   | Restore as new project or in place with a safety copy    |

Each path validates files, rejects traversal, and keeps a journal. The contracts differ: commit points, token formats, which files are in scope, and how the renderer is told to reload.

## Desired user model

One vocabulary for every content type:

- **Save** is atomic. A crash leaves either the previous version or the new version, never a half-written drawing or screenshot.
- **Delete** moves files to the OS trash and keeps an Imnota Undo grant.
- **Undo** restores the same item identity, files, and collection position.
- **Restore** from history is a separate, explicit project-level action. It is not keystroke history.

Screenshots, drawings, and text should not show different confirmation, toast, or failure copy for the same action.

## Recommended sequence

1. Write a shared recovery vocabulary (grant, journal phase, safety copy, committed vs rolled back) without merging storage yet.
2. Make delete/Undo for screenshots, drawings, and text use the same renderer flow: one in-app confirmation, one toast, one Undo action.
3. Compare screenshot-transaction and content-save journals. Extract a shared commit helper only after the contracts match on baseline, conflict copies, and reopen.
4. Keep local history as project-level restore. Do not fold it into per-item Undo.
5. Add one native smoke: edit all three types, kill mid-save, reopen, delete each type, Undo, then restore a snapshot if history is present.

## Out of scope until the contracts match

- A fourth journal for capture, sharing, or PDF
- Cloud backup
- Rewriting `project.json` through a generic sync adapter

## Acceptance

A reviewer can describe delete, Undo, crash-save, and project restore once, and the same description is true for screenshots, drawings, and text.
