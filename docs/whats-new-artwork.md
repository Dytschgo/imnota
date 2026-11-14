# What's New artwork

The three 0.4.0 illustrations were generated on 2026-09-29 with the built-in image-generation tool, one generation per asset. They are bundled local artwork; Imnota makes no image-generation calls. The original PNGs were copied without editing and inspected for composition, palette and absence of text or logos.

| Asset in `src/renderer/assets/` | Subject                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `whats-new-040-capture.png`     | A violet timer beside a framed image, illustrating capture delay.               |
| `whats-new-040-files.png`       | Separate written-note and image sheets above a tray, illustrating file copy.    |
| `whats-new-040-workspace.png`   | An orderly card tray, toggle and pencil, illustrating workspace simplification. |

The prompt direction was a minimal landscape still life in matte paper and ceramic, with an off-white background, violet accent, sage hills and a small coral sun. Each prompt required legibility at the card's 200 × 124 px display size, soft studio light, and no words, logos, watermarks or fabricated app UI.

These are decorative illustrations, not screenshots or proof of receiving-app behavior. Feature descriptions and actions remain accessible HTML. `WhatsNew.tsx` gives decorative images an empty alternative and keeps the text when an image fails to load. The release walkthrough captures the actual dialog and exercises its actions separately from the artwork.

## Next nightly: capture, compare and hand off

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

The screenshot version records their source, not a claim that the next nightly has been published. The new nightly catalog entry is gated after 0.4.0 and does not replace Stable or older-nightly guidance. Verify the final nightly's actual version, installed-channel label, three loaded images, navigation, replay and related actions against that published candidate. A controlled local preview is separate evidence from publication. Screenshots do not establish acceptance by an external coding agent or clipboard receiver.
