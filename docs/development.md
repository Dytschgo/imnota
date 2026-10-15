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

`format:check` checks the repository except the generated `pnpm-lock.yaml` and `share-service/package-lock.json` files, which are excluded in `.prettierignore`.

Nested Claude worktrees under `.claude/` are excluded from Git, ESLint and Vitest; Prettier follows `.gitignore`. Run checks from the intended checkout, not across another branch's nested working tree. The September 22 audit found 140 foreign test files being collected alongside the 125 files belonging to this checkout. With the policy regression test added, default discovery now collects 126 files. The platform command collects 73; `IMNOTA_FULL_PLATFORM_TESTS=1` restores the same 126-file set. These counts are a dated inventory, not a limit on new tests.

Vitest retains its default dependency/Git exclusions and also excludes generated `dist/`, `dist-electron/`, `release/`, `out/` and `coverage/` directories. The discovery regression test creates a temporary checkout and checks actual file collection, including a new source directory, so generated copies cannot run as source tests and new source tests remain included by default. ESLint excludes these generated directories too; Prettier follows `.gitignore`.

Manual macOS launch and cross-editor clipboard acceptance are separate checks; a Windows development launch or automated Electron clipboard test cannot establish either result.

The 100-screenshot recovery correctness test in `electron/screenshot-transaction-adapter.test.ts` exercises 203 recovery entries and hundreds of flushed journal/live-file replacements. It retains the full real-filesystem workload and verifies every resulting file, with a 120-second limit on Windows and 30 seconds elsewhere. This is a bounded completion check, not an application save-latency target; it does not retry failures. The finite test-specific budget leaves suite-wide limits and fsync coverage unchanged. The historical 30-second Windows timeout did not identify a failing filesystem operation; its cause remains unknown, and a later pass does not establish hosted overhead as the cause.

Project-watch regression checks run with `corepack pnpm exec vitest run electron/project-watch.test.ts`. A local file write is registered with the watch as soon as its filesystem operation succeeds, before diagnostic completion logging. If another local write advances the expected revision during a watch read, the watcher checks the current marker and schedules that path for another debounced inspection when the read is stale. A later unmatched disk revision still produces an external-change event. On Linux, an additional non-recursive subscription to the project directory observes `project.json` after atomic replacement; the recursive subscription continues observing nested content. Both subscriptions share the existing debounce and revision checks, forward watch failures, and close together. The filesystem regression also holds a completed own-byte read across a later external write to check that stale reads cannot consume the later notification. When that event is legitimate, the app keeps unsaved edits and asks the user to reload and review the project; do not dismiss it or retry a save against the old revision automatically.

The separate `corepack pnpm test:share-contract` command keeps its 5-second contract-test deadline. Its test-only fixture owns directories, SQLite connections and HTTP servers, retains the actual async body independently of Vitest's timeout wrapper, and observes service-handler promises. Teardown has one 8-second bound within the existing 10-second hook limit; it removes fixture directories only after the body and service work settle and HTTP/SQLite close. An unresolved lifetime or close error fails teardown and retains remaining files for diagnosis. Do not retry deletion against a live database.

The socket-close lifecycle control waits for both real HTTP sockets to close while holding the async handler behind an explicit barrier. It injects a controlled clock only for teardown, checks that cleanup is still waiting at 39 ms, and advances to the unchanged 40 ms bound to verify retention. Releasing the handler afterward must still write to the real SQLite database without removing the retained files. Other contracts use the fixture's real clock and deadlines.

That command also runs lifecycle controls, including a bounded child whose real HTTP upload is held until Vitest signals its actual 5-second timeout. The child must still **fail** at 5 seconds; the parent checks that the upload then completes before fixture removal, cleanup introduces no EBUSY, ENOENT or unhandled failure, and resources reach a closed terminal state. This control uses one small real HTTP/SQLite upload so large split-upload processing cannot consume the teardown deadline; the separate oversized Unicode contract retains its full workload and byte assertions. Child logs and synthetic retained fixtures use `imnota-share-lifetime-*` temporary paths. These controls cover the proven timeout-cleanup race; they do not identify the original hosted Windows timeout trigger. No production sharing behavior, integrity assertion or CI routing is relaxed.

