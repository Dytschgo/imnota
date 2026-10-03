# Development

## Local setup

Use the repository's pinned pnpm workflow:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The dev command runs Vite, the Electron TypeScript watcher and Electron together. It waits for both `http://127.0.0.1:5173` and the compiled Electron entry point before launching the desktop app.

Some shells and parent tools set `ELECTRON_RUN_AS_NODE`. Passing that value to Electron makes the Electron executable behave like Node.js, so the desktop app never opens. `scripts/dev-electron.mjs` creates a copy of the inherited environment, removes only `ELECTRON_RUN_AS_NODE`, and launches Electron with inherited stdio. The `VITE_DEV_SERVER_URL` set by the dev command and every other environment value remain available to Electron. The helper forwards `SIGINT`, `SIGTERM` and `SIGHUP` to the child and mirrors Electron's exit code or signal.

Test the helper directly:

```bash
node --test scripts/dev-electron.test.mjs
```

## Quality checks

Before committing a source change, run the relevant checks:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

`tsconfig.electron.json` type-checks the Electron sources together with their tests; `tsconfig.electron.build.json` extends it and excludes `electron/**/*.test.ts`, so `build`, `dev`, and the `package:*` scripts emit only application code into `dist-electron` and the packaged asar. Package scripts and `test` invoke `tsc`, `vite`, and `node --test` directly rather than a nested `corepack pnpm`, which avoided a cold corepack resolution on every hosted Windows job.

For documentation-only changes, run Prettier against the owned Markdown files. Do not rewrite unrelated files merely to satisfy broad formatting output.

Nested Claude worktrees under `.claude/` are excluded from Git, ESLint and Vitest; Prettier follows `.gitignore`. Run checks from the intended checkout, not across another branch's nested working tree. The September 22 audit found 140 foreign test files being collected alongside the 125 files belonging to this checkout. With the policy regression test added, default discovery now collects 126 files. The platform command collects 73; `IMNOTA_FULL_PLATFORM_TESTS=1` restores the same 126-file set. These counts are a dated inventory, not a limit on new tests.

Vitest retains its default dependency/Git exclusions and also excludes generated `dist/`, `dist-electron/`, `release/`, `out/` and `coverage/` directories. The discovery regression test creates a temporary checkout and checks actual file collection, including a new source directory, so generated copies cannot run as source tests and new source tests remain included by default. ESLint excludes these generated directories too; Prettier follows `.gitignore`.

Manual macOS launch and cross-editor clipboard acceptance are separate checks; a Windows development launch or automated Electron clipboard test cannot establish either result.

Project-watch regression checks run with `corepack pnpm exec vitest run electron/project-watch.test.ts`. A local file write is registered with the watch as soon as its filesystem operation succeeds, before diagnostic completion logging. If another local write advances the expected revision during a watch read, the watcher checks the current marker and schedules that path for another debounced inspection when the read is stale. A later unmatched disk revision still produces an external-change event. When that event is legitimate, the app keeps unsaved edits and asks the user to reload and review the project; do not dismiss it or retry a save against the old revision automatically.

## Worktree maintenance

Create sibling worktrees from freshly fetched `origin/main`; run checks inside the intended checkout. Keep each task's branch and worktree identity in its PR. Before removing a completed checkout:

1. Inspect `git worktree list --porcelain` and `git -C <path> status --short`. Preserve tracked edits and untracked files, even when the branch is merged.
2. Inspect ignored files with `git -C <path> ls-files --others --ignored --exclude-standard --directory`. A clean status can still contain local fixtures, recovery data or verification evidence. Preserve those separately before removal; dependency and compiled-output directories can be regenerated.
3. Verify the exact checkout path and HEAD, then use `git merge-base --is-ancestor <head> origin/main` to establish that its commits are integrated. Squashed or diverged branches need separate review; branch age alone is not evidence.
4. Use `git worktree remove <path>` without `--force`. Retain branch pointers when their disposition is uncertain. Do not use broad recursive deletion or `git clean -fdx` as a worktree cleanup shortcut.

Keep local cleanup inventories and preserved evidence outside tracked source, for example in the common Git directory reported by `git rev-parse --git-common-dir`.

## Isolated native verification

Build first, then run the native workflow against disposable fixtures:

```powershell
corepack pnpm build
$env:IMNOTA_SMOKE_ARTIFACT_DIR = 'D:\Code\imnota\.git\imnota-verification-artifacts-local'
corepack pnpm smoke
```

Use a new absolute artifact path whose final directory starts with `imnota-smoke-artifacts-` or `imnota-verification-artifacts-`. Its parent must exist. Existing nonempty directories are rejected. Adjust the example to your checkout.

The runner removes `ELECTRON_RUN_AS_NODE`, creates an isolated Electron profile and temporary project fixtures, and validates cleanup targets. Do not substitute `pnpm dev` for this test: ordinary development uses the application's default profile.

