# Engineering follow-up plan — 2026-09-18

Status: Phase 0 housekeeping is complete in this repository. Phases 1–3 remain proposal-only; each item needs its own decision and its own PR. This document complements [the feedback follow-up plan](follow-up-plan-20260918.md), which covers product-facing items from the feedback round. It covers the codebase itself: structure, tests, evidence and housekeeping.

Historical baseline for measurements below: `main` at `36ff189` (2026-09-18), when PRs #72–#76 were open. It is not a statement about the current branch.

Principles, taken from [AGENTS.md](../AGENTS.md):

- One reviewable outcome per PR; mechanical moves separate from behaviour changes.
- No refactor as a prerequisite for a fix. Extract when the next fix in that area needs the boundary.
- Persistence, recovery, migration and release paths are consequential: they get independent review and are not touched by mechanical moves in this plan.

## Phase 0 — Housekeeping (completed)

### 0.1 Move finished root-level plans into `docs/` — completed

Why: 11 Markdown files sit in the repository root. Five are dated execution plans (`Dependency-Migration-Plan.md`, `Nightly-UI-Merge-Plan.md`, `UI-Improvemnts.md`, `appUIoverhaul.md`, `implementation plan.md`) that may belong with historical records once their delivery and release status are verified. Every agent session pays context cost for them; filenames with spaces require quoting in shell commands.

Outcome: the four completed execution records now live under [`docs/history`](history/README.md), with corrected descriptive filenames. The living status document is [`docs/implementation-plan.md`](implementation-plan.md), not history, because it contains current release status and open acceptance work. Root-level policy, contribution, security and release files remain in place.

Verification: documentation tier — Prettier and link checks cover the moved files and current references.

### 0.2 Keep local worktree maintenance out of this plan

Why: worktrees, branches and stashes are local to each clone and can contain another person's uncommitted work. They are not a repository delivery phase.

What: when separately authorized, inventory first and work on one explicitly identified worktree at a time:

```bash
git worktree prune
git worktree list --porcelain
git branch --merged origin/main --format='%(refname:short)'
```

For each proposed worktree, first confirm its absolute path and branch identity from the inventory, then run `git -C <worktree-path> status --short`. Stop when it is not clean or its identity is unclear. Only after confirming that its branch is merged and the worktree is clean, run `git worktree remove <worktree-path>` without `--force`; then use `git branch -d <branch>`. Do not drop or apply stashes as part of this maintenance; inspect them separately and preserve them until their owner decides.

When: not scheduled by this plan.

### 0.3 Add `docs/README.md` as the index — completed

The index now separates living guidance, proposal-only plans, historical records and the separately deployed sharing service, so agents can identify the authoritative document before acting.

## Phase 1 — Evidence for the things users actually reported (next nightly)

### 1.1 Capture display matrix document and a runnable native check

Why: #72 fixes overlay placement based on Electron's documented Windows fullscreen behaviour, not on a two-display observation. The synthetic smoke (`IMNOTA_SMOKE_CAPTURE_SOURCE=synthetic`) exercises the basic pipeline with synthetic pixels on the host's real display; it does not prove multi-display placement, scaling or crop correctness.

What (proposed matrix and probe outline):

1. `docs/capture-display-matrix.md` with the grid (arrangement × scaling × entry point × pointer display × outcome), one table per OS, filled per nightly build.
2. A `smoke:capture` script that starts the packaged app with the real capture path and prints the values the matrix needs, so the human only has to move the pointer and press keys:

```ts
// electron/capture-smoke.ts — add to the existing real-capture probe
const cursor = screen.getCursorScreenPoint();
const target = screen.getDisplayNearestPoint(cursor);
console.log(
  JSON.stringify({
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    })),
    pointer: cursor,
    targetDisplay: target.id,
    overlayBounds: overlay.getContentBounds(), // after `capture-overlay:ready`
    covers: overlayCoversDisplay(overlay.getContentBounds(), target.bounds),
  }),
);
```

3. `docs/nightly-verification-audit.md` links the matrix and states that capture changes are not promoted without a filled row per OS.

Use a disposable or synthetic desktop scene, or obtain authorization for any real content that may enter the capture. Captured pixels remain local and must not be included in the matrix record.