## Worktree maintenance

Create sibling worktrees from freshly fetched `origin/main`; run checks inside the intended checkout. Keep each task's branch and worktree identity in its PR. Before removing a completed checkout:

1. Inspect `git worktree list --porcelain` and `git -C <path> status --short`. Preserve tracked edits and untracked files, even when the branch is merged.
2. Inspect ignored files with `git -C <path> ls-files --others --ignored --exclude-standard --directory`. A clean status can still contain local fixtures, recovery data or verification evidence. Preserve those separately before removal; dependency and compiled-output directories can be regenerated.
3. Verify the exact checkout path and HEAD, then use `git merge-base --is-ancestor <head> origin/main` to establish that its commits are integrated. Squashed or diverged branches need separate review; branch age alone is not evidence.
4. Use `git worktree remove <path>` without `--force`. Retain branch pointers when their disposition is uncertain. Do not use broad recursive deletion or `git clean -fdx` as a worktree cleanup shortcut.

Keep local cleanup inventories and preserved evidence outside tracked source, for example in the common Git directory reported by `git rev-parse --git-common-dir`.

## Isolated native verification

Build first, then run the native workflow against disposable fixtures:

Native locator waits observe renderer DOM and focus changes, with animation frames covering layout-only changes, under one unchanged operation deadline that includes renderer execution. DOM/focus observation also works when an unpresented window does not receive frames. They do not repeat failed evaluations. Artifact capture separately waits for annotation-canvas loading state to clear and a decoded Konva canvas to exist before the existing font/image decoding and compositor pixel-stability checks. Capture keeps observing the selected screenshot and canvas stage while comparing frames. A loading state, missing canvas, changed screenshot/dimensions, or replacement stage discards the compared frames and waits for the original screenshot before starting a new sequence under the same capture deadline. Capture accepts an explicit screenshot expectation (identity and dimensions) or an `annotation-canvas` requirement that waits even when the canvas is initially absent; the latter supports onboarding without a rail entry and post-crop dimensions. Calls without either retain annotation-canvas inference, so selected text and drawing items keep their font/image and pixel-stability checks without requiring an annotation canvas. Every capture in `smoke-workflow.ts` must declare a requirement or appear in the tested canvas-free allowlist. Captures that settle after readiness restarts record the restart count and reasons in the report artifact; capture timeout errors include the same diagnostics. An image-load failure or stalled renderer fails verification with the locator or artifact name; stable loading-placeholder pixels cannot satisfy capture readiness.

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

## Packaged MCP transport verification

The existing `scripts/verify-packaged.mjs windows|linux` and `scripts/verify-mac.sh` run the actual packaged executable with `--mcp` before the standard UI walkthrough. The separate clipboard pass does not repeat MCP. Windows imports `launchWindowsMcp` from the packaged `resources/imnota-mcp.mjs` and launches `release/win-unpacked/Imnota.exe` through that production relay path from the same packaging operation (the portable launcher still receives the UI checks); macOS uses the executable from the extracted universal ZIP; Linux uses the executable extracted from the AppImage with the existing sandbox-helper policy.

The Node walkthrough launchers handle `SIGINT` and `SIGTERM` asynchronously and fail cancellation. Windows terminates the owned child tree with `taskkill /T /F /PID`; POSIX launches an isolated process group, forwards the signal and forces any remaining members to stop after one second. The packaged wrapper allows five seconds for nested launchers to clean up their own groups. Ordinary walkthrough deadlines, report validation and retained artifacts remain unchanged. Run `node --test scripts/smoke-process.node.test.mjs` for the focused cancellation control; it uses IPC to emit the launcher's real signal event consistently on Windows, macOS and Linux.

For one focused run after packaging, invoke `node scripts/verify-mcp.mjs <absolute-packaged-executable> <source-distributable>`. Coordinate the local desktop lease even for this CLI check: Electron is a native process. `IMNOTA_EXPECT_VERSION` must match the candidate version; otherwise the repository package version is expected. No development Electron fallback exists. The runner imports compiled `emptyProject` and preference defaults only to construct synthetic input; protocol responses come exclusively from the packaged process.

