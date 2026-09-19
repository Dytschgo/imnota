# Windows copy comparison

Use this sheet to verify the Windows copy format that feels best in your apps. Copy files is the initial default; you can save another preference. An app may prefer different clipboard formats in its editor, chat composer, or file list.

## Record your setup

- Imnota nightly version:
- Windows version:
- Date:
- Clipboard manager or Windows clipboard history enabled:
- App versions: Obsidian / VS Code / Cursor / T3 Code / ChatGPT browser / ChatGPT Windows app:
- Browser name and version:

## Prepare one small bundle

1. Open **Settings → Updates & about → Replay guide**. Choose **Use sample screenshot**, then **Add guided note**. This prepares a local sample without adding files to your workspace.
2. Add this marker to the sample explanation, then choose **Continue to copy**:

   > COPY-CHECK-01 — Keep the purple button. Move the marked label below it. This sentence and the annotated image belong together.

3. Keep the guide open on its copy step and reuse that same sample for every variant. You can leave the guide without creating a project.
4. Open a blank note, scratch file, or new unsent chat in the receiving app. Use a test vault/folder for file imports.

Keep chat messages as drafts. You do not need to send anything to compare the pasted text, image preview, or attachments.

After choosing a favorite, repeat that option with a disposable project called **Copy comparison**, one harmless screenshot, an annotation, and the same explanation. This checks the normal **Copy Bundle** flow as well as the guide.

## Try each copy variant

Open **Copy Bundle**, then use the copy choices on the image bundle. The interactive guide offers the same choices on its copy step if you prefer a disposable sample.

| Option                         | What it puts on the clipboard                                       | What to compare                                                 |
| ------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Rich copy                      | Markdown text, formatted HTML, and image pixels                     | Does the receiver paste the explanation, image, or both?        |
| Copy files                     | The generated `.md` and `.png` as two files                         | Does the receiver attach or import both files without Explorer? |
| Files + rich copy              | Both files plus the text, HTML, and image formats                   | Which formats does the app choose? Are there duplicates?        |
| Copy Markdown, then Copy image | Two separate clipboard operations, each pasted before the next copy | Is this predictable enough to justify the extra step?           |
| Copy file paths                | The two file paths as text                                          | Useful fallback only: paths are not file attachments.           |

The guide labels the separate actions **Copy Markdown** and **Copy image**; export cards add **only** to those labels. The primary button uses your saved copy format, initially **Copy files** on Windows. Choose another format from its dropdown or **Settings → Sharing → Native copy functions**. Changing the selection saves your preference without copying anything. For each option, use this same procedure:

1. Return to Imnota, select the variant from the dropdown, then click the primary copy button. Wait for its result message.
2. Record what Imnota says it placed on the clipboard. This confirms clipboard contents, not what the receiving app will accept.
3. Focus the receiving app's intended input and press **Ctrl+V once**.
4. Check for the complete `COPY-CHECK-01` sentence and the image with your annotation. If files arrive, check that both `.md` and `.png` are present and readable.
5. Record extra clicks, duplicate attachments, prompts, unexpected folders, or a paste that did nothing. Do not silently repair the result before recording it.
6. Clear that disposable draft or use a fresh destination, then copy again from Imnota for the next variant. Every copy replaces the previous clipboard selection; two separate copy actions do not combine into one clipboard item.

For the separate-copy baseline, paste Markdown first, then return to Imnota, copy the image, and paste again. Record the two-step effort as part of the result.

## Where to paste

| App                 | Main destination                   | Optional second destination                            |
| ------------------- | ---------------------------------- | ------------------------------------------------------ |
| Obsidian            | Empty note in a test vault         | Vault file list, if you normally import files there    |
| VS Code             | The chat composer you normally use | Scratch Markdown editor; note which surface you tested |
| Cursor              | Chat composer                      | Scratch Markdown editor                                |
| T3 Code             | New conversation composer          | Your usual existing conversation, without sending      |
| ChatGPT in browser  | New chat composer                  | Your usual browser if it differs from the first test   |
| ChatGPT Windows app | New chat composer                  | None required                                          |

If you use another ChatGPT client, add it as a separate row with its exact name. Do not group browser and desktop results together.

## Results

Use **both**, **text only**, **image only**, **two files**, **one file**, **paths only**, or **nothing** for the result. Mark **not tested** when you skip a combination.

| App and input surface | Copy option | What arrived? | Complete text? | Annotated image? | Extra steps or surprises | Ease (1–5) |
| --------------------- | ----------- | ------------- | -------------- | ---------------- | ------------------------ | ---------- |
| Obsidian              |             |               |                |                  |                          |            |
| VS Code               |             |               |                |                  |                          |            |
| Cursor                |             |               |                |                  |                          |            |
| T3 Code               |             |               |                |                  |                          |            |
| ChatGPT browser       |             |               |                |                  |                          |            |
| ChatGPT Windows       |             |               |                |                  |                          |            |

Duplicate these rows for each copy option. **1** means frustrating or unusable; **5** means it works as expected with little effort. A text file attachment and visible message text are different outcomes: record which one you prefer.

## Check the saved preference

- [ ] Selecting a different format changes the primary button without replacing the clipboard.
- [ ] Settings and the guide/share-bundle selector show the same choice.
- [ ] Restarting Imnota keeps the selected format.
- [ ] Share bundles fits the window and the copy dropdown is usable without clipping.

## Check the fallbacks once

- [ ] Copy Markdown: complete explanation arrives as text.
- [ ] Copy image: the annotated image arrives.
- [ ] Copy file paths: two usable paths arrive as text.
- [ ] Open files: the generated Markdown and image are accessible.
- [ ] Open export folder: the destination is accessible.
- [ ] Ordinary copy options leave Explorer closed; it opens only when I choose a file-opening action.

## Check the other nightly changes

If capture is disabled, enable **Settings → Shortcuts → Capture a screen region** first. Import remains available from the arrow beside **Add screenshot**.

- [ ] Clicking **Add screenshot** starts selection on every display without asking primary/secondary.
- [ ] Drag a region within each display and inspect the saved result.
- [ ] Drag across the boundary between two displays; the saved image contains the selected parts from both in the correct positions.
- [ ] Repeat the cross-display drag in the opposite direction. Press Escape during another capture; all overlays close.
- [ ] The update button has no resting border and its tooltip describes the current action.
- [ ] When a newer nightly is available, hover over the download icon, move into its release notes, and scroll without the panel disappearing. If no newer release exists, mark this **not available to test**.
- [ ] A download shows progress on the same control; restarting requires an explicit click. Mark unavailable states **not tested**.

## Send back your preference

- Best option overall:
- Best option for each app, if different:
- Does the saved copy preference work as expected?
- Do you prefer visible Markdown text plus an image, or two file attachments?
- Any confusing label, unexpected window, missing content, or duplicate:
- Nightly version tested:

Return this filled-in file, or just the results table and preferences. Screenshots of disposable test content are useful when a result is hard to describe.
