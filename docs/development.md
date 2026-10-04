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

The 100-screenshot recovery correctness test in `electron/screenshot-transaction-adapter.test.ts` exercises 203 recovery entries and hundreds of flushed journal/live-file replacements. It retains the full real-filesystem workload and verifies every resulting file, with a 120-second limit on Windows and 30 seconds elsewhere. This is a bounded completion check, not an application save-latency target; it does not retry failures. The finite test-specific budget leaves suite-wide limits and fsync coverage unchanged. The historical 30-second Windows timeout did not identify a failing filesystem operation; its cause remains unknown, and a later pass does not establish hosted overhead as the cause.

Project-watch regression checks run with `corepack pnpm exec vitest run electron/project-watch.test.ts`. A local file write is registered with the watch as soon as its filesystem operation succeeds, before diagnostic completion logging. If another local write advances the expected revision during a watch read, the watcher checks the current marker and schedules that path for another debounced inspection when the read is stale. A later unmatched disk revision still produces an external-change event. On Linux, an additional non-recursive subscription to the project directory observes `project.json` after atomic replacement; the recursive subscription continues observing nested content. Both subscriptions share the existing debounce and revision checks, forward watch failures, and close together. The filesystem regression also holds a completed own-byte read across a later external write to check that stale reads cannot consume the later notification. When that event is legitimate, the app keeps unsaved edits and asks the user to reload and review the project; do not dismiss it or retry a save against the old revision automatically.

The separate `corepack pnpm test:share-contract` command keeps its 5-second contract-test deadline. Its test-only fixture owns directories, SQLite connections and HTTP servers, retains the actual async body independently of Vitest's timeout wrapper, and observes service-handler promises. Teardown has one 8-second bound within the existing 10-second hook limit; it removes fixture directories only after the body and service work settle and HTTP/SQLite close. An unresolved lifetime or close error fails teardown and retains remaining files for diagnosis. Do not retry deletion against a live database.

That command also runs lifecycle controls, including a bounded child with a deterministic 5.5-second upload barrier. The child must still **fail** at 5 seconds; the parent checks that cleanup introduces no early removal, EBUSY, ENOENT or unhandled failure, and that resources reach a closed terminal state. Child logs and synthetic retained fixtures use `imnota-share-lifetime-*` temporary paths. These controls cover the proven timeout-cleanup race; they do not identify the original hosted Windows timeout trigger. No production sharing behavior, fixture size, integrity assertion or CI routing is relaxed.

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

The standard macOS packaged onboarding walkthrough correlates its single native copy click with a new attempt ID and terminal result, rather than accepting the preceding success label. A pending attempt clears the previous copy status and warning. For **Copy files** and **Files + text**, `onboarding-copy-<attempt>-<action>.json` records exact ordered path comparisons, counts, Markdown equality/length, HTML/image state, and read-only pasteboard types/change counts before and after the read. Unrelated clipboard text is never retained; paths whose realpaths are outside the synthetic handoff are redacted. Paths through aliases into the handoff retain both the observed and resolved path for diagnosis, without relaxing the exact-path assertion. Pasteboard type names use a fixed native-format allowlist; unknown type names are replaced by a count. A change count difference fails the read-consistency check without recopying or waiting for matching content. CI, nightly and stable package jobs retain the standard Mac report and captures on failure as `mac-walkthrough-evidence-*`, outside publication asset patterns. Windows unit checks cannot replace the corrected candidate's packaged Mac walkthrough and focused bundle copy/paste gate.

## Installer verification

The quick installers resolve the stable tag once and verify the asset against
that release's `SHA256SUMS.txt` before extraction or execution. Missing, malformed,
duplicate or mismatching metadata stops installation before changing the previous
app. Linux stages the verified AppImage privately before replacement; temporary
downloads and staging are cleaned on exit. Checksums do not authenticate a
compromised release publisher. Failure inside a verified Windows installer
retains that installer's recovery behavior.

Linux replacement uses GNU `mv -fT` to replace the destination entry without
following a file or directory symlink; a hardlink peer keeps its previous bytes.
A directory occupying the destination causes refusal and staging cleanup. After
replacement, a desktop-file write failure leaves the verified binary installed;
there is no automatic Linux rollback. macOS retains its existing backup behavior
if copying a verified bundle fails.

Run `node --test scripts/install.test.mjs` for synthetic releases, hostile metadata
and download failures. The suite executes the real scripts with network and app
launch commands replaced. Git Bash on Windows exercises shell control flow; it
does not replace native Linux or macOS installation evidence. No fixture launches
a real installer or changes a personal installation.

Checksum refusal and interrupted-download fixtures run wherever Bash is available.
Linux replacement, symlink and hardlink fixtures run only on native Linux, where
GNU replacement semantics apply; they are excluded on BSD macOS and Git Bash.
Native macOS fixtures use `ditto` and `PlistBuddy` with generated bundles to check
successful installation, extraction/executable/signature/version refusal, and
backup preservation after copy failure. Signature results and app launches are
stubbed; these fixtures do not prove real signing or Gatekeeper acceptance.
PowerShell fixtures check the actual exception message separately from the
no-launch log, avoiding formatter-dependent wrapping. Windows also exercises
temporary junction cleanup without traversing its target. The existing Linux,
macOS and Windows CI jobs run these native boundaries; no workflow gate is removed.

## Recently deleted integration verification

`corepack pnpm exec vitest run src/renderer/app/useProjectPersistence.restore.test.tsx` exercises screenshot IPC, content persistence, atomic writes, the filesystem watcher and the mounted persistence hook against disposable projects. It covers metadata-last Restore warnings, changed/unreadable readback, typed write authority, queued metadata, member rollback and failed repair. Windows substitutes directory handles for POSIX sync faults; file writes and renames stay real. This does not substitute for supported-platform packaged verification.

On the exact built candidate, the existing `corepack pnpm smoke` / packaged verifier must still execute Recently deleted after Undo-toast expiry for all three kinds, actual restored focus, unsafe-list errors, exact restored/reopened member bytes, and composed history with two screenshots, two drawings and one Markdown item. Native fault-injected warning/adoption and renderer-crash/watch-outage sequences require separately recorded direct evidence; the ordinary smoke does not inject these faults. Keep these acceptance gaps open rather than inferring them from a general smoke pass. Do not launch while another verification task owns the native lease.

Stable-reader and duplicate-ownership regression checks run with `corepack pnpm exec vitest run electron/files.stable.test.ts electron/project-search.test.ts electron/recently-deleted.test.ts`. File identities use exact bigint device/inode values, and stable reads compare nanosecond timestamps; only a validated bounded file size becomes a Number for allocation. Public read results remain JSON-safe text and byte counts. The precision cases perform real renames, opens, reads and cleanup while projecting identity fields to both safe integers and adjacent 64-bit values that round to the same Number. They establish the conditional precision defect and its protection, not the cause of an earlier hosted failure without captured handle/path identities. A refused duplicate cleanup retains the incomplete directory for manual inspection; these checks do not provide a cross-process filesystem lock.
