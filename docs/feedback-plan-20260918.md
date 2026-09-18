# Imnota feedback plan — 2026-09-18

Status: planning only. No product behaviour is changed by this document.

This plan consolidates the latest hands-on feedback from the smoke project and the experimental screen-capture test. It separates confirmed observations from hypotheses that still need reproduction before implementation.

## 1. Experimental screen capture

### Confirmed observations

- Windows: region capture does not work correctly with two displays.
- Windows: clicking the camera from inside Imnota can show the capture overlay on the other display, but the behaviour is inconsistent and does not reliably follow the display where the action originated.
- Windows: invoking capture from an existing project with the shortcut does not show the overlay on the other display.
- macOS: multi-display capture currently appears to work; further testing is planned.
- The capture control itself works in the single-display path.
- The shortcut works, but its setup and behaviour feel glitchy, and it is unclear which key combination was actually configured.
- `Ctrl+Shift+S` is already used on Windows by another application/workflow, so it should not be presented as an unexplained standard without showing the active binding clearly.

### Planned investigation

1. Reproduce Windows two-display capture with the displays arranged left/right and above/below.
2. Test primary and secondary displays at 100%, 125%, 150% and 200% scaling.
3. Test capture from the toolbar and from the configured shortcut with:
   - Imnota focused on display 1;
   - Imnota focused on display 2;
   - the pointer on display 1;
   - the pointer on display 2;
   - a project open and no project open.
4. Record which display receives the overlay, which display supplies the pixels, and whether the saved crop matches the selection.
5. Compare Windows display bounds, work areas and scale factors with the overlay coordinates. Do not change the implementation until the intended rule is agreed.
6. Repeat the same matrix on macOS, including the permission state and the pointer display, to confirm the apparent cross-platform difference.

### Proposed product rule to review

The capture request should use one explicit display-selection rule and communicate it in the UI. The likely rule is: capture the display containing the pointer at the moment capture starts, regardless of which Imnota window or control initiated the request. This remains a proposal, not an accepted implementation decision.

### Shortcut UX improvements to consider

- Show the current binding directly beside **Capture screen region**.
- Make the shortcut recorder visibly enter and leave recording mode, with a clear “Press keys…” state.
- Show the exact normalized result after recording, for example `Ctrl+Shift+S`.
- Explain conflicts and reserved/common Windows shortcuts before saving.
- Provide **Reset to default** and **Clear shortcut** actions.
- Do not silently save a partially captured or ambiguous key combination.
- Keep the camera button usable even when no shortcut is configured.

Acceptance: a user can tell which shortcut is active, can change or clear it without guessing, receives a useful conflict message, and can start capture reliably from either display.

## 2. Update discovery and installation flow

### Requested behaviour

- Check for updates automatically when Imnota starts.
- While Imnota remains open, check approximately once per hour.
- Respect the selected channel: Stable or Nightly.
- Keep manual checking available in Settings.
- Surface an unobtrusive update indicator near the lower-left area when an update is available.
- Make the default available action a download action, rather than silently installing.
- Keep the download action on the general Settings/About page.
- Add a download icon/action beside **About**, matching the supplied visual direction.

### Decisions and safeguards required before implementation

- Define whether an update check is allowed while offline and how failures are presented.
- Coalesce startup, hourly and manual checks so they do not run concurrently.
- Clearly label the channel and version found.
- Download only after explicit user action.
- Preserve the existing local-first boundary: no telemetry or account requirement.
- Verify Windows installer handling for unsigned builds and failed downloads.
- Define the restart/install action and recovery behaviour separately from discovery.

Acceptance: users are told when a selected-channel update exists, can download it explicitly, can still check manually, and are never surprised by an automatic install or restart.

## 3. Navigation and Add-menu direction

### Requested behaviour

- Preserve a way to reach the older menu/design because it is preferred for some workflows.
- Add **Take screenshot** to that menu.
- Keep the newer primary **Add screenshot** action available unless a deliberate product decision changes the information architecture.

### Follow-up

- Identify exactly which “old design” is meant and compare the supplied image with the current menu.
- Decide whether this is a preference, a menu mode, or a short-term compatibility path.
- Reuse the same capture enablement and platform limitations in both entry points.

Acceptance: a user can find **Take screenshot** from the preferred menu without duplicating or creating conflicting capture flows.

## 4. Copy Bundle on Windows

### Reported observation

- macOS: **Copy Bundle** produces both the PNG and Markdown as expected.
- Windows: **Copy Bundle** does not appear to deliver both formats as expected.

### Investigation plan

1. Reproduce on the exact nightly build and record the Windows version, Imnota version and receiving application.
2. Test the combined clipboard action inside Imnota and in at least two real receiving applications.
3. Check the separate **Copy Markdown** and **Copy PNG** actions.
4. Check whether Windows receives both clipboard formats, whether the receiving application chooses only one, and whether the generated files are correct.
5. Verify the fallback actions and their messages before changing clipboard code.

Acceptance: Imnota accurately reports what it placed on the Windows clipboard and provides a reliable, visible fallback when the receiving application accepts only one format. Do not claim that every Windows application can paste both formats in one operation.

## 5. Suggested implementation slices

Keep these as separate reviewable changes:

1. Windows multi-display capture diagnosis and fix, with native tests for display selection and scaling.
2. Shortcut recorder and conflict/visibility UX improvements.
3. Update discovery indicator and explicit-download flow.
4. Menu compatibility path and **Take screenshot** entry point.
5. Windows clipboard compatibility/fallback improvements.

Each slice should have a nightly acceptance note containing the exact build, operating system, display setup or receiving application, steps taken, expected result and actual result. Do not call a feature ready for nightly promotion based only on synthetic capture tests.

## 6. Immediate manual test record to complete

- Windows version/build:
- Imnota version/channel:
- Display count and arrangement:
- Display scaling per monitor:
- Capture started by toolbar or shortcut:
- Pointer display:
- Overlay display:
- Saved image dimensions:
- Crop correct: yes/no
- Shortcut shown in Settings:
- Shortcut actually pressed:
- Windows receiving application for Copy Bundle:
- Combined clipboard result:
- Separate fallback result:
- macOS version and display setup, when tested:
