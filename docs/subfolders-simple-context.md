# Subfolders and simple screenshot context

This update applies the explicit feedback from the second set of screenshots:

- Rename the feedback-round controls and exported label to Subfolder.
- Use Subfolder 1 for new projects and Subfolder N for new subfolders.
- Keep existing names and disk paths unchanged. No workspace migration is required.
- Replace the separate description and eight note editors with one Problem description editor.
- Preserve populated older fields under collapsed, read-only Previous notes. Existing export exclusions remain intact until the primary problem description is edited; editing opts that field into export. Existing screenshot descriptions are also included in the brief.
- Collapse status, priority and tags under Screenshot details.
- Give the Line tool a line icon instead of a rectangle icon.

Placement clarified: the refresh and sidebar-collapse controls sit in the side navigation beneath the logo. Collapsing leaves a narrow rail so refresh and expand remain accessible. The annotation toolbar stays above the canvas. The macOS traffic-light safe area remains unchanged.

Validation covers a single editor, preserved older fields, plain-text rendering, export labels and old export preferences, plus the Electron save/reopen workflow. This is a source update, not a new published release.

Local verification: 27 tests, formatting, lint, both TypeScript configurations, production build and Electron smoke pass. Smoke checks include unchanged legacy exclusions, description editing and export inclusion after reopening. The dark desktop layout was inspected from an actual Electron screenshot. Native Mac packaging has not been rerun for this update.
