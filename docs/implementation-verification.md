# Implementation verification

Status: integration and native verification in progress. This is not release approval.

The implementation follows [implementation plan.md](../implementation%20plan.md). Work is local on `feature/imnota-implementation`; no release, push, cloud service, AI integration, or user recruitment is part of this change.

## Implemented areas

- Schema 3 collections, legacy migration, screenshot descriptions and priority, export visibility, ordering, archive/restore, and local settings.
- Annotation tools, inline text, text references, expanded export bounds, crop/redaction handling, and export contrast correction.
- Automatically split PNG/Markdown prompt pairs, timestamped storage, native clipboard fallbacks, previews, progress, cancellation, and cleanup retry.
- Desktop shell, collection rail, inspector, onboarding, themes, optional glass, and configurable shortcuts.
- Transactional screenshot persistence, recovery journals, OS-trash recovery snapshots, file watching, and optimistic revision checks.

## Verification recorded so far

| Check                                                     | Evidence                                                                                 | Limitation                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Integrated unit tests                                     | 270 passed after the desktop UI merge                                                    | Later corrective changes require another complete run                   |
| Node script tests                                         | 30 passed, one platform fixture skipped at that checkpoint                               | The new native-runner safety suite also passes separately               |
| Corrected storage, canvas capture, and persistence suites | 64 focused tests passed after digest/capture integration                                 | Mocked tests do not establish native UI behavior                        |
| Production build                                          | Pass; approximately 631 kB minified renderer JavaScript                                  | Vite reports its large-chunk warning                                    |
| Independent recovery-helper review                        | Accepted corrected transaction/trash helper delta                                        | Native integration and renderer persistence require separate acceptance |
| Native onboarding                                         | Real isolated Windows run completed the clipboard step after its native bridge was wired | Does not establish paste behavior in another editor                     |
| Native canvas                                             | Real input reached inline text creation after pointer and harness-coordinate fixes       | Escape/reopen sequence remains under investigation                      |
| Responsive captures                                       | Onboarding and failure-state screenshots captured and inspected                          | Full light/dark viewport matrix is not yet accepted                     |
| Stress workflow                                           | Harness covers 1/10/20/100 mixed-resolution fixtures and complete 20/100 prompt renders  | Actual stress result is still pending                                   |

## Acceptance still required

- Complete the independent review of native digest wiring and corrected renderer metadata-save races.
- Verify inline text commit/cancel and canvas commands with native input.
- Pass the full integrated formatting, lint, type, test, and build gates again.
- Pass isolated native smoke and stress runs; inspect the exported pixels and captured desktop layouts.
- Record final timings and memory observations without generalizing them to other machines.

macOS launch, Linux packaging, and paste acceptance in external coding editors remain platform/manual checks unless explicitly exercised. A successful native clipboard write cannot detect whether another app accepts both its image and text representations.

## Test isolation

Use the runner described in [development.md](development.md), not the ordinary development launcher, for native verification. It creates a temporary profile and workspace and checks cleanup paths. Each artifact run uses a new directory.

An early worker development launch used the default app profile rather than an isolated profile. It wrote application cache/session data; no before-state snapshot exists, so it is not counted as isolated verification. The user was informed. Subsequent native verification runs use the isolated runner.
