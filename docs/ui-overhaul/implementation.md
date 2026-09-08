# UI overhaul implementation

This change implements the desktop and hosted-service portions of [the design plan](../../appUIoverhaul.md), starting from `main` at `3475c2d`. The original working checkout and its unrelated changes were left untouched.

## Delivered surfaces

- Desktop workbench: project/collection breadcrumbs, included-item counts, a persistent prompt-bundle action, keyboard-accessible Add item and More menus, task-oriented toolbar groups, clearer context/export inspector sections, separate destructive controls, settings navigation, and first-use guidance.
- Public service: a new root entry page, guided browser pairing with expiry/retry/manual-copy states, clearer bundle previews and downloads, an immediately readable text-only prompt, and recovery guidance for unavailable links.
- Owner console: Overview, Shares, Pairing, and Storage navigation; lifecycle filters and paginated shares; identifiable share detail and confirmed revocation; bounded pairing metadata; actual storage and retention aggregates. Quota reporting includes payload, metadata, and reservations, rather than treating filesystem size as the quota.
- Branding: the current `build/icon.svg` is reused as `/static/imnota-logo.svg`. GPT Image concepts remain design references in this folder and are not shipped as fake product screenshots or a replacement logo.

Existing authentication, secure cookies, CSRF/origin validation, rate limits, token handling, upload limits, local storage, and export formats remain in place. There are no dependency changes or database migrations. Owner readouts do not return bearer tokens, prompt bodies, artifact filenames, or local paths; existing sanitized titles identify shares and are rendered as text.

## Verification

Local checks include formatting, lint, TypeScript, application tests, service tests, the desktop/service contract test, the production build, and native Electron smoke verification. Service tests pass 35 cases, including authorization, revocation, expiry, replay, quota, path and content validation, security headers, and pairing UI states. The service production-dependency audit reports zero vulnerabilities.

Native Electron 39.8.10 on Windows passed 16 smoke assertion groups. The run exercises real import/edit/export/sharing workflows and captures narrow, standard, and ultrawide layouts. All 14 baseline images in `tests/visual/win32/manifest.json` were visually reviewed: four workspace sizes in both themes, Settings, three onboarding steps, and expanded/collapsed backdrop states. They intentionally replace the earlier layout expectations; pixel-comparison thresholds and the visual CI gate are unchanged. The baseline manifest records the local capture environment honestly. Comparison against these reviewed source captures passes, but is not a substitute for independent packaged CI capture comparison.

Hosted layouts were inspected in the collaborative browser at desktop and 390 px widths, including pairing code state, owner overview/list/detail, keyboard dismissal/focus, and shared Markdown. The browser could not reach the local service port despite successful host HTTP checks. Layout review therefore used the exact local HTML/CSS and synthetic fixture metadata in a local-only browser document; it does not claim deployed HTTP end-to-end coverage. Service API tests and DOM regression tests cover the corresponding behavior. No production owner login, upload, or revoke was performed.

Independent review prompted corrections for menu keyboard behavior, mobile sign-out access, pending-revocation dismissal, partial readout failures, logout/session races, and clipboard download recovery. DOM tests exercise private-metadata clearing, safe title rendering, quota states, and failed sign-out recovery.

## Scope boundaries

- The separate `imnota.xyz` marketing site's source/deployment project is absent from this repository. Its proposed broader page redesign remains deferred; `app.imnota.xyz` entry, pairing, share, and owner pages are implemented here.
- Pairing does not claim live upload progress because no subscription/status contract exists. Imnota remains the source of upload progress and the resulting share link.
- No manual cleanup, persistent operational event log, owner-triggered pairing revocation, user accounts, or cloud sync is added. The console explains existing automatic retention, and reports request counts as events rather than unique visitors.
- Existing fonts, retention defaults, keyboard shortcuts, and drawing colors remain compatible. Vite still reports the existing large Excalidraw chunk warning; this change does not claim a bundle-size improvement.
- Merge and deployment are not part of this request. Rollback is a normal revert of the PR; there is no schema migration to reverse.
