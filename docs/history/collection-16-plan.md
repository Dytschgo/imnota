# ImnotaDev / Collection 16

Status: implemented for PR review on `fix/collection-16`, based on `main` at `6873cc4`.

Priority: Medium for all six reports.

Export set: ImnotaDev - Collection 16 - 260909-091117

Bundle reference: ImnotaDev - Collection 16 - 260909-091117 - 01

Bundle: 1 of 1

## Scope and source alignment

Preserve the current interface design while fixing dialog surfaces, making annotation tools respond to available width, and removing duplicate deletion confirmations.

Initial planning used the older `feature/mixed-content-implementation` checkout. Implementation uses current `main`, which contains all pictured workflows. The shared `modal.css` action row forced an opaque `--surface-2` background over translucent dialogs; the toolbar used a fixed six/nine tool split; and `content:delete` repeated the renderer confirmation in a native dialog. Existing local work in the original checkout was preserved.

## Completed changes

- Pictures 1, 2, 5: modal actions now share the dialog surface. They scroll with form content instead of covering it with a sticky transparent overlay. Action-only confirmations use the same horizontal inset as forms.
- Picture 3: removed the Settings "Local workspace" eyebrow.
- Picture 4: measure the actual toolbar and reserved control widths; show tools inline in stable order as space permits. Overflow retains grouped menus and keyboard navigation; focus follows a tool when resizing, and More stays within the viewport. View actions remain accessible in narrow layouts.
- Picture 6: the renderer owns the confirmation preference. Removed the duplicate native warning while preserving project confinement, item validation, trash transactions, error propagation, and Undo.

## Verification record

Windows local checks passed:

- Lint, both TypeScript configurations, production build, and touched-file formatting.
- Full application suite: 80 files, 596 tests. Script suite: 42 passed, one macOS-only test skipped.
- Electron smoke workflow: 18 assertion groups, including text and drawing delete/Undo with confirmation enabled and the smoke bypass temporarily disabled. An unexpected native warning fails this exercise immediately.
- Independent review found no blocking issue and confirmed that deletion still validates the project and item before touching files.
- Electron component captures at widths 320, 480, 680, 820, and 1040 with and without the palette: tools expand/collapse without horizontal overflow; More stays inside the viewport. Dialog captures cover rename, revoke, and screenshot deletion in light/dark modes with glass off/strong. The real app Settings capture confirms the removed label.

The dialog captures use the production Modal and form controls with synthetic content; hosted-link confirm/cancel behavior is covered by the existing sharing tests. No live hosted link was revoked. macOS native verification and PR CI remain pending; Windows evidence does not establish the macOS result. The production build emits the existing large-chunk advisory.

The original implementation brief and acceptance criteria follow. References to "this checkout" below describe the initial planning checkout.

## Implementation sequence

### 1. Unify dialog surfaces — Pictures 1, 2 and 5

- Reproduce Revoke link from bundle sharing, Rename collection, and Delete screenshot on the matching UI revision.
- Trace the footer background through the shared dialog component, theme rules, and any broad footer/action selectors.
- Make action rows use the same surface as the surrounding dialog, removing the contrasting grey rectangle. Keep consistent padding, button alignment, rounded clipping, and existing destructive-button styling.
- Apply the correction in the shared primitive or scoped stylesheet; avoid three independent visual patches.
- Starting points in this checkout: `src/renderer/components/ui.tsx`, `src/renderer/styles.css`, and `src/renderer/collection/CollectionRail.tsx`. Locate the sharing and screenshot confirmation implementations on the matching revision.

Acceptance: all three dialogs have a continuous surface with no inset grey block; inputs, focus rings, loading/error states, and buttons remain legible in supported themes and glass settings. Cancel, Escape, focus return, and confirmation behavior still work.

### 2. Remove the Settings eyebrow — Picture 3

- Remove only the highlighted “LOCAL WORKSPACE” label above Settings wherever it remains on the target revision.
- Keep the Settings title and explanatory paragraph, with no empty gap left by the removed label.
- `src/renderer/settings/SettingsView.tsx` already satisfies the text-removal requirement in this checkout; verify the rendered target before making any edit.

Acceptance: the label is absent and the heading spacing remains intentional.

### 3. Make the annotation toolbar use its available space — Picture 4

- Update `src/renderer/components/Toolbar.tsx` and `annotation-tools.css`. The current implementation permanently splits six primary tools from nine tools in More.
- Observe the toolbar container width, including changes caused by resizing side panels, rather than relying solely on viewport breakpoints.
- Reserve space for palette, history, view controls, separators, and an overflow trigger when needed. Show additional tools inline in a stable order as space becomes available; place only the remaining tools in More. Hide More when every tool fits.
- Keep comfortable button sizes. At very narrow widths, use a deliberate wrap/compact layout that leaves every tool and view action reachable.
- Preserve selected-tool visibility or a clear active indication on More, tooltips, shortcuts, menu dismissal, and keyboard focus when a tool moves into overflow. Avoid resize oscillation and clipped popovers.

Acceptance: wide layouts expose additional tools instead of leaving usable space beside a fixed More menu; narrowing the actual container moves tools into overflow without overlap, clipping, or loss of selection. Test with the palette present/absent and panels expanded/collapsed.

### 4. Keep one deletion confirmation — Picture 6

- Trace every text-block and drawing deletion entry point on the target revision. Keep the existing in-app confirmation as the sole warning and ensure cancellation makes no deletion request.
- Remove the redundant native `dialog.showMessageBox` in the `content:delete` handler in `electron/main.ts` after verifying that the renderer provides the intended confirmation. This checkout's renderer confirmation must be checked rather than assumed from the screenshot.
- Keep project-path and content-membership validation, persistence serialization, trash behavior, undo, and error reporting intact. Align confirmation preferences with the existing in-app policy.
- Inspect `electron/content-persistence.ts`, `electron/content-trash.ts`, and renderer content actions for affected behavior.

Acceptance: deleting either content type shows one in-app warning and no second OS warning; Cancel retains the item; confirmation deletes once; Undo restores it. Test the real Electron path without the smoke flag that currently bypasses the native dialog, including macOS verification for the reported Apple popup.

## Verification and completion

1. Add focused behavior coverage for toolbar overflow/resizing and deletion confirmation/cancel/undo. Extend existing toolbar, app, and content-persistence tests where appropriate; avoid tests that merely assert CSS declarations.
2. Visually inspect the three dialogs and Settings across supported themes, plus the toolbar at narrow, medium, and wide container widths and increased UI zoom.
3. Exercise rename, screenshot deletion/undo, hosted-link revocation, and text/drawing deletion on disposable test data. Check busy/error behavior and prevent duplicate submissions.
4. Run relevant tests, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Record any pre-existing failures separately.
5. Record the target revision, completed checks, and any platform verification still outstanding. Do not claim the macOS duplicate-popup issue verified from browser-only or smoke-bypassed testing.

Implementation is complete when all six reports meet their acceptance criteria. Publishing and release packaging are outside this plan.