When: before the nightly that carries #72. Decides items 2.1 and 2.2 of the feedback follow-up plan.

Verification: filesystem/native tier — run on Windows with two displays and on macOS; Linux is not applicable.

### 1.2 Clipboard receiver matrix run on Windows

Why: `docs/clipboard-receiver-matrix.md` has every Windows cell at "testing". #76 makes Imnota report what the clipboard holds, but only a real paste into Cursor, VS Code, a browser assistant and a native Markdown editor answers the user's question.

What: no code. Run the matrix on the nightly that carries #76, record Windows build, Imnota revision, receiving app version, and whether the card warning matched what the receiver pasted.

When: same nightly as 1.1.

## Phase 2 — Structural extractions, driven by the areas the feedback touched (next 2–3 weeks)

Each item is one mechanical-move PR followed, only if needed, by a behaviour PR. Extraction order follows the areas most likely to be touched again.

### 2.1 `electron/main.ts`: extract the capture workflow

Why: The capture workflow (`captureService`, `chooseCaptureRegion`, `settleCaptureOverlay`, `failCaptureOverlay`, `insertCapturedPng`, the `workflow:capture:region` handler and the `capture-overlay:*` handlers) is the area with the most open questions (display matrix, tolerance, global shortcut). It already has pure helper modules around it (`capture-service`, `capture-overlay-session`, `capture-overlay-placement`, `capture-admission`) but the orchestration is still inline.

What (illustrative boundary sketch only; an implementation must retain the existing capture admission guards, project/session liveness checks and IPC validation): new `electron/capture-workflow.ts` exporting a factory that receives its dependencies instead of reaching for module-level state:

```ts
// electron/capture-workflow.ts
export interface CaptureWorkflowDependencies {
  mainWindow(): BrowserWindow | null;
  captureService(): CaptureService;
  overlayEntry(): { devUrl?: string; file: string; preload: string };
  readProjectMetadata(projectPath: string): Promise<ProjectData>;
  insertPng(
    projectPath: string,
    collectionId: string,
    png: Buffer,
    assertLive: () => void,
  ): Promise<CaptureResult>;
  platform: NodeJS.Platform;
  screenPermission(): 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
}

export function createCaptureWorkflow(deps: CaptureWorkflowDependencies) {
  let overlay: ActiveOverlay | null = null;
  const gate = new CaptureAdmissionGate();
  return {
    registerOverlayIpc(ipc: IpcMain): void {
      /* capture-overlay:ready/save/cancel */
    },
    async captureRegion(event: IpcMainInvokeEvent, input: CaptureInput): Promise<CaptureResult> {
      /* body of the current handler */
    },
    isSmokeOverlay(win: BrowserWindow): boolean {
      /* used by capture-smoke.ts */
    },
  };
}
```

`main.ts` keeps one line per handler: `handleCaptureWorkflow((event, admission, ...args) => capture.captureRegion(event, admission, args))`.

Why a factory and not a class with globals: the current `captureOverlay` module variable is the reason the overlay handlers cannot be unit-tested; with injected dependencies the `misplaced` path from #72 can get a test that fakes `getContentBounds()`.

When: after #72 merges and the matrix has run once, so the extraction moves settled code. Mechanical PR first (no behaviour change, existing smoke must pass); then, if 1.1 asks for a tolerance, that is a separate 10-line PR with a test.

Verification: filesystem/native tier. Run the affected native checks on Windows and macOS, then use `IMNOTA_SMOKE_CAPTURE_SOURCE=synthetic corepack pnpm smoke` only for the synthetic branch; ordinary `pnpm smoke` does not exercise that capture source. Review the affected capture UI and permission/failure states.

### 2.2 `electron/main.ts`: isolate smoke-only branches

Why: 21 `process.env.IMNOTA_SMOKE` reads are interleaved with production code (synthetic capture source at line 800, backup approval at 1550, update gating at 2535/2565, window flags at 2573–2592, settings bypass at 2624, the whole block from 2657). Each one is a place where a production path can silently behave differently under test, and reviewers must re-derive the rule every time.

What: one module that reads the environment once and exposes a typed object:

