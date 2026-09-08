# Optional backdrop artwork

Generated on 2026-09-07 with the built-in GPT Image tool, one call per image. These are bundled local assets; Imnota does not call an image-generation service. The user must opt in to a backdrop. The original generated PNGs were copied without editing, and inspected for palette, composition, and absence of text or logos.

Files: `public/backdrops/graphite.png`, `indigo.png`, `emerald.png`, `amber.png`.

## Prompt set

Each prompt used this structure:

> Use case: stylized-concept. Create one finished landscape 16:9 desktop wallpaper for Imnota's optional [title] backdrop. An original adult anime woman, shoulders-up portrait on the right third, calm focused expression, [clothing and palette], [lighting and setting]. Polished hand-painted anime illustration, cinematic wide composition with quiet low-detail negative space across the left two-thirds so application panels remain readable. No text, no logo, no watermark, no UI, no collage. Single image.

The exact variable portions were:

| File         | Title            | Clothing and palette                                          | Lighting and setting                                                                                                                   |
| ------------ | ---------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| graphite.png | Graphite night   | charcoal clothing, understated graphite monochrome palette    | with charcoal and silver lighting and subtle glass reflections in a dark developer workbench atmosphere                                |
| indigo.png   | Indigo dusk      | understated midnight blue clothing, indigo and violet palette | with midnight blue lighting and subtle electric blue highlights, translucent glass reflections in a dark creative workbench atmosphere |
| emerald.png  | Emerald signal   | understated dark teal clothing, emerald and deep teal palette | with soft green rim lighting and subtle glass reflections in a dark creative workbench atmosphere                                      |
| amber.png    | Amber late shift | understated dark umber clothing, amber and warm umber palette | with soft golden rim lighting and subtle glass reflections in a dark creative workbench atmosphere                                     |

The images are cosmetic and must not be composited into exported screenshot prompts. Reduced-transparency and host performance fallbacks take precedence over the decorative backdrop. Light mode with a selected image derives in-app glass without changing the saved glass preset; dark mode continues to use that saved preset.

## Generic collection � 9 September 2026

Four additional originals were generated with the built-in GPT ImageGen tool, one call per image, without references or CLI fallback. They were copied unchanged into the repository; the four original character files and their saved IDs are unchanged. No selection is replaced automatically. The picker separates Generic and Characters, with uploads still available.

| Preset ID    | Repository asset                  | Decoded dimensions | PNG bytes | Intended theme |
| ------------ | --------------------------------- | ------------------ | --------- | -------------- |
| `mist-light` | `public/backdrops/mist-light.png` | 1672 � 941         | 1,513,106 | Light          |
| `sand-light` | `public/backdrops/sand-light.png` | 1672 � 941         | 1,752,321 | Light          |
| `slate-dark` | `public/backdrops/slate-dark.png` | 1672 � 941         | 1,864,042 | Dark           |
| `dusk-dark`  | `public/backdrops/dusk-dark.png`  | 1672 � 941         | 1,227,549 | Dark           |

Combined added PNG size is 6,357,018 bytes (6.06 MiB). The tool returned approximately 16:9 originals at 1672 � 941 despite the requested approximate 2560 � 1440 size; no synthetic upscaling was applied. Vite copies the local public assets into the packaged `dist/backdrops` directory. Offscreen picker thumbnails use lazy loading.

[Exact generation prompts](generic-backdrop-prompts.md) record the final inputs. Source outputs were `exec-17e0d60f-e52d-46ad-bfb9-a316f99142b3.png` (Mist), `exec-bd3914a8-8954-4adc-9bfa-594b809d1708.png` (Sand), `exec-b49813c6-24b6-4856-b74f-6fe8840052b8.png` (Slate), and `exec-b70464c1-803b-4558-af2e-49c982c434dd.png` (Dusk), in generation session `01a0834f-6f69-7d42-aedd-7abea993cd55`.

All four outputs were inspected individually for distinct composition, quiet working areas, and absence of people, text, logos and baked-in UI. The native verification workflow selects and decodes every bundled preset, persists the selection, and captures the four generic choices behind the actual settings chrome when artifact capture is enabled. Mist and Sand use automatic light glass with the saved Solid preset; Slate and Dusk use dark Strong glass. Backdrops remain decorative and are never composited into exports.
