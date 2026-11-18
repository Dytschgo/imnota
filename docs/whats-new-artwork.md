# What's New artwork

The three 0.4.0 illustrations were generated on 2026-09-29 with the built-in image-generation tool, one generation per asset. They are bundled local artwork; Imnota makes no image-generation calls. The original PNGs were copied without editing and inspected for composition, palette and absence of text or logos.

| Asset in `src/renderer/assets/` | Subject                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `whats-new-040-capture.png`     | A violet timer beside a framed image, illustrating capture delay.               |
| `whats-new-040-files.png`       | Separate written-note and image sheets above a tray, illustrating file copy.    |
| `whats-new-040-workspace.png`   | An orderly card tray, toggle and pencil, illustrating workspace simplification. |

The prompt direction was a minimal landscape still life in matte paper and ceramic, with an off-white background, violet accent, sage hills and a small coral sun. Each prompt required legibility at the card's 200 × 124 px display size, soft studio light, and no words, logos, watermarks or fabricated app UI.

These are decorative illustrations, not screenshots or proof of receiving-app behavior. Feature descriptions and actions remain accessible HTML. `WhatsNew.tsx` gives decorative images an empty alternative and keeps the text when an image fails to load. The release walkthrough captures the actual dialog and exercises its actions separately from the artwork.

## 0.5 highlights: capture, compare and hand off

The three `whats-new-050-*` PNGs are unedited screenshots of Imnota on Windows 11 x64, captured on 2026-11-14 with the existing isolated native walkthrough. Every project, screenshot, annotation, bundle identifier and instruction is synthetic. The selected images were inspected for personal data and contain no personal workspace paths. They are bundled locally; opening release notes makes no image-generation or screenshot-upload calls.

| Asset                             | Pixels     | Bytes   | Source capture and revision                                                                                                                                                                               |
| --------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whats-new-050-quick-capture.png` | 900 × 680  | 20,117  | `quick-capture-annotation.png`, packaged Imnota 0.4.0 at `27de73bbba1bf3f71f99b0a3982ee44266a5b06a` (merged with the identical tree in #321).                                                             |
| `whats-new-050-comparison.png`    | 1080 × 720 | 28,549  | `comparison-ready.png`, source-build Imnota 0.4.0 at `94d1eccba1a32354292eae6f6c31bc1d19e8a446`. The walkthrough saves an included pair through the UI, reads its persisted identities, then captures it. |
| `whats-new-050-agent-handoff.png` | 1280 × 800 | 164,313 | `agent-handoff-exact.png`, the same packaged revision as the quick-capture image. The dialog identifies a synthetic saved export, not a live view of a collection.                                        |

SHA-256:

```text
quick-capture  0e7e922272057b898e0368b9db17c87ad341bbd13cdfd7e35c9082ce27557155
comparison     b8635a853119ce4e796446cc822ac7d38508ed173dc191d8a994398bf046de69
agent-handoff  bde003c6e4a4725ff93ece3770abf071abbe3a0f60d5d2c47d5a312d2fc556a8
```

The screenshot version records the build used to capture the artwork. Stable and Nightly builds newer than 0.4.0 share these highlights. The preview label follows the installed channel. Verify a release candidate's version, channel label, three loaded images, navigation, replay and actions in the packaged walkthrough. Use a receiving editor or coding agent to check handoff compatibility separately.

## Lossless WebP derivation - 17 November 2026

The bundled large PNGs documented above were encoded from repository revision `72b0945559e9ec1c55648d17a09fd288de96ac1f` with Pillow 12.3.0 / libwebp 1.6.0 using `lossless=True, exact=True, method=6`. The shipped filenames now use `.webp`; the PNG names above record the original sources, which remain in Git history. This is a format conversion with no crop, resize, palette change or generated content. Every decoded RGBA pixel matches its PNG source exactly. These source files have no ICC, gamma, EXIF or other metadata to transfer.

| Asset stem                | Pixels     | Original PNG bytes | WebP bytes |
| ------------------------- | ---------- | -----------------: | ---------: |
| `whats-new-040-capture`   | 1586 x 992 |          1,428,634 |  1,013,272 |
| `whats-new-040-files`     | 1586 x 992 |          1,492,345 |  1,036,590 |
| `whats-new-040-workspace` | 1586 x 992 |          1,761,505 |  1,242,880 |

SHA-256 pairs (original PNG, then derived WebP):

```text
whats-new-040-capture
  PNG   aa597229f1e91eb9a2fb8ffab68ad4ee88f4878947fac038af9a2189ae6648e3
  WebP  d2c927d0e26fa5a0e816ce7dbaaf56b5ba59f85372186b68305083b294cca5ce
whats-new-040-files
  PNG   514038d83dea3fc6b2458a8014244d89fddeb884d4229d9e0060a255be6be7cb
  WebP  9ef5797356fda048f8232bf4afd4e9b47643778c7337499f445b1af63c2c3b28
whats-new-040-workspace
  PNG   79d09df88ff45bd1352b7c0fd1bebb87395e5e99c0d0de758105454f6eba80db
  WebP  a8cdb040f6ca5af2586f90ee7c85ec68b0e00fd7636353624083d8ff277bed57
```

Windows Electron 45.3.2 / Chromium 156 canvas decoding also compared all 11 source/derived pairs with zero differing RGBA channels. Clean main and conversion builds both passed the native walkthrough (39 assertion groups). The same-machine visual comparison passed 13/14 approved capture names, including both backdrop views; the unmatched onboarding intro shifts unchanged content by roughly one pixel. Four supplementary generic-backdrop settings captures are byte-identical. Main itself fails 8/14 committed CI baselines locally; the conversion fails 9/14 including onboarding. Final head `33770e9` passed every required CI gate, including all 14 unchanged approved Windows baselines, before [PR #350](https://github.com/Dytschgo/imnota/pull/350) merged as `4a56f38`. The local onboarding mismatch did not occur in that CI baseline comparison. No baseline images or tolerances are updated by this conversion.

The smaller historical UI captures and 0.5.0 screenshots remain PNGs with their existing provenance. Only the three large 0.4.0 illustrations are converted here.