```ts
// electron/smoke-profile.ts
export interface SmokeProfile {
  enabled: boolean;
  userData?: string;
  captureSource: 'desktop' | 'synthetic';
  captureCapability: 'off' | 'real-memory-only';
  artifactDirectory?: string;
  resultFile?: string;
  mode: 'smoke' | 'stress';
  showWindow: boolean;
}

export function readSmokeProfile(env: NodeJS.ProcessEnv, ci = env.CI === 'true'): SmokeProfile {
  const enabled = env.IMNOTA_SMOKE === '1';
  return {
    enabled,
    userData: enabled ? env.IMNOTA_SMOKE_USER_DATA : undefined,
    captureSource: enabled && env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic' ? 'synthetic' : 'desktop',
    captureCapability:
      enabled && env.IMNOTA_SMOKE_CAPTURE_CAPABILITY === 'real-memory-only' ? 'real-memory-only' : 'off',
    artifactDirectory: enabled ? env.IMNOTA_SMOKE_ARTIFACT_DIR : undefined,
    resultFile: enabled ? env.IMNOTA_SMOKE_RESULT : undefined,
    mode: env.IMNOTA_SMOKE_MODE === 'stress' ? 'stress' : 'smoke',
    showWindow: !enabled || ci,
  };
}
```

`main.ts` then reads `smoke.captureSource === 'synthetic'` instead of comparing strings, and a unit test pins the rule that nothing smoke-related activates unless `IMNOTA_SMOKE === '1'` (the "two gates" comment at line 797 becomes a test).

When: right after 2.1; the capture extraction is the first consumer.

Verification: filesystem/native tier, including the affected smoke modes and their failure boundaries on each supported OS.

### 2.3 `src/renderer/App.tsx`: extract the workflows that the feedback PRs touched

Why: `App.tsx` owns capture, paste, import, undo/redo, navigation history, prompt bundles, onboarding and update install. The `app/` folder already shows the intended pattern (`useProjectPersistence.ts`, `session.ts`, `workflow.ts`).

What, in order of merge-conflict risk:

1. `app/useRegionCapture.ts` — moves `captureRegion` (App.tsx ~751–830), `captureBusyRef`, `activeCaptureCollection` and `captureDisabledLabel`. Returns `{ captureRegion, captureEnabled, captureDisabledLabel }`.

```ts
export function useRegionCapture(input: {
  enabled: boolean;
  platform: ShortcutPlatform;
  navigationIdentity: React.MutableRefObject<number>;
  beginCurrentProjectMutation(): Promise<number | null>;
  persistence: Pick<ProjectPersistence, 'acceptMutationSnapshot' | 'cancelNativeMutation'>;
  refreshProjects(): Promise<void>;
  showToast(message: string): void;
  setError(message: string): void;
}) {
  /* body unchanged */
}
```

2. `app/useUpdateFlow.ts` — `updateStatus` state, the `onUpdateStatus` effect, `downloadUpdate`, `installUpdate`, the close guard interaction (`allowClose`). Returns the props `FloatingUpdateControl` and `SettingsView` need.
3. `app/useClipboardImport.ts` — `importPaths`, `pasteImage`, the drop handler.

Each extraction moves code verbatim, then the matching `App.test.tsx` cases move to `use*.test.tsx` next to the hook.

When: one hook per PR, after the feedback PRs have merged (they are the ones that would conflict). Do not start until #73 and #75 are in.

Verification: application tier; `App.test.tsx` and the new hook tests must both pass, and the affected UI flows need review even when their intended appearance is unchanged. `useRegionCapture` also needs filesystem/native-tier evidence on each affected supported OS.

### 2.4 `App.test.tsx` flake

Why: A prior full parallel run reportedly failed `feedback controls › cancels and confirms screenshot deletion when confirmation is enabled`; the observation needs reproduction before concluding that it is timing-based.

What: reproduce the reported failure and retain the CI/run reference when available. Change the test only when that evidence identifies an incorrect wait condition; if the confirmation flow itself races, treat it as a separate behaviour fix. Track the result in `docs/verification-timing.md`, which already discusses timing-sensitive checks.

When: alongside the first hook extraction from 2.3, since the test moves anyway.

## Phase 3 — Small correctness items (whenever the area is next open)

### 3.1 `formatShortcut(null)` leaks "Not set" into labels

