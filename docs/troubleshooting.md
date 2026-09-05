# Troubleshooting

## The workspace cannot be opened

Confirm the folder still exists and that it is writable. Use Settings to choose another workspace. Existing project folders are not deleted when a workspace becomes unavailable.

## A screenshot will not import

Imnota accepts PNG, JPEG and WebP. If the file is damaged or unsupported, the original stays untouched and the error names the file.

## Clipboard paste does not work

Copy the image itself, not a browser image URL or a file name. Clipboard support depends on the operating system exposing an image bitmap.

## Exported images are not attached automatically

Clipboard file attachments differ between Windows, macOS, Linux and AI applications. Imnota always copies the Markdown text and writes image files to the project `exports/` folder. Use Open export folder and attach the annotated files manually when needed.

## Packaging is unsigned

Normal development and pull request builds are unsigned. Signing and macOS notarisation are optional release steps and must use repository secrets, never values checked into the repository.
