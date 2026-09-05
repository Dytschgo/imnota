# Imnota

Screenshots that AI understands.

Imnota is a local-first desktop tool for turning annotated screenshots into structured context for AI assistants and coding agents. Add a screenshot, mark what matters, write the surrounding context, and export a brief that an agent can actually use.

## Why local-first

Projects are plain folders containing JSON, Markdown and image files. There is no account, backend, cloud storage dependency, runtime AI service or telemetry by default. Your files stay on the device and can be copied, backed up or version-controlled directly.

## Features

- Electron, React and TypeScript desktop application
- Screenshot import, paste and drag-and-drop for PNG, JPEG and WebP
- Editable Konva annotation layer with arrows, lines, shapes, highlights, text, callouts, steps and sensitive-area masks
- Structured screenshot notes with status, priority and tags
- Undo and redo for annotation edits
- AI-ready Markdown context builder
- Annotated PNG and complete ZIP package exports
- Light, dark and system themes
- Secure Electron preload bridge with context isolation and no renderer Node.js access

## Supported platforms

Development and packaging targets are Windows, macOS and Linux. Unsigned artifacts are suitable for local testing. Production signing and notarisation are intentionally optional.

## Installation

Install Imnota with one command. On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Dytschgo/imnota/main/scripts/install.sh | bash
```

On Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Dytschgo/imnota/main/scripts/install.ps1 | iex
```

The installer downloads the latest published desktop build. Users do not need Node.js, pnpm, Electron or any development dependencies. The Mac archive supports both Apple Silicon and Intel, verifies its checksum and ad-hoc signature, and installs in `~/Applications`. Existing apps are kept as timestamped backups; project files are not moved.

This first release is **not Apple-notarised**. If macOS blocks opening Imnota, open System Settings → Privacy & Security → Open Anyway. Do not disable Gatekeeper. You can also [download the Mac ZIP directly](https://github.com/Dytschgo/imnota/releases/latest/download/Imnota-mac.zip), extract it and move Imnota to Applications.

For manual installation, download a release artifact for your platform, or build from source:

```bash
corepack enable
corepack pnpm install
corepack pnpm package:win   # Windows
corepack pnpm package:mac   # macOS
corepack pnpm package:linux # Linux
```

## Development

Requirements: Node.js 20+, Corepack and a platform-supported Electron environment.

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Quality checks:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
```

## Publishing updates

When you tell the release agent to release a new version, it can run the guarded release command below. The command requires a clean `main` branch, runs formatting, linting, type checking, tests and a production build, then creates and pushes the matching version tag.

```bash
corepack pnpm release patch
corepack pnpm release minor
corepack pnpm release major
corepack pnpm release 0.2.0
```

With protected `main`, prepare the new `package.json` version and changelog in a PR and obtain independent approval first. After merging and pulling `main`, publish that exact version (for example `corepack pnpm release 0.2.0`). The release command only tags the reviewed `origin/main` commit; it does not bypass review or push version changes directly to main. `patch`/`minor`/`major` indicate the next version to prepare and report that requirement when it is not yet merged.

Use `--dry-run` to validate the repository and release checks without changing files or pushing anything:

```bash
corepack pnpm release patch --dry-run
```

The `Publish release` workflow builds Windows, macOS and Linux artifacts and publishes a GitHub Release with the update manifests. Release tags must match the version in `package.json`.

Packaged clients check the repository releases when they launch. Use the refresh icon in the top bar or Settings → App updates → Check for updates to check again immediately. Windows and AppImage clients download updates and offer a restart action. This ad-hoc-signed Mac release shows a download link for newer versions; automatic Mac installation requires Apple Developer signing, which is not configured yet. Branch and pull request builds never publish releases.

## Project structure

```text
electron/                 Secure main process and preload bridge
src/shared/               Shared types, validation helpers and Markdown generation
src/renderer/             React application shell, workbench and Konva canvas
docs/                     Architecture, data format and troubleshooting
examples/example-project/ Example metadata-only project
.github/                  Issue templates, workflows and Dependabot
```

## User data format

An Imnota workspace is a folder selected by the user. Each project contains:

```text
My Project/
  project.json
  rounds/
    001-first-feedback/
      screenshots/
      annotations/
      notes/
      exports/
  exports/
```

`project.json` is versioned with `schemaVersion`. Annotations are JSON, notes are Markdown, and the original screenshots are never overwritten by the annotation layer. See [docs/data-format.md](docs/data-format.md).

Feedback rounds keep iterations separate inside a project. Create, rename, duplicate, archive or restore them from the screenshot panel. Copy/export uses the current round unless “Export all feedback rounds” is enabled in Context Builder. Existing version-1 projects retain their original files and a metadata backup when migrated.

Pan with Select on the image, Space-drag, middle-drag or trackpad scrolling. Pinch or Ctrl/Command-wheel zooms at the cursor. Use `0` to fit and `1` for actual size. Double-click text to edit; Enter saves, Shift+Enter adds a line, Escape cancels.

“Copy AI context” copies the Markdown and prepares annotated PNGs. Its attachment checklist offers individual image-copy actions and the export folder. Paste the text first, then paste or attach the images: copying an image replaces clipboard text, and target AI applications differ in attachment support.

## Privacy and security

Imnota does not require internet access for its core workflow. Imported project files are treated as untrusted data. IPC calls validate and constrain paths to the selected workspace. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Small, focused changes with useful tests are welcome.

## Licence

Imnota is released under the MIT licence. See [LICENSE](LICENSE).

Repository owner: Dytschgo  
Repository: https://github.com/Dytschgo/imnota