The runner reuses the smoke harness's marked temporary directory and cleanup. It creates two fresh profiles and a synthetic workspace. The narrowly scoped `IMNOTA_MCP_VERIFY_PROFILE` bootstrap hook accepts only `mcp-enabled` or `mcp-disabled` immediately within a canonical temporary `imnota-smoke-result-*` directory carrying both the smoke marker and a matching random ownership nonce (`IMNOTA_MCP_VERIFY_OWNER`). This nonce identifies a disposable verification fixture, not MCP authentication. Profile/root aliases, linked or hardlinked markers/settings, nonabsolute targets, pre-existing profile caches, missing ownership, and settings selecting anything except that fixture's workspace are rejected before settings/diagnostics are accessed. No installed settings are read, copied or modified.

Before Electron's ready event, the hook redirects `appData`, `userData`, `sessionData`, logs and crash dumps to that validated profile using [`app.setPath`](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path). Smoke mode is absent: normal settings parsing and the normal local-access opt-in still decide whether stdio starts. The hook observes window creation and the MCP HTTP-listener state at EOF/refusal; it does not suppress windows or fabricate protocol responses. Without its two environment variables, bootstrap is unchanged.

The direct postconditions are initialize/version, tool discovery, collection/bundle discovery, saved Markdown and PNG equality for explicit/latest reads, bounded missing-export/unknown-id errors, byte-identical project/export trees and settings, refusal with access off, zero observed BrowserWindows/MCP HTTP listener, strict JSON-RPC stdout, and bounded EOF exit. Each launch has a 45-second deadline, a 1 MB synthetic stdout budget and a 64 KB stderr budget; no sleeps, replay or retries establish readiness. Failure terminates only the spawned child, with a bounded escalation; every failed launch retains its marked fixture and any diagnostics, including after a confirmed exit. An unconfirmed exit never triggers profile cleanup. Application lifecycle evidence records packaged identity and actual paths. This is not an OS focus or Dock-visibility claim.

`release/imnota-verification-artifacts-mcp/mcp-verification.json` records responses, lifecycle, stderr, the first 64 KB of literal stdout as hexadecimal (with a truncation flag), source revision, candidate/executable/asar SHA-256 and workspace hashes; on Windows it also records the external client Node executable and version. CI retains it as `mcp-evidence-<platform>` outside publication asset patterns. Windows package jobs set `IMNOTA_MCP_CLIENT_NODE` to Node 24 for the external relay command while keeping Node 22 for the build and verifier. For a local packaged run, set that variable to an absolute Node 24-or-later executable to exercise the documented client runtime; an unset variable uses the verifier's Node executable. Set `IMNOTA_MCP_ARTIFACT_DIR` to a fresh absolute `imnota-verification-artifacts-*` directory for another run. Existing nonempty evidence directories are rejected. Unit launcher fixtures test failure handling only; they do not establish packaged acceptance. On failure it also captures the bounded lifecycle file when available before preserving the fixture. The report names the retained root for diagnosis; cleanup must use the existing marker-checked helper after confirming process exit. Check the exact candidate report on all three supported OSes before closing that gate.

