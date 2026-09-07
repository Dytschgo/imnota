# Native visual regression

`pnpm test:visual BASELINE_DIR CAPTURE_DIR DIFF_DIR` compares captured PNG pixels with an approved baseline. Missing files, mismatched dimensions and unexpected platform baselines fail the check. A failed comparison writes a highlighted difference image; tests never update approved images.

Capture the application with the isolated native runner after building:

```powershell
$env:IMNOTA_SMOKE_ARTIFACT_DIR = 'D:/Code/imnota-verification-artifacts-candidate'
corepack pnpm smoke
corepack pnpm test:visual tests/visual/win32 $env:IMNOTA_SMOKE_ARTIFACT_DIR D:/Code/imnota-visual-differences
```

The capture directory must be new and empty. The runner creates a disposable profile and synthetic projects. Never use a real workspace for baseline capture. Window size and device pixel ratio must match the approved environment; different operating systems require their own reviewed baselines.

Each baseline directory contains `manifest.json` with `platform`, an explicit `captures` filename list, and optional `tolerance` (`channelTolerance`, default 16; `maxChangedRatio`, default 0.001). The tolerance permits small rasterization differences, not layout changes. Review every changed capture and difference image before replacing a baseline. Record the source commit, Electron version, operating system, device pixel ratio and review date in the manifest.

The comparison engine is tested against identical images, bounded noise, a removed control and changed dimensions. Native screenshots complement interaction and accessibility assertions; an image match alone does not establish working controls, correct persistence or clipboard compatibility.
