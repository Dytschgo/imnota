# Manual user-feedback protocol

Status: protocol only. No participants have been contacted, no sessions have been run, and no telemetry is collected by this document.

## Purpose

Validate whether developers and QA testers can turn screenshots into useful prompt bundles without coaching. Use synthetic or participant-approved screenshots and keep all project data local.

## Participants and consent

Recruit several developers and QA testers through an explicitly approved channel. Before a session, explain what will be observed, what notes will be retained, who can see them and when they will be deleted. Do not record screens, audio, names, application contents or clipboard data without clear consent. Do not add background analytics or telemetry.

Assign each participant an anonymous session identifier. Keep contact details, consent records and product notes separate. Ask participants not to use confidential screenshots, credentials, customer data or private prompts.

## Session script

Give the participant these tasks without describing the clicks:

1. Import or paste a screenshot, add a visual annotation and write a description.
2. Add several screenshots, organize them in a collection, change one priority and exclude one screenshot without deleting it.
3. Generate the current collection's prompt bundles and paste one into an external AI coding editor. If combined paste fails, ask them to find and use a fallback.

Observe where the participant pauses, backtracks, misreads a label or asks for help. Record task completion, time to first useful result, the point of any failure and the participant's wording. Do not infer success from application logs.

After the tasks, ask:

- Was the difference between exclusion and deletion clear?
- Did Description, Overall context and priority mean what you expected?
- Were Picture and Note references easy to match to the PNG?
- Was automatic splitting understandable and was the exported text readable?
- In the target editor, did Markdown arrive, did the image arrive, did both arrive, and did the separate fallback work?
- What was the first moment you felt unsure?

## Evidence record

Record one row per participant and target editor:

| Field       | Required observation                                                   |
| ----------- | ---------------------------------------------------------------------- |
| Session     | Anonymous ID and date                                                  |
| Environment | OS/version, architecture and Imnota revision/build                     |
| Target      | Editor/app/browser name and exact version                              |
| Tasks       | Completed, completed with help, or not completed                       |
| Clipboard   | Text only, image only, both, neither; one-image and multi-bundle cases |
| Readability | Legible or not, with the affected prompt and source dimensions         |
| Fallback    | Markdown-only, image-only and file attachment results                  |
| Friction    | Observed hesitation or failure, not a guessed cause                    |
| Consent     | What was recorded and retention date                                   |

Keep raw notes in an access-controlled, explicitly approved location outside user projects and this repository. Summaries must remove names, screenshots, prompts, workspace paths and other identifying material.

## Pending manual verification

The following work remains pending and must not be marked passed from automated tests:

- Run the full workflow on supported macOS hardware, including first launch, onboarding, annotation, trash/Undo, prompt generation and file/folder fallback. Record macOS version, architecture, build identity and any Gatekeeper behavior.
- Verify combined and fallback paste in representative external editors on Windows and macOS. Include at least one desktop app and one browser-based editor, exact versions, one prompt image, multiple automatically split bundles, an excluded screenshot and an oversized/readability-warning case.
- Confirm separately whether each receiver accepts Markdown and image formats. Writing both formats to Electron's clipboard is preparation evidence, not receiver acceptance.

## Triage

Group observations by repeated user-visible friction, severity and frequency. Fix blockers in the local import → annotate → describe → copy path before adding product surface area. Treat feature requests for cloud sync, accounts, native AI integrations or telemetry as out of scope until a separate product decision authorizes them.
