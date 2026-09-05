# Copy context with images: prototype plan

Status: opt-in prototype implemented locally; not published. Prepared with Luna (`gpt-5.6-luna`) and reviewed against Imnota's Electron 39.8.10 API. Target-app compatibility remains unverified.

## Smallest useful experiment

1. Add one validated, typed `system:copy-context` bridge operation rather than separate text and image writes that replace each other.
2. Write plain Markdown, safe generated HTML and one rendered annotated image together using `clipboard.write({ text, html, image })`. Start with one screenshot. For multiple screenshots, offer a labelled combined image, explicitly identified as one attachment, not separate files.
3. Bound image dimensions and memory. Do not silently shrink screenshot text until it is unreadable; use the existing separate PNG export fallback when the combined image would be too large.
4. Retain Copy Markdown, individual Copy image and Open export folder actions. Never claim attachments were received just because writing the clipboard succeeded.

Both App.tsx `copyContext()` and the Context Builder action now open the sharing dialog. Choose **Copy text + image (experimental)** there. The typed bridge and validated main-process handler write all formats in one call. Multiple references are combined at native resolution with filename labels; the operation rejects more than 20 images, an edge above 8192 pixels, more than 16 million pixels or an oversized PNG. Existing annotated-image rendering handles crops and redactions before composition. No Electron upgrade, runtime AI service, cloud upload or automatic pasting into another app.

Validation includes unit/component tests for limits, ordering, HTML escaping, success/failure UI and actual Electron smoke checks for clipboard text/HTML/image, exclusions, native dimensions, crop, opaque redaction and unchanged clipboard after invalid input. Desktop sharing-dialog screenshots were also inspected. These tests do not prove how an external AI app consumes the clipboard.

## Compatibility gate

Electron can supply several formats; the receiving app decides which to consume. Supplying text and an image does not guarantee both arrive in the prompt. HTML and local file references are not reliable substitutes for actual attachments.

Manually test on macOS: ChatGPT desktop/web, Claude desktop/web and the user's Copilot client, with exact app/browser versions recorded. For each target record whether text arrives, image arrives, both arrive, image is readable, and separate-image fallback works. These target behaviors are currently unverified. Use synthetic screenshots only; do not submit prompts or upload personal screenshots during testing without authorization.

Test one image, several images, excluded images, subfolder scope, empty selection and oversized images. Verify sequence labels, Markdown association, crop boundaries and opaque redactions; never include original files or hidden source pixels in clipboard artifacts. Keep clipboard unchanged on preparation failure and show an actionable error.

Only promote combined copy as the default after observed compatibility. If a target ignores one payload, keep the explicit two-step fallback. Native dragging of exported PNG files is a possible later enhancement, not proof of one-paste support.

## Sources

- [Electron 39 clipboard API](https://github.com/electron/electron/blob/v39.8.10/docs/api/clipboard.md#clipboardwritedata-type)
- [Electron native file drag and drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop)
