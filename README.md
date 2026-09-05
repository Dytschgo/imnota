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

Download a release artifact for your platform, or build from source:

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

Use `--dry-run` to validate the repository and release checks without changing files or pushing anything:

```bash
corepack pnpm release patch --dry-run
```

The `Publish release` workflow builds Windows, macOS and Linux artifacts and publishes a GitHub Release with the update manifests. Release tags must match the version in `package.json`.

Packaged clients check the repository releases when they launch, download newer versions in the background and offer a restart action. Branch and pull request builds never publish artifacts.

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
  screenshots/
  annotations/
  notes/
  exports/
```

`project.json` is versioned with `schemaVersion`. Annotations are JSON, notes are Markdown, and the original screenshots are never overwritten by the annotation layer. See [docs/data-format.md](docs/data-format.md).

## Privacy and security

Imnota does not require internet access for its core workflow. Imported project files are treated as untrusted data. IPC calls validate and constrain paths to the selected workspace. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Small, focused changes with useful tests are welcome.

## Licence

Imnota is released under the MIT licence. See [LICENSE](LICENSE).

Repository owner: Dytschgo  
Repository: https://github.com/Dytschgo/imnota
