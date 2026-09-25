# Capture display verification

Record the exact executable revision, OS, display bounds/scales, entry point, pointer and overlay display, output dimensions, and observed crop alignment. Synthetic smoke and a source-capability probe do not prove that a user's selection matches saved pixels.

## Direct selection contract

Starting a screenshot must open selection overlays on every connected display without a monitor chooser. Verify toolbar, Add menu, focused shortcut, background shortcut, delayed capture, and tray entry points. A region may lie on either display or span their boundary. Saving and repeating it must preserve that rectangle and its pixels; cancelling must close every overlay without writing files. A missing capture source or changed display layout must fail explicitly rather than omit a monitor or silently move the selection.

[PR #84](https://github.com/Dytschgo/imnota/pull/84) introduced direct multi-display selection. [PR #89](https://github.com/Dytschgo/imnota/pull/89) reinstated the chooser and removed its cross-display smoke coverage. Preserve the direct-selection postcondition in renderer and native regression checks when changing capture entry points; a passing check that requires the chooser contradicts this contract.

Keep evidence levels separate: coordinate/composition unit tests, synthetic overlay IPC, OS mouse input over synthetic display images, and real source capture. A cross-display IPC call alone cannot verify native pointer capture across window or scale boundaries. Equal-scale hardware evidence does not establish mixed-DPI behavior.

## Available evidence — 2026-09-22

Windows build 26200; unpackaged Electron application reporting Imnota 0.2.8, compiled from `65d44c1` (export optimization, capture unchanged from `a3f576e`). `IMNOTA_SMOKE_CAPTURE_CAPABILITY=real-memory-only` with the existing native runner passed. No desktop pixels were persisted.

| Reported display | Bounds in DIP       | Scale | Captured source | Requested crop in DIP | Decoded crop |
| ---------------- | ------------------- | ----- | --------------- | --------------------- | ------------ |
| 3472346605       | x=0, y=0, 1920×1080 | 100%  | 1920×1080       | x=1, y=1, 240×160     | 240×160      |

The probe confirmed exact display-source identity and in-memory crop dimensions on the one display exposed to this session. It did not open the region overlay, press a physical shortcut, save a region selection, or verify visual alignment. This is development evidence, not acceptance of a published nightly.

## Remaining manual matrix

| Configuration                                                 | Entry points                                                  | Status                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Windows, one display, 100%                                    | Toolbar, focused shortcut, background shortcut, repeat region | Real source/crop dimensions verified; overlay alignment unverified     |
| Windows, two displays, equal scale, including negative origin | Same, pointer on each display                                 | Hardware unavailable in this session                                   |
| Windows, mixed 100%/150%/200% scales                          | Same, pointer crossing display boundaries                     | Hardware unavailable in this session                                   |
| macOS, Retina and external display                            | Same, permission denial/recovery, Control+Shift+5             | Hardware unavailable in this session; packaged CI is separate evidence |

Use a synthetic scene with visible corner markers, select a known rectangle, and compare the saved pixels and dimensions to that selection. Repeat from another foreground app and after tray/window transitions. Record the exact candidate rather than carrying a result forward to another build. Keep unrelated desktop content out of committed artifacts.

The existing probe can be rerun from PowerShell after building the intended revision:

```powershell
$env:IMNOTA_SMOKE_CAPTURE_CAPABILITY = 'real-memory-only'
node --input-type=module -e 'import {runNativeVerification} from "./scripts/smoke-process.mjs"; console.log(JSON.stringify(await runNativeVerification(), null, 2));'
Remove-Item Env:IMNOTA_SMOKE_CAPTURE_CAPABILITY
```

See [clipboard receivers](clipboard-receiver-matrix.md) for paste acceptance and [release readiness](release-readiness.md) for candidate gates.
