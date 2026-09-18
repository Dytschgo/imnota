# Clipboard receiver matrix

Status: macOS paste into real editors works. Windows is still being tested. Automated tests confirm that Imnota wrote clipboard formats; they do not prove receiver acceptance by themselves.

Use this file as the living result table. Do not mark a cell as working from an Electron clipboard write alone.

## Contract

- Combined copy prepares Markdown and a prompt PNG together from the latest saved state.
- The receiving app decides which representation to paste.
- Imnota reads the clipboard back after the combined write and reports which formats the operating system kept (text, HTML, image). When one is missing, the bundle card names it and points at the separate copy action.
- Imnota reports what the clipboard holds, never that another app accepted it.
- Fallbacks: Copy Markdown only, Copy image only, Open generated files, Copy file paths, Open export folder.

## How to run a check

1. Create a disposable project with a synthetic screenshot (and, for mixed rows, a drawing with a description plus a text block).
2. Copy a fresh prompt from the sharing dialog.
3. Paste into the target using its normal paste command.
4. Record whether Markdown arrived, whether the image arrived, whether both arrived in one paste, and which fallback worked if the combined paste was incomplete.
5. Repeat with Copy Markdown only and Copy image only when combined paste is incomplete.
6. Use only synthetic or explicitly authorized content.

Record OS version, target version, Imnota revision, and the date.

## Required targets

| Target                                | OS      | Combined Markdown | Combined image | Both in one paste | Markdown-only | Image-only | Files / paths | Date       | Imnota revision | Notes                                                           |
| ------------------------------------- | ------- | ----------------- | -------------- | ----------------- | ------------- | ---------- | ------------- | ---------- | --------------- | --------------------------------------------------------------- |
| Cursor                                | Windows | testing           | testing        | testing           | testing       | testing    | testing       |            |                 | Still being tested on Windows.                                  |
| VS Code (chat or Markdown editor)     | Windows | testing           | testing        | testing           | testing       | testing    | testing       |            |                 | Still being tested on Windows.                                  |
| Browser assistant (Claude or ChatGPT) | Windows | testing           | testing        | testing           | testing       | testing    | testing       |            |                 | Still being tested on Windows.                                  |
| Native Markdown editor                | Windows | testing           | testing        | testing           | testing       | testing    | testing       |            |                 | Still being tested on Windows.                                  |
| Cursor                                | macOS   | works             | works          | works             | works         | works      | works         | 2026-09-16 |                 | User-reported: paste works on macOS. Fill editor version later. |

Also exercise, at least once per OS:

- a split prompt bundle
- an excluded screenshot
- a text-only collection
- a drawing with a description

## Cases that do not count as proof

- `clipboard.readText()` / `clipboard.readImage()` inside Imnota or the smoke driver
- A screenshot of the sharing dialog success state
- macOS results inferred from Windows, or the reverse

## Related

- [Clipboard compatibility plan](clipboard-images-plan.md)
- [User guide](user-guide.md)
