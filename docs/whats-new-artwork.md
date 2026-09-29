# What's New artwork

The three 0.4.0 illustrations were generated on 2026-09-29 with the built-in image-generation tool, one generation per asset. They are bundled local artwork; Imnota makes no image-generation calls. The original PNGs were copied without editing and inspected for composition, palette and absence of text or logos.

| Asset in `src/renderer/assets/` | Subject                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `whats-new-040-capture.png`     | A violet timer beside a framed image, illustrating capture delay.               |
| `whats-new-040-files.png`       | Separate written-note and image sheets above a tray, illustrating file copy.    |
| `whats-new-040-workspace.png`   | An orderly card tray, toggle and pencil, illustrating workspace simplification. |

The prompt direction was a minimal landscape still life in matte paper and ceramic, with an off-white background, violet accent, sage hills and a small coral sun. Each prompt required legibility at the card's 200 × 124 px display size, soft studio light, and no words, logos, watermarks or fabricated app UI.

These are decorative illustrations, not screenshots or proof of receiving-app behavior. Feature descriptions and actions remain accessible HTML. `WhatsNew.tsx` gives decorative images an empty alternative and keeps the text when an image fails to load. The release walkthrough captures the actual dialog and exercises its actions separately from the artwork.