The Windows client requires Node.js 24+ and the installed relay; see the [Windows stdio launch contract](agent-access.md#windows-stdio-launch-contract). The verifier imports the bundled launch function so it owns the actual server ChildProcess and can terminate that exact child on a deadline. It also runs external Node with the bundled relay as its sole argument against a second pair of disposable OFF/ON profiles. That pass covers the installed command's executable resolution, initialize/discovery, exact Markdown/PNG reads, strict client stdout and stdin EOF. A private IPC channel reports spawn/close from the relay's exact server ChildProcess; the verifier requires both server and outer-process closure and routes deadline cleanup through the relay. Missing closure evidence fails and retains fixtures. Node child fixtures cover forwarding, deadline cleanup and missing closure evidence without launching Imnota. The report names and hashes the bundled relay, records both raw server and client-facing stdout counts, and requires exactly two additional raw bytes (`0d0a`) for the inner Windows launch; the external command must emit only JSON-RPC bytes. It never weakens the direct JSON-RPC parser. macOS/Linux remain direct. Fresh packaged Windows acceptance and independent review are still required; the two diagnostic OFF probes establish the old bootstrap prefix only, not enabled input or a corrected package.

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
there is no automatic Linux rollback. The macOS quick installer keeps its previous
app at `.imnota-install.*/previous-Imnota.app` inside the installation folder.
The Terminal updater instead keeps it at `.imnota-backups.noindex/.rollback-<pid>.app`
inside that folder, with separate `.imnota-update.*` staging. Both Mac paths ask a running Imnota to quit
before replacement. Both use a single 60-second wall-clock deadline that includes
the quit request. AppleScript has a five-second event timeout, and a separate
watchdog signals the request sender only when one process snapshot confirms a
live `/usr/bin/osascript` child of the installer, separately before TERM and KILL.
Bash may reap that child before explicit `wait`, so its recorded PID alone is not
ownership. An unverified sender is left alone; a blocked request aborts
without replacing anything. Copy, installed-bundle verification, open-command
or replacement-observation failure attempts to restore the previous app.
Rollback first enumerates replacement-owned processes (including helpers) using
`/bin/ps`, requests quit for that exact bundle, and waits before sending TERM only
to PIDs whose executable and live state are verified together in one snapshot
inside its physical bundle. macOS has no pidfds: a residual kernel-level race
between the final check and signal remains; keep that window minimal. Shutdown
has one 10-second deadline; failed process inspection or an unconfirmed stop keeps
the failed replacement at the reported staging path while restoring the old app.
Quit that remaining process before reopening the restored app. No unverified PID
is signaled. Successful verification and bounded replacement observation commit the replacement
and remove the temporary rollback. If restoration itself fails, the previous app
is preserved at its rollback location above and the actual path is reported.
If replacement shutdown cannot be confirmed, the quick installer preserves it at
`.imnota-install.*/failed-Imnota.app`; the updater uses
`.imnota-update.*/failed-Imnota.app`. If moving it aside fails, it remains at
`Imnota.app` and the previous app stays at its reported rollback location. All
these paths are relative to the verified physical installation folder. Both Mac install
paths use `.imnota-update.lock` to avoid retiring another live transaction's backup.
An interrupted lock is left for manual removal after confirming no installer is running.

Both standalone scripts use `wait_for_replacement`: for up to 30 seconds, poll
`/usr/bin/pgrep -x Imnota`, then a combined `/bin/ps -ww -o stat=,comm=`
snapshot for each candidate, with an exact main-executable check. Require
the executable to be exactly the installed physical bundle's `Contents/MacOS/Imnota`
(with no executable or parent symlink), and require a non-zombie process.
Process inspection failures report an explicit `/bin/ps` error. The same
PID must satisfy those checks on two polls at least one second apart. If an observed
PID exits before confirmation, fail immediately; if none qualifies by the deadline,
fail and restore. The one-second sleep is a polling interval, not a success criterion.
This establishes replacement-process readiness, not renderer/UI health or a runtime
version handshake. The updater separately validates the installed release version;
`ps` does not report the version running inside Electron.

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
automatic restoration after copy failure. Portable synthetic bundle fixtures also
cover final signature/executable failure, interrupted replacement, failed restoration,
repeat installs, legacy cleanup and unrelated-bundle preservation. Signature results, process observations and app launches are
stubbed; these fixtures do not prove real signing or Gatekeeper acceptance. The
readiness regressions use a virtual clock, covering refused quit, successful quit,
accepted launch without a replacement, early exit, wrong executable path and zombies.
`node --test scripts/installer-lifecycle.test.mjs` additionally exercises both standalone
scripts for missing/failing process inspection, blocked quit senders, graceful
rollback shutdown, verified TERM, reused PIDs, and preservation when shutdown cannot
be confirmed. Its process snapshots and deadlines are synthetic.
PowerShell fixtures check the actual exception message separately from the
no-launch log, avoiding formatter-dependent wrapping. Windows also exercises
temporary junction cleanup without traversing its target. The existing Linux,
macOS and Windows CI jobs run these native boundaries; no workflow gate is removed.

### Native macOS installer transactions

The macOS package CI job runs `scripts/install.native-mac.test.mjs` after verifying the built archive and before uploading artifacts. To repeat locally, close Imnota first, then run:

```bash
IMNOTA_NATIVE_MAC_ARCHIVE="$PWD/release/Imnota-$(node -p "require('./package.json').version")-universal-mac.zip" node --test scripts/install.native-mac.test.mjs
```

The archive path must be absolute. The harness asserts that every referenced absolute macOS tool path exists and is executable, including `/bin/ps`. Without that variable, or outside macOS, this suite skips. It uses system `/bin/bash` 3.2 and a temporary physical HOME, generates SHA256SUMS for the local ZIP, and sources the real installer/updater with only their download transport redirected to fixture files. There is no production environment override and no GitHub release access. `ditto`, `PlistBuddy`, `codesign`, `lipo` and filesystem commands run natively. Copy/rename failures are injected after or instead of the selected operation; installed-signature failures corrupt the replacement and use real codesign rejection. The final `open` is stubbed, including accepted launch without a process and an early-exiting process. After the real installed-signature check, this stub replaces only the disposable fixture's `Contents/MacOS/Imnota` with a copy of `/bin/sleep` and launches it from that new bundle path. Thus macOS `pgrep`, `ps`, process state/path observation and the production readiness deadline run for real, while Electron/GUI startup is simulated; the fixture's executable after launch is no longer the signed archive executable. Successful fixtures must report replacement observation and a real installed-signature verification before each executable substitution; the mutated stand-in is never checked as a signed archive executable. Running-app quit/refusal fixtures use the same synthetic executable in the old bundle, with `osascript` substituted to terminate only that exact fixture PID, refuse, or block until the production watchdog terminates the sender; no personal application receives a quit request. Teardown validates numeric PIDs, checks their executable ownership with `/bin/ps`, sends TERM through `process.kill`, and polls for exit with argument-array `spawnSync` calls; it runs no cleanup shell. GUI launch, Gatekeeper, runtime version and architecture-specific machine acceptance remain manual checks.

Assertions cover scratch/repeat installs, verified legacy and managed backup retirement, unidentified apps and unrelated look-alikes, symlinked parents/candidates/managed roots, copy/verification/open/readiness failure restoration, graceful quit, refusal and a blocked quit sender before replacement, rollback after a replacement has actually started, stale rollback collisions, interruption immediately after rename, failed restoration diagnostics, and overlapping live install/update processes in both directions. The harness refuses to run while an Imnota process is running so it cannot ask a personal app to quit.

### Installer and updater storage audit

Source audit against `electron-updater` 6.8.9 and `electron-builder` 26.15.3; packaged outcomes still require the native walkthrough below. `package.json` publishes to GitHub with macOS DMG/zip, Windows NSIS/portable and Linux AppImage/deb targets. `electron/main.ts:configureAutoUpdates` disables automatic downloads and installation on quit. macOS uses the bundled Terminal helper, Windows portable and Linux non-AppImage builds use manual downloads; only Windows NSIS and Linux AppImage use `prepareNativeUpdate` and electron-updater installation.

| OS/path                        | Before this change, after success                                                                                                   | After this change, after success                                                                                          | Source evidence                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS quick installer          | One new timestamped `~/Applications/Imnota-backup-*.app` per replacement; download temp removed                                     | Installed app only, with transaction staging removed; identified legacy and managed backups retired                       | `scripts/install.sh` Darwin branch, `cleanup`, `cleanup_previous_backups`                                                                                               |
| macOS Terminal update          | One hidden managed rollback retained; legacy backups retired                                                                        | Rollback bundles removed after final signature check and replacement-process observation; empty managed directory removed | `scripts/update-macos.sh:swap_and_launch`, `cleanup_rollback_backups`, `cleanup_legacy_backups`, `cleanup`                                                              |
| Windows quick installer / NSIS | Download temp removed; NSIS stores one reusable `installer.exe` in `%LOCALAPPDATA%/imnota-updater`                                  | Unchanged; no timestamped app backup history                                                                              | `scripts/install.ps1` finally block; builder `templates/nsis/include/installer.nsh:installApplicationFiles` and `APP_INSTALLER_STORE_FILE`                              |
| Windows native update          | That reusable installer plus `pending/<installer>`, `pending/update-info.json` and differential `current.blockmap` files can remain | Unchanged; intentional cache, not one app copy per version                                                                | updater `NsisUpdater.doInstall`, `AppUpdater.executeDownload`; `DownloadedUpdateHelper.getValidCachedUpdateFile` empties pending when the next release checksum differs |
| Linux quick installer          | One `~/.local/bin/imnota`, a desktop entry; download and same-folder staging removed                                                | Unchanged; no app backup history                                                                                          | `scripts/install.sh` Linux branch (`mv -fT`) and `cleanup`                                                                                                              |
| Linux native AppImage update   | Old AppImage unlinked, downloaded file moved into place; pending metadata can remain                                                | Unchanged; no app backup history                                                                                          | updater `AppImageUpdater.doInstall`; `DownloadedUpdateHelper.getValidCachedUpdateFile`                                                                                  |

Updater `AppAdapter.getAppCacheDir`, `AppUpdater.getOrCreateDownloadHelper`, and builder `appInfo.updaterCacheDirName` select `%LOCALAPPDATA%/imnota-updater`, `~/Library/Caches/imnota-updater`, or `${XDG_CACHE_HOME:-~/.cache}/imnota-updater`. The current macOS path does not call `MacUpdater` or create its `update.zip` cache. Legacy native-Mac caches are not inspected or deleted. Windows cache storage uses fixed names plus one pending generation, rather than accumulating versioned app backups; retain it for differential download/retry behavior. Failed cleanup, interrupted downloads, or older versions may leave extra files; their installed state is unverified here.

Separately, `electron/terminal-update.ts:prepareTerminalUpdate` leaves small helper/launcher directories named `imnota-update-*` under `app.getPath('temp')` when preparing a command. These are not app bundles or rollback storage and remain outside this app-backup fix. Manually downloaded installers/DMGs, package-manager caches, project snapshots and OS-managed caches also have separate ownership.

Mac backup retirement requires both a recognized name and `CFBundleIdentifier=com.dytschgo.imnota`. Symlink bundles/managed roots, unknown names, unreadable identifiers and other bundle identifiers are preserved. An occupied managed root is removed only if empty. Cleanup is best effort after commit; it cannot trigger rollback of the verified app. Before commit, failures leave existing legacy backups untouched and attempt to restore only the transaction's previous app. A failed restore preserves that app at the reported path; it may require a manual move back before use. SIGKILL/power loss cannot run traps: preserve any transaction directory and recover its previous bundle before removing the stale lock.

Before shipping, obtain independent review and run native walkthroughs: repeat the quick Mac installation and Terminal update with a real packaged candidate, verify signatures/launch, inject copy/final-verification/launch failures, and inspect the installation folder and unrelated look-alikes. Run the packaged-zip updater test and the native transaction harness on macOS. On Windows repeat NSIS installation/native update and inspect `%LOCALAPPDATA%/imnota-updater`; on Linux repeat quick/AppImage updates and inspect the app directory and updater cache. Source inspection and Git Bash fixtures do not establish those packaged postconditions.

## Recently deleted integration verification

The shared modal contains programmatic focus as well as Tab navigation. Restoring
an item selects its background editor; a drawing's delayed Excalidraw autofocus
must leave focus on the restore status inside the still-open dialog. Run
`corepack pnpm exec vitest run src/renderer/collection/RecentlyDeleted.test.tsx src/renderer/components/ui.test.tsx`
for deterministic editor loads before and after the announcement, repeated
restores, stacked/hidden dialogs, Tab from the status and focus return on close.
Modal tab stops exclude unavailable controls, including the actions inside closed
shared-link history. `src/renderer/export/HostedShareDialog.test.tsx` verifies the
real history component's forward/backward wrap. The packaged smoke also sends
native Tab through a synthetic matching history structure in the hosted-share
dialog, both collapsed and expanded, without creating or uploading a share.
The packaged mixed-content smoke retains its existing status-and-focus assertion
and five-second deadline; renderer tests do not substitute for the macOS package
job on the PR's exact revision.

`corepack pnpm exec vitest run src/renderer/app/useProjectPersistence.restore` exercises screenshot IPC, content persistence, atomic writes, the filesystem watcher and the mounted persistence hook against disposable projects. It covers metadata-last Restore warnings, changed/unreadable readback, typed write authority, queued metadata, member rollback and failed repair. Windows substitutes directory handles for POSIX sync faults; file writes and renames stay real. This does not substitute for supported-platform packaged verification.

On the exact built candidate, the existing `corepack pnpm smoke` / packaged verifier must still execute Recently deleted after Undo-toast expiry for all three kinds, actual restored focus, unsafe-list errors, exact restored/reopened member bytes, and composed history with two screenshots, two drawings and one Markdown item. Native fault-injected warning/adoption and renderer-crash/watch-outage sequences require separately recorded direct evidence; the ordinary smoke does not inject these faults. Keep these acceptance gaps open rather than inferring them from a general smoke pass. Do not launch while another verification task owns the native lease.

Stable-reader and duplicate-ownership regression checks run with `corepack pnpm exec vitest run electron/files.stable.test.ts electron/project-search.test.ts electron/recently-deleted.test.ts`. File identities use exact bigint device/inode values, and stable reads compare nanosecond timestamps; only a validated bounded file size becomes a Number for allocation. Public read results remain JSON-safe text and byte counts. The precision cases perform real renames, opens, reads and cleanup while projecting identity fields to both safe integers and adjacent 64-bit values that round to the same Number. They establish the conditional precision defect and its protection, not the cause of an earlier hosted failure without captured handle/path identities. A refused duplicate cleanup retains the incomplete directory for manual inspection; these checks do not provide a cross-process filesystem lock.

Created-file rollback checks run with `corepack pnpm exec vitest run electron/created-file-cleanup.test.ts electron/screenshot-created-files.test.ts electron/files.test.ts electron/application-persistence.test.ts --no-file-parallelism`. They use disposable real files with deterministic interleavings between rename and evidence delivery, after successful writes, and during rollback reads. The same-length edit regression restores an exactly representable native mtime and proves device/inode/size/mtime still match; before the content-hash fix, the pre-capture interleaving deleted the edited file on Windows. Independent `mtimeNs`/`ctimeNs` projections hold bigint milliseconds equal while changing nanoseconds; another projection leaves all metadata unchanged to isolate content verification. Tests also cover identical-byte rewrites, foreign replacement (including identical bytes), growth, unavailable evidence/read failures, unchanged-file deletion, and committed-project preservation.

The atomic writer snapshots and SHA-256 hashes the exact write bytes in memory and samples its flushed candidate descriptor before rename. It closes the writer before rename and needs no witness descriptor or post-rename timestamp sample. Fsync, replacement, queueing and directory durability handling remain in place, including for callers not capturing evidence. Rollback reads only after device/inode/size match, uses a fixed 64 KiB hashing buffer plus an EOF sentinel, validates stable descriptor/path samples including nanosecond timestamps, then checks the hash immediately before unlink with no intervening I/O. Node has no conditional unlink: an edit/replacement after the last content read/check can still be deleted. Evidence/read failures preserve the successful write for manual inspection. Duplicate's full image buffer and private write snapshot are not bounded by an existing import byte limit; capture/clipboard limits do not apply to arbitrary imported images. See [implementation status](implementation-plan.md) for the source-metadata and memory tradeoffs. These checks need native Windows, macOS and Linux runs; simulated timestamps and slash variants do not establish other platforms' native filesystem behaviour.
