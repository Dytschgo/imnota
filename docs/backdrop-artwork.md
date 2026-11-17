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

## Generic collection - 9 September 2026

Four additional originals were generated with the built-in GPT ImageGen tool, one call per image, without references or CLI fallback. They were copied unchanged into the repository; the four original character files and their saved IDs are unchanged. No selection is replaced automatically. The picker separates Generic and Characters, with uploads still available.

| Preset ID    | Repository asset                  | Decoded dimensions | PNG bytes | Intended theme |
| ------------ | --------------------------------- | ------------------ | --------- | -------------- |
| `mist-light` | `public/backdrops/mist-light.png` | 1672 × 941         | 1,513,106 | Light          |
| `sand-light` | `public/backdrops/sand-light.png` | 1672 × 941         | 1,752,321 | Light          |
| `slate-dark` | `public/backdrops/slate-dark.png` | 1672 × 941         | 1,864,042 | Dark           |
| `dusk-dark`  | `public/backdrops/dusk-dark.png`  | 1672 × 941         | 1,227,549 | Dark           |

Combined added PNG size is 6,357,018 bytes (6.06 MiB). The tool returned approximately 16:9 originals at 1672 × 941 despite the requested approximate 2560 × 1440 size; no synthetic upscaling was applied. Vite copies the local public assets into the packaged `dist/backdrops` directory. Offscreen picker thumbnails use lazy loading.

[Exact generation prompts](generic-backdrop-prompts.md) record the final inputs. Source outputs were `exec-17e0d60f-e52d-46ad-bfb9-a316f99142b3.png` (Mist), `exec-bd3914a8-8954-4adc-9bfa-594b809d1708.png` (Sand), `exec-b49813c6-24b6-4856-b74f-6fe8840052b8.png` (Slate), and `exec-b70464c1-803b-4558-af2e-49c982c434dd.png` (Dusk), in generation session `01a0834f-6f69-7d42-aedd-7abea993cd55`.

All four outputs were inspected individually for distinct composition, quiet working areas, and absence of people, text, logos and baked-in UI. The native verification workflow selects and decodes every bundled preset, persists the selection, and captures the four generic choices behind the actual settings chrome when artifact capture is enabled. Mist and Sand use automatic light glass with the saved Solid preset; Slate and Dusk use dark Strong glass. Backdrops remain decorative and are never composited into exports.

## Lossless WebP derivation - 17 November 2026

The bundled large PNGs documented above were encoded from repository revision `72b0945559e9ec1c55648d17a09fd288de96ac1f` with Pillow 12.3.0 / libwebp 1.6.0 using `lossless=True, exact=True, method=6`. The shipped filenames now use `.webp`; the PNG names above record the original sources, which remain in Git history. This is a format conversion with no crop, resize, palette change or generated content. Every decoded RGBA pixel matches its PNG source exactly. These source files have no ICC, gamma, EXIF or other metadata to transfer.

| Asset stem   | Pixels     | Original PNG bytes | WebP bytes |
| ------------ | ---------- | -----------------: | ---------: |
| `amber`      | 1672 x 941 |          1,502,953 |  1,093,054 |
| `dusk-dark`  | 1672 x 941 |          1,227,549 |  1,035,428 |
| `emerald`    | 1672 x 941 |          1,570,695 |  1,172,216 |
| `graphite`   | 1672 x 941 |          1,552,464 |  1,127,180 |
| `indigo`     | 1672 x 941 |          1,707,187 |  1,318,160 |
| `mist-light` | 1672 x 941 |          1,513,106 |  1,103,628 |
| `sand-light` | 1672 x 941 |          1,752,321 |  1,279,016 |
| `slate-dark` | 1672 x 941 |          1,864,042 |  1,272,106 |

SHA-256 pairs (original PNG, then derived WebP):

```text
amber
  PNG   2b7bc76aa6ce0a362e0eebf0b92435c4eaea8d2653255c2bba6b16398aeab102
  WebP  a80573fcd6fc691397f6afcde45377b8bfa21f3f730bdb859813c26788d75974
dusk-dark
  PNG   3a2b483e04b3bf1115036d1a399a3c9bf898cefecc4a1c0cbc1c7f2b9a7f919c
  WebP  8edb43a102ad2f1079eae223e8a39abed4e7baa59e3c16501c429c15bc827a78
emerald
  PNG   d971100f1287be5265e84ef5fcdbe9099844bd67e376de73302779f46e78ee52
  WebP  e373f69ce3c6bdae4032aa5bfe276a76d5de0df036ce584df8399012f92bc930
graphite
  PNG   ac28a1bdccdb68c47d287dfe861b5f6e85f1310be8039e0e46ce313d53682d14
  WebP  f5a9a9eafe0ab24536779934ad4636b1d478005e203dc095ab3d3f95f668f829
indigo
  PNG   fd9abeae0923af2a9ac741041054c9b3fd818b74e52e36237d8ba674e50bdde5
  WebP  cdcc5a3cfced6384fa808612b778b261533f8d6a9aba163fd9beb618416fb134
mist-light
  PNG   f464ce2034af86efa6584ead5fed43cfe20249449f51cd7515d82485b99ccd89
  WebP  0a6fb3b8c6c2b518a26dad5fd75167a1693ee76cc3c1b52bc78096a143a5317a
sand-light
  PNG   34073711022258522116fb34e17aecfb7b4cea800d9da2c405ff6c81eaf5382a
  WebP  b9fb2dd8797cc3fbed5a7a527c84843fd8d6d45c152bbdc263ebd0828ff25a67
slate-dark
  PNG   e0ccdd14faa797d5d2d329295646b7dd78996696bfe3929b72893dad7dbafe61
  WebP  b207cd046aa2dc0226411ebc16064684d954117faf8f7f88bc102226269ae9cb
```

Windows Electron 45.3.2 / Chromium 156 canvas decoding also compared all 11 source/derived pairs with zero differing RGBA channels. Clean main and conversion builds both passed the native walkthrough (39 assertion groups). The same-machine visual comparison passed 13/14 approved capture names, including both backdrop views; the unmatched onboarding intro shifts unchanged content by roughly one pixel. Four supplementary generic-backdrop settings captures are byte-identical. Main itself fails 8/14 committed CI baselines locally; the conversion fails 9/14 including onboarding. Final head `33770e9` passed every required CI gate, including all 14 unchanged approved Windows baselines, before [PR #350](https://github.com/Dytschgo/imnota/pull/350) merged as `4a56f38`. The local onboarding mismatch did not occur in that CI baseline comparison. No baseline images or tolerances are updated by this conversion.
