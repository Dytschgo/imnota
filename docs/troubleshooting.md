# Troubleshooting

## The workspace cannot be opened

Confirm the folder still exists and is writable, then choose it again in Settings. Imnota does not delete project folders when a workspace becomes unavailable.

## A screenshot will not import

Imnota accepts PNG, JPEG and WebP. A damaged or unsupported file is rejected without modifying the source. Imported screenshots are appended in the order supplied by the operating system or file picker.

## Clipboard paste does not import a screenshot

Copy the image bitmap itself, not a browser image URL, HTML element or filename. Clipboard image availability depends on what the source application places on the operating-system clipboard.

## Electron does not open during `pnpm dev`

Use `corepack pnpm dev`, not the Electron binary directly. The repository launcher removes an inherited `ELECTRON_RUN_AS_NODE` from the Electron child while preserving `VITE_DEV_SERVER_URL` and every other environment value. If startup still fails, run `node --test scripts/dev-electron.test.mjs`, confirm the Vite URL is reachable and check the Electron TypeScript watcher for errors.

## Markdown and image do not both paste

The combined Copy action can place Markdown and a PNG on the clipboard together, but the receiving editor chooses which format to consume. A success message means Imnota prepared the clipboard; it does not prove the target accepted both formats.

Use Copy Markdown only, then Copy image only, or open the generated files/folder and attach the PNG. Copying an image generally replaces the current clipboard text. Record the OS and exact target version when reporting compatibility.

## A collection creates several prompt files

Splitting is automatic and protects dimensions, memory, clipboard safety and text readability. Picture numbers remain tied to current collection order across bundles. Users cannot select manual split points.

## An excluded screenshot is still mentioned

The crossed-eye state removes a screenshot from prompt PNGs but deliberately leaves a textual exclusion in every generated Markdown bundle. It remains selectable and editable and does not renumber later screenshots. Delete it only when it should leave the collection.

## Undo after deletion is unavailable

Deletion uses the operating-system trash and keeps a bounded immediate Undo record. Undo can fail if the operating system no longer exposes the trashed files, an original path has been occupied or the collection no longer exists. Recovery files are retained when restoring would overwrite another file.

## Export output looks different from the live canvas

Prompt PNGs always use a white neutral background. Export-only contrast correction may turn white text dark or shift other colors so annotations remain readable. It does not modify the original screenshot or saved annotation intent.

## Onboarding appears unexpectedly

Onboarding completion belongs to the local application profile, not a project or workspace. A new OS user/profile or cleared application data is genuinely new and shows onboarding. Normal updates should not; replay is available from Settings.

## Packaging is unsigned

Normal development and pull-request builds are unsigned. Signing and macOS notarisation are release operations and must use repository secrets, never values checked into source.

## Manual compatibility status

macOS workflow verification and cross-editor combined-paste acceptance are pending manual checks. Automated Electron tests, Windows development results or clipboard-write success must not be reported as passing evidence for those environments. Use the [manual user-feedback protocol](user-feedback-protocol.md).