Set `IMNOTA_SMOKE_MODE=stress` for mixed-resolution 1/10/20/100-screenshot fixtures and the complete 100-image export workflow. Use a new artifact directory for every run. Captures report CSS viewport size, device pixel ratio, and PNG dimensions separately. An OS-clamped viewport is a failure, not verified coverage.

For the actual workspace export process, run `corepack pnpm build`, then `corepack pnpm smoke:clipboard`. The focused mode skips onboarding and release notes, creates an isolated three-screenshot project, edits its description, and opens **Copy Bundle** from the top bar. It verifies multiple exported bundles, the current edit in the Markdown, truthful progress (no percentage while rendering, writing or copying), repeat-copy reuse of one export set, and a fresh export after another edit that keeps the earlier files. Every bundle card is copied with Rich copy and pasted into a test-only editable control through Chromium's native Paste command; the check inspects the trusted paste event's Markdown, HTML fragment and decoded image dimensions. Set `IMNOTA_SMOKE_ARTIFACT_DIR` to a new absolute `imnota-verification-artifacts-*` directory to keep the report, captures and `bundle-export-progress.json`. CI runs this mode against each packaged Windows, macOS and Linux build after the standard walkthrough and keeps its evidence as `clipboard-evidence-<os>`. External editor acceptance remains a separate check.

Native clipboard checks establish which formats Imnota wrote, not which formats an external editor accepts. Captured layouts still need visual inspection. Performance results apply to the tested machine and fixture, not every Windows or macOS device.

## Packaged MCP transport verification

The existing `scripts/verify-packaged.mjs windows|linux` and `scripts/verify-mac.sh` run the actual packaged executable with `--mcp` before the standard UI walkthrough. The separate clipboard pass does not repeat MCP. Windows uses `release/win-unpacked/Imnota.exe` from the same packaging operation (the portable launcher still receives the UI checks); macOS uses the executable from the extracted universal ZIP; Linux uses the executable extracted from the AppImage with the existing sandbox-helper policy.

For one focused run after packaging, invoke `node scripts/verify-mcp.mjs <absolute-packaged-executable> <source-distributable>`. Coordinate the local desktop lease even for this CLI check: Electron is a native process. `IMNOTA_EXPECT_VERSION` must match the candidate version; otherwise the repository package version is expected. No development Electron fallback exists. The runner imports compiled `emptyProject` and preference defaults only to construct synthetic input; protocol responses come exclusively from the packaged process.

The runner reuses the smoke harness's marked temporary directory and cleanup. It creates two fresh profiles and a synthetic workspace. The narrowly scoped `IMNOTA_MCP_VERIFY_PROFILE` bootstrap hook accepts only `mcp-enabled` or `mcp-disabled` immediately within a canonical temporary `imnota-smoke-result-*` directory carrying both the smoke marker and a matching random ownership nonce (`IMNOTA_MCP_VERIFY_OWNER`). This nonce identifies a disposable verification fixture, not MCP authentication. Profile/root aliases, linked or hardlinked markers/settings, nonabsolute targets, pre-existing profile caches, missing ownership, and settings selecting anything except that fixture's workspace are rejected before settings/diagnostics are accessed. No installed settings are read, copied or modified.

Before Electron's ready event, the hook redirects `appData`, `userData`, `sessionData`, logs and crash dumps to that validated profile using [`app.setPath`](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path). Smoke mode is absent: normal settings parsing and the normal local-access opt-in still decide whether stdio starts. The hook observes window creation and the MCP HTTP-listener state at EOF/refusal; it does not suppress windows or fabricate protocol responses. Without its two environment variables, bootstrap is unchanged.

The direct postconditions are initialize/version, tool discovery, collection/bundle discovery, saved Markdown and PNG equality for explicit/latest reads, bounded missing-export/unknown-id errors, byte-identical project/export trees and settings, refusal with access off, zero observed BrowserWindows/MCP HTTP listener, strict JSON-RPC stdout, and bounded EOF exit. Each launch has a 45-second deadline, a 1 MB synthetic stdout budget and a 64 KB stderr budget; no sleeps, replay or retries establish readiness. Failure terminates only the spawned child, with a bounded escalation; an unconfirmed exit retains the fixture rather than deleting a live profile. Application lifecycle evidence records packaged identity and actual paths. This is not an OS focus or Dock-visibility claim.

`release/imnota-verification-artifacts-mcp/mcp-verification.json` records responses, lifecycle, stderr, source revision, candidate/executable/asar SHA-256 and workspace hashes; CI retains it as `mcp-evidence-<platform>` outside publication asset patterns. Set `IMNOTA_MCP_ARTIFACT_DIR` to a fresh absolute `imnota-verification-artifacts-*` directory for another run. Existing nonempty evidence directories are rejected. Unit launcher fixtures test failure handling only; they do not establish packaged acceptance. Check the exact candidate report on all three supported OSes before closing that gate.
