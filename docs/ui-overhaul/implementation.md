# UI overhaul implementation

This change implements the desktop and hosted-service portions of [the design plan](../../appUIoverhaul.md), starting from `main` at `3475c2d`. The original working checkout and its unrelated changes were left untouched.

Main advanced during implementation. Sidebar collection history/grouped favourites (#29) and update notifications/macOS rollback handling (#31) were merged through `00827cd`, preserving their behavior. AppShell retains the new SideNav and collection title tooltip alongside the overhaul's item count and handoff action. Settings retains the new download callback. Tests and native captures were rerun after integration.

## Delivered surfaces

- Desktop workbench: project/collection breadcrumbs, included-item counts, a persistent prompt-bundle action, keyboard-accessible Add item and More menus, task-oriented toolbar groups, clearer context/export inspector sections, separate destructive controls, settings navigation, and first-use guidance.
- Public service: a new root entry page, guided browser pairing with expiry/retry/manual-copy states, clearer bundle previews and downloads, an immediately readable text-only prompt, and recovery guidance for unavailable links.
- Owner console: Overview, Shares, Pairing, and Storage navigation; lifecycle filters and paginated shares; identifiable share detail and confirmed revocation; bounded pairing metadata; actual storage and retention aggregates. Quota reporting includes payload, metadata, and reservations, rather than treating filesystem size as the quota.
- Branding: the current `build/icon.svg` is reused as `/static/imnota-logo.svg`. GPT Image concepts remain design references in this folder and are not shipped as fake product screenshots or a replacement logo.

Existing authentication, secure cookies, CSRF/origin validation, rate limits, token handling, upload limits, local storage, and export formats remain in place. There are no dependency changes or database migrations. Owner readouts do not return bearer tokens, prompt bodies, artifact filenames, or local paths; existing sanitized titles identify shares and are rendered as text.

## Verification

Local checks pass formatting, lint, TypeScript, 526 application tests, 39 script tests (one packaged-macOS-only test skipped on Windows), 35 service tests, the desktop/service contract test, the production build, and native Electron smoke verification. Service tests include authorization, revocation, expiry, replay, quota, path and content validation, security headers, and pairing UI states. The service production-dependency audit reports zero vulnerabilities.

Native Electron 39.8.10 on Windows passed 16 smoke assertion groups. The run exercises real import/edit/export/sharing workflows and captures narrow, standard, and ultrawide layouts. All 14 baseline images in `tests/visual/win32/manifest.json` were visually reviewed: four workspace sizes in both themes, Settings, three onboarding steps, and expanded/collapsed backdrop states. They intentionally replace the earlier layout expectations; pixel-comparison thresholds and the visual CI gate are unchanged.

Initial local captures differed from packaged Windows CI by up to 0.8% of pixels, including canvas fixture placement and rasterization. After checking the actual packaged UI, all 14 baselines were refreshed from [CI run 34250031899](https://github.com/Dytschgo/imnota/actions/runs/34250031899), with the precise source/environment recorded in the manifest. That run passed quality, service security on all three platforms, Linux/macOS packaging, and Windows functional smoke; its only failed step was comparison to the local baselines. The PR checks show verification of the final baseline correction.

Hosted layouts were inspected in the collaborative browser at desktop and 390 px widths, including pairing code state, owner overview/list/detail, keyboard dismissal/focus, and shared Markdown. The browser could not reach the local service port despite successful host HTTP checks. Layout review therefore used the exact local HTML/CSS and synthetic fixture metadata in a local-only browser document; it does not claim deployed HTTP end-to-end coverage. Service API tests and DOM regression tests cover the corresponding behavior. No production owner login, upload, or revoke was performed.

Independent review prompted corrections for menu keyboard behavior, mobile sign-out access, pending-revocation dismissal, partial readout failures, logout/session races, and clipboard download recovery. DOM tests exercise private-metadata clearing, safe title rendering, quota states, and failed sign-out recovery.

## Scope boundaries

- The separate `imnota.xyz` marketing site's source/deployment project is absent from this repository. Its proposed broader page redesign remains deferred; `app.imnota.xyz` entry, pairing, share, and owner pages are implemented here.
- Pairing does not claim live upload progress because no subscription/status contract exists. Imnota remains the source of upload progress and the resulting share link.
- No manual cleanup, persistent operational event log, owner-triggered pairing revocation, user accounts, or cloud sync is added. The console explains existing automatic retention, and reports request counts as events rather than unique visitors.
- Existing fonts, retention defaults, keyboard shortcuts, and drawing colors remain compatible. Vite still reports the existing large Excalidraw chunk warning; this change does not claim a bundle-size improvement.
- Merge and deployment are not part of this request. Rollback is a normal revert of the PR; there is no schema migration to reverse.
