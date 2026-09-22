# Investigating missing project data

## September 22 report

A user reported screenshots and data disappearing on Windows, using a nightly from roughly three days earlier. The exact installed version, preceding actions, and whether files disappeared from disk or only from the app are still unknown. September 19 has two candidate tags: `v0.2.8-nightly.20260919.35439354560` and `v0.2.8-nightly.20260919.35412472439`. Neither is confirmed as the affected build.

Both candidates allow a general metadata save to omit screenshot records or change their file references. That can hide screenshots without deleting the original images. It is a reproducible failure boundary, not an established explanation for this user's incident.

The proposed fix rejects screenshot membership and native file-identity changes through metadata saves, including the normal watched compare-and-swap path. Import, capture and explicit deletion continue through their dedicated native operations. Reordering, descriptions and export visibility remain editable. The guard does not reconstruct records already lost in an earlier version.

## Preserve evidence first

1. Close Imnota and copy the entire affected project folder to a separate location, including hidden recovery files, Undo data and any available backups. Keep the original unchanged; investigate a copy. Do not empty the system Recycle Bin or Trash.
2. Record the exact installed version, Windows version, approximate incident time and timezone, and the actions immediately before the disappearance. Note whether restarting or switching workspaces changed what appeared.
3. Compare the project's `project.json` screenshot records with files under `collections/<collection>/screenshots`. Also preserve annotation/description sidecars and drawing/text sources. Distinguish absent records, absent bytes and permission/read failures. Do not delete apparently orphaned files or rewrite the metadata during triage.
4. Inspect available backups and recovery journals on a copy before attempting a restore. Existing interrupted-recovery handling deliberately preserves ambiguous states; do not manually remove its journals to suppress an error.

## Local diagnostic traces

The proposed build records operation start/result, selected filesystem write/copy/remove/trash checkpoints, recovery counts, watcher events and missing-file checks. Settings > Workspace > **Open diagnostics folder** opens the application-data `diagnostics` directory. A recorded failure includes a diagnostic reference that correlates its operation and file checkpoints. Collect that reference and the relevant JSONL files with the user's consent. No trace is uploaded automatically.

Records contain time, application version, platform, random session/operation identifiers, action, phase, counts, allowlisted error codes and salted per-session path identifiers. They exclude project contents, screenshot bytes, names, raw paths, input arguments, error messages and stacks. Path identifiers cannot correlate a file across restarts. Traces describe what the application observed; they cannot prove which external program removed a file or reconstruct past activity from a build without tracing.

Each process/session owns a current and previous log, each limited to approximately 1 MiB. On startup, retention removes older logs belonging to demonstrably inactive processes while preserving the newest four inactive sessions. Active or permission-unknown processes, unrelated files and links are preserved. PID reuse and uncertain process status can retain extra logs; this is a best-effort global bound. Preserve logs promptly because rotation eventually removes older evidence.

Logging failure does not change the underlying save/delete result. A stalled write has a 1.5-second wait limit. Tracing pauses while that write is outstanding and resumes if it finishes successfully; the write is not retried. An actual storage error stops tracing until restart or an explicit retry with **Open diagnostics folder**. That button reports storage failure instead of claiming traces were saved. A sudden termination can leave a start checkpoint without a result; that alone does not prove a completed deletion.

Native verification reports retain a sanitized diagnostics health summary, including the storage stage, pending and dropped event counts, timeouts, recoveries and an allowlisted error code. This summary contains no project paths or raw storage error messages. A Windows post-merge walkthrough found a correctly rejected save without its expected trace reference; the older report did not retain enough information to distinguish a timeout from an I/O error. The recovery regression test covers a temporarily stalled write that later succeeds, without claiming it was the cause of that CI failure or the original user incident.

Opening a project checks that referenced source and sidecar files exist and are regular files. Missing files produce a warning while retaining their records; the check never repairs or removes data. Missing optional sidecars in legacy projects may also warn. Unreadable workspace enumeration reports an error instead of presenting an empty library; malformed individual project folders remain skipped and leave a local diagnostic event. These checks do not validate image or source-file contents and do not prevent external file deletion.

## Memory pressure and process termination

Renderer and child-process termination records contain an allowlisted process type, Electron's termination reason (including `oom` and `memory-eviction`), and a bounded numeric exit code. They take one memory observation at termination: main-process resident MiB, the summed working-set MiB of available child processes, and the number of child processes measured. These are rounded, bounded observations, not peak memory readings or a continuous sample. Working sets can include shared memory, so their sum is not unique physical RAM consumption. The failed renderer may already be absent; a low value or absent measurement does not rule out memory exhaustion. Measurement errors omit the unavailable fields without losing the termination reason. Process names, titles, service names and PIDs are not copied from Electron details into records.

An `oom` termination can explain interrupted work or loss of edits that had not reached native persistence; it does not establish that saved screenshot files were deleted. Ordinary screenshot saves retain original image bytes, and admitted native saves can finish after renderer failure. A main-process or whole-machine crash may prevent any termination record. Neither the historical report nor the September 19 builds provide this new evidence, so memory pressure remains an unconfirmed hypothesis for that incident.

## Verification and delivery

Regression tests cover schema-3/4 screenshot omission and identity changes, permitted metadata edits, missing-file record preservation, workspace read failures, diagnostic privacy/correlation, termination reasons and bounded memory observations, unavailable measurements, storage failure/stalls, concurrent-session rotation and conservative retention. The native walkthrough attempts a screenshot-omitting watched save, checks unchanged metadata and original image bytes, and finds its correlated failure trace. It also restores an interrupted edit with a temporarily unavailable fixture image and checks the final warning and retained record.

This document describes the review candidate, not a released fix. The PR records executed platform checks and any outstanding evidence. Investigation of the reported incident still needs the preserved affected project and exact build; synthetic fixtures cannot establish its cause.