Why: `formatShortcut` returns the string `'Not set'` for a null binding, and callers treat the result as a binding. #73 fixed the capture tooltip; `shortcutLabels` in `Workspace.tsx` (`Partial<Record<string, string>>`) and `Toolbar.tsx` lines 628–649 (`Undo (${shortcutLabels.undo})`) have the same shape and will show `Undo (Not set)` for a cleared binding.

What: add a label helper that returns `undefined` for unbound actions and use it everywhere labels are built:

```ts
// src/shared/shortcuts.ts
export function shortcutHint(binding: string | null, platform: ShortcutPlatform): string | undefined {
  return binding ? formatShortcut(binding, platform) : undefined;
}
```

```ts
// src/renderer/App.tsx
const shortcutHintFor = useCallback(
  (id: ShortcutActionId) => shortcutHint(resolvedShortcuts[id], platform),
  [platform, resolvedShortcuts],
);
```

`formatShortcut(null)` stays for the Settings recorder, which is the one place "Not set" is the right text.

When: with the first PR that touches `Toolbar.tsx` again, or as a 30-line standalone.

### 3.2 `UpdateController.switchChannel` should use a background check

Why: after #74, `switchChannel` clears the prior candidate and sends `idle` for the new channel before it calls `void this.check()` in manual style. Switching may therefore flash `checking` and report an offline failure, but it does not retain an older candidate. A channel switch may be closer to a background discovery than a user pressing "Check now".

What:

```ts
// electron/update-controller.ts, end of switchChannel()
void this.check({ background: true });
```

plus one test: switch channel while offline → status stays `idle` with the new channel, no `error` emitted.

When: only after #74 merges; it is a 2-line follow-up.

### 3.3 Shortcut recorder: `event.code` for letters too

Why: `keyboardEventToShortcut` uses `event.key` for letters (layout-aware, intentional) and `event.code` only for digits. On layouts where `Shift` changes a letter's `key` (Turkish `ı/I`, some Cyrillic layouts) a recorded `Ctrl+Shift+I` may never match. This is a hypothesis, not a report.

What: nothing until a report; note it in `docs/troubleshooting.md` under shortcuts so the next report has a place to land.

## Phase 4 — Do not do

- **Do not add coverage thresholds.** This plan identifies native evidence (Phase 1), rather than line coverage, as the current gap.
- **Do not change tooling.** Electron 44, Vite, Vitest 4, Zod 4 and React 19 are current after the migration PRs (#66–#68). Nothing in this plan needs a tool change.
- **Do not split `share-service` into a separate repository.** It has its own contract tests (`test:share-contract`) and CI job; the monorepo keeps the client and service contract in one review.
- **Do not refactor `content-persistence.ts`, `screenshot-transactions.ts`, `backup-service.ts` or `content-trash.ts` as part of this plan.** They are the consequential persistence and recovery paths, each has a large test file, and nothing in the feedback round touched them. They get changed only for a reported defect, with independent review.
- **Do not add a global capture shortcut** without a roadmap decision (see the feedback follow-up plan, 2.3).

## Timeline summary

| When                                | Item                                                                    | Type                     |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| Completed                           | 0.1 move root plans, 0.3 docs index                                     | docs housekeeping        |
| When separately authorized          | 0.2 per-worktree maintenance                                            | local, no PR             |
| Next nightly (carrying #72 and #76) | 1.1 capture matrix + probe, 1.2 receiver matrix                         | native evidence          |
| After #72 merges and 1.1 has run    | 2.1 capture workflow extraction                                         | mechanical PR            |
| Right after 2.1                     | 2.2 smoke profile module                                                | mechanical PR + one test |
| After #73 and #75 merge             | 2.3 `useRegionCapture`, then `useUpdateFlow`, then `useClipboardImport` | one mechanical PR each   |
| With the first 2.3 PR               | 2.4 deletion-confirm flake                                              | test fix                 |
| After #74 merges                    | 3.2 background check on channel switch                                  | 2-line PR + test         |
| Next `Toolbar.tsx` change           | 3.1 `shortcutHint`                                                      | small PR                 |
| Before next release prep            | Decide on an `Unreleased` changelog section (feedback plan 1.3)         | release-preparation PR   |

Aim for one independently reviewable outcome per PR. Split separable outcomes, and explain why any cohesive larger change belongs together.
