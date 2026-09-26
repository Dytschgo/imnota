# Clipboard receiver matrix

Status: the macOS Cursor result below is user-reported. Windows Notepad and Paint have direct receiver observations from 2026-09-22; coding-editor and browser-assistant acceptance remains unverified. Automated clipboard read-back alone does not prove receiver acceptance.

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
| Cursor                                | Windows | unverified        | unverified     | unverified        | unverified    | unverified | unverified    |            |                 | No direct receiver evidence recorded yet.                       |
| VS Code (chat or Markdown editor)     | Windows | unverified        | unverified     | unverified        | unverified    | unverified | unverified    |            |                 | No direct receiver evidence recorded yet.                       |
| Browser assistant (Claude or ChatGPT) | Windows | unverified        | unverified     | unverified        | unverified    | unverified | unverified    |            |                 | No direct receiver evidence recorded yet.                       |
| Native Markdown editor                | Windows | unverified        | unverified     | unverified        | unverified    | unverified | unverified    |            |                 | No direct receiver evidence recorded yet.                       |
| Cursor                                | macOS   | works             | works          | works             | works         | works      | works         | 2026-09-16 |                 | User-reported: paste works on macOS. Fill editor version later. |

Also exercise, at least once per OS:

- a split prompt bundle
- an excluded screenshot
- a text-only collection
- a drawing with a description

## Windows observations — 2026-09-22

Windows build 26200. The receiving apps were controlled through their native UI using normal Ctrl+V, with synthetic artifacts only. The development clipboard writer was compiled from `7910bc7` (Imnota 0.2.8); `electron/native-clipboard.ts` is unchanged from `a3f576e`. Export artifacts came from the successful `65d44c1` native performance run.

| Receiver and version                  | Rich copy result                                          | Separate fallback result                     | Both together |
| ------------------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------- |
| Notepad 11.2607.14.0, plain-text mode | Markdown arrived, image did not appear                    | Markdown-only arrived                        | No            |
| Paint 11.2605.81.0                    | Prompt image arrived at 1240×716; Markdown did not appear | Image-only dense prompt arrived at 3620×3402 | No            |

A disposable Electron harness invoked the production `nativeClipboard.writeContext`, `writeText`, and `writeImage` boundaries with generated prompt artifacts. The combined write reported text, HTML and image present; actual receiver observations above show each application choosing its supported representation. This confirms native writer-to-receiver behavior, not an end-to-end Copy Bundle button walkthrough in those apps. The full native application walkthrough is separate evidence.

File-pair reception, Cursor/VS Code, browser assistants, text-only/mixed/split receiver cases, and a version-pinned macOS rerun remain unverified. The browser automation connector could not open the installed Edge browser in this session. No editor installation, account login, or external message submission was performed. Local synthetic verification tabs/canvas were left unsaved; existing documents were preserved.

## T3 Code composer source check — 2026-09-24

T3 Code's [composer paste handler](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/web/src/components/chat/ChatComposer.tsx#L5617-L5635) reads both clipboard files and plain text. When an image file is present, it prevents the default paste, adds the image attachment and returns without inserting the text. Its [classification function](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/web/src/components/chat/composerAttachmentFiles.ts#L159-L177) and [test](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/web/src/components/chat/composerAttachmentFiles.test.ts#L341-L350) explicitly choose the image path even when plain text is present. This is a source-based explanation for a reported image-only T3 paste if macOS exposes Imnota's PNG as a clipboard file. It is not a version-pinned macOS receiver observation. Use **Copy Markdown only** to paste text into T3 Code, then **Copy image only** if the image is also needed.

## Chromium source compatibility — 2026-09-26

Windows Copy files and Copy files + text/image can replace a browser selection containing `Chromium internal source RFH token` and `Chromium internal source URL`. Both formats use the bounded byte snapshot path; a partial write restores their original bytes along with the original content. Unknown registered formats still stop the transaction before the clipboard is cleared.

Chromium [serializes its frame token](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/browser/clipboard_types.cc) and [writes the token and source URL into global memory](https://chromium.googlesource.com/chromium/src/+/master/ui/base/clipboard/clipboard_win.cc). These buffers differ from the transient OLE broker handles that cannot be replayed.

The Windows packaged smoke now creates a real Chromium renderer selection, verifies its content and both provenance formats, injects a partial write failure, checks byte-for-byte restoration, then copies the generated file pair. A local Windows development walkthrough also exercised **Copy Bundle → Copy files** over that clipboard state and confirmed the generated Markdown/PNG pair. This establishes source compatibility and recovery, not acceptance by a receiving editor. Publication and packaged-candidate evidence belong in the fix's PR and release record.

## Cases that do not count as proof

- `clipboard.readText()` / `clipboard.readImage()` inside Imnota or the smoke driver
- A screenshot of the sharing dialog success state
- macOS results inferred from Windows, or the reverse

## Related

- [Clipboard compatibility plan](clipboard-images-plan.md)
- [User guide](user-guide.md)
