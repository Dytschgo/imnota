# Imnota

Screenshots that AI understands.

Imnota is a local-first desktop tool for turning annotated screenshots into prompt bundles for AI assistants and coding agents. Add screenshots to a collection, mark what matters, add an optional description, and copy the generated Markdown and high-resolution prompt image into the tool you already use.

```text
Paste or import screenshots → Annotate → Describe → Copy prompt bundle
```

## Why local-first

Projects are plain folders containing JSON, Markdown and image files. There is no account, backend, cloud storage dependency, runtime AI service or telemetry by default. Your files stay on the device and can be copied, backed up or version-controlled directly.

## Features

- Electron, React and TypeScript desktop application
- Screenshot import, paste and drag-and-drop for PNG, JPEG and WebP
- Editable Konva annotation layer with arrows, lines, shapes, highlights, text, callouts, steps and sensitive-area masks
- Collections with archive/restore controls and a single optional overall context
- One optional Markdown description and Low, Medium or High agent priority per screenshot
- Direct include/exclude controls without deleting screenshots
- Undo and redo for annotation edits
- Timestamped Markdown + PNG prompt bundles for the current collection
- Automatic splitting for readable, clipboard-safe exports on a white background
- Screenshot deletion through the operating-system trash with Imnota-managed Undo recovery
- Light, dark, system and curated appearance settings
- First-run onboarding that can be replayed from Settings
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

The development launcher removes an inherited `ELECTRON_RUN_AS_NODE` value from the Electron child only. All other environment values, including `VITE_DEV_SERVER_URL`, are preserved. See [development notes](docs/development.md).

The collection/prompt workflow on this branch is under verification and has not been published by this implementation task. See the [implementation verification record](docs/implementation-verification.md) for completed checks and remaining acceptance work.

Quality checks:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
```

## Publishing updates

When you ask to release a new version, the guarded release command requires a clean, exact `origin/main` commit and an acceptance record for that version. The record includes feature checks, platform package/install checks, independent review and recovery guidance. Formatting, linting, type checking, tests and a production build must also pass before tagging. See [the release-readiness process](docs/release-readiness.md).

```bash
corepack pnpm release 0.3.0 --evidence .git/release-evidence.json
```

Prepare the new `package.json` version and changelog in a PR and obtain independent approval first. After merging and pulling main, collect evidence and publish that exact version; `0.3.0` above is an example, not an existing release. The release command does not push version changes directly to main. `patch`/`minor`/`major` identify the next version to prepare and report that requirement when it is not yet merged. This local guard is not a substitute for GitHub branch/tag protection.

Use `--dry-run` to validate the repository and release checks without changing files or pushing anything:

```bash
corepack pnpm release 0.3.0 --evidence .git/release-evidence.json --dry-run
```

The `Publish release` workflow builds Windows, macOS and Linux artifacts and publishes a GitHub Release with the update manifests. Release tags must match the version in `package.json`.

Packaged clients check the selected release channel when they launch. Use the refresh icon in the sidebar or Settings → App updates → Check for updates to check again. Choose **Stable (recommended)** or opt into **Nightly (preview)** in the same Settings section. Checks do not automatically download, install or downgrade. Installed Windows and AppImage clients offer download and restart actions. Portable Windows and Linux deb builds link to the selected release.

On macOS, **Run update in Terminal** starts the bundled installer for the selected version. Settings also shows the command with a copy button. The installer verifies the archive checksum and app signature before replacing the installed app, retains a backup, and reopens Imnota. Run the app from a writable Applications folder, rather than a mounted DMG. Terminal reports failures; the installer does not use `sudo` or remove macOS quarantine. Older builds need one manual installation to gain this update action.

Branch and pull request builds never publish releases. Nightly publication uses a manual, gated workflow on reviewed main commits; see [nightly build instructions](docs/nightly-builds.md).

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

An Imnota workspace is a folder selected by the user. Each project contains local, portable collection data:

```text
My Project/
  project.json
  collections/
    001-collection/
      screenshots/
      annotations/
      exports/
```

`project.json` is versioned with `schemaVersion`. Screenshot identity and order are stored separately from the editable title, description, priority and export visibility. Annotations remain JSON and source screenshots are never overwritten. See [the data format](docs/data-format.md).

Collections keep related screenshots together. New collections start empty, the newest collection remains active after export, and older collections can be archived and restored. Copy and export always use the current collection; there is no all-collection export mode.

Pan with Select on the image, Space-drag, middle-drag or trackpad scrolling. Pinch or Ctrl/Command-wheel zooms at the cursor. Use `0` to fit and `1` for actual size. Double-click text to edit; Enter saves, Shift+Enter adds a line, Escape cancels.

“Copy prompt bundle” creates a fresh timestamped PNG + Markdown set for the current collection. Imnota may split a large collection automatically; users do not choose split points. Excluded screenshots stay in the collection and are called out in Markdown, but do not appear in prompt PNGs or cause the remaining Picture numbers to change.

Combined clipboard copy offers the matching Markdown and PNG together, but the receiving editor decides which clipboard formats it accepts. Imnota cannot promise that both will arrive in one paste. Use **Copy Markdown only**, **Copy image only**, or open the generated files/folder when a target accepts only one format. See the [user guide](docs/user-guide.md).

## Privacy and security

Imnota does not require internet access for its core workflow. It has no account, cloud sync or built-in AI provider connection. Imported project files are treated as untrusted data. IPC calls validate and constrain paths to the selected workspace. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Small, focused changes with useful tests are welcome.

## Licence

Imnota is released under the MIT licence. See [LICENSE](LICENSE).

Repository owner: Dytschgo  
Repository: https://github.com/Dytschgo/imnota
