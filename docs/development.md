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

ESLint also excludes the generated `out/` directory, matching its existing Git/formatting exclusion. Local design-harness output there must not become an input to source linting.

Manual macOS launch and cross-editor clipboard acceptance are separate checks; a Windows development launch or automated Electron clipboard test cannot establish either result.

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

Native clipboard checks establish which formats Imnota wrote, not which formats an external editor accepts. Captured layouts still need visual inspection. Performance results apply to the tested machine and fixture, not every Windows or macOS device.
