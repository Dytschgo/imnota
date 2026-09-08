# PR test coverage map

Policy introduced in PR #36. This map describes application-impact PRs and full validation runs; [prose-only PRs](ci-routing.md) use the separately reviewed documentation route. The full suite remains in Linux `quality`. Package jobs run `test:platform`: the same default discovery minus the 41 exact renderer paths in [the policy](../tests/platform-test-policy.json), followed by all script tests. All 37 other application test files remain on Linux, Windows, and macOS. Hosted share contracts, the three service jobs, actual packaged walkthroughs, and Windows visual checks remain unchanged. Nightly and stable release keep their existing full-suite commands.

## Why the renderer exclusions are safe

These current tests exercise pure geometry/state/planning or jsdom interactions. Their native bridges, clipboard calls, persistence, theme queries, images, and canvas operations are mocked or injected. Platform values are explicit test inputs. Repeating them on a different host does not make those mocks native: for example, jsdom's navigator platform is empty, while the App fixture reports Windows. Actual host behavior stays covered by retained Electron/shared tests and packaged native walkthroughs.

Every exclusion is an exact reviewed file path; wildcard patterns, stale paths, and duplicates are rejected by the platform configuration. New and unlisted tests retain all-platform execution automatically. Existing excluded tests must be reclassified if they gain host-dependent behavior. Review production dependencies as well as test mocks when changing the policy. Shared tests are retained because several exercise real filesystem, recovery, path and update behavior despite living outside `electron/`.

Unknown or broad behavior retains the existing platform and packaged checks. Only the narrowly classified prose-only PR route skips application work; main pushes and release validation remain full. For a broad platform investigation, `IMNOTA_FULL_PLATFORM_TESTS=1` restores the entire application suite in the platform command. The full quality suite remains unaffected by that setting whenever application validation runs.

## Inventory and measurements

Each application test below was collected by Vitest, with discovery checked against the platform configuration: full 78 files, platform 37, and the difference exactly equals the 41 reviewed policy entries. Nothing is removed from full-suite execution. The table records a local Windows baseline at `e127d47` (567 passing tests), measured per-file execution time; parallel file times are not additive wall time. Hosted PR job timings are recorded in the [improvement plan](improvement-plan.md); these local times are a coverage baseline, not a promise about release speed.

| Test file                                                   | PR execution            | Local baseline seconds |
| ----------------------------------------------------------- | ----------------------- | ---------------------: |
| `electron/content-persistence.test.ts`                      | Quality + all platforms |                  2.016 |
| `electron/content-project-metadata.test.ts`                 | Quality + all platforms |                  0.006 |
| `electron/desktop-glass.test.ts`                            | Quality + all platforms |                  0.001 |
| `electron/hosted-share-artifacts.test.ts`                   | Quality + all platforms |                  0.007 |
| `electron/hosted-share-client.test.ts`                      | Quality + all platforms |                  0.864 |
| `electron/mixed-screenshot-trash.test.ts`                   | Quality + all platforms |                  0.159 |
| `electron/native-performance.test.ts`                       | Quality + all platforms |                  0.001 |
| `electron/project-search.test.ts`                           | Quality + all platforms |                  0.271 |
| `electron/project-watch.test.ts`                            | Quality + all platforms |                  0.695 |
| `electron/prompt-bundle-store.test.ts`                      | Quality + all platforms |                  0.650 |
| `electron/prompt-bundle-workflow.test.ts`                   | Quality + all platforms |                  1.909 |
| `electron/screenshot-transaction-adapter.test.ts`           | Quality + all platforms |                  5.709 |
| `electron/screenshot-transactions.test.ts`                  | Quality + all platforms |                  3.186 |
| `electron/smoke-native-driver.test.ts`                      | Quality + all platforms |                  1.797 |
| `electron/workflow-errors.test.ts`                          | Quality + all platforms |                  0.003 |
| `src/renderer/App.test.tsx`                                 | Linux quality           |                  9.127 |
| `src/renderer/app/AppShell.test.tsx`                        | Linux quality           |                  0.373 |
| `src/renderer/app/session.test.ts`                          | Linux quality           |                  0.002 |
| `src/renderer/app/useProjectPersistence.test.tsx`           | Linux quality           |                  1.755 |
| `src/renderer/app/workflow.test.ts`                         | Linux quality           |                  0.001 |
| `src/renderer/canvas/annotation-layout.test.ts`             | Linux quality           |                  0.017 |
| `src/renderer/canvas/commands.test.ts`                      | Linux quality           |                  0.006 |
| `src/renderer/canvas/pointer-interaction.test.ts`           | Linux quality           |                  0.022 |
| `src/renderer/canvas/reveal.test.ts`                        | Linux quality           |                  0.001 |
| `src/renderer/collection/CollectionRail.test.tsx`           | Linux quality           |                  2.244 |
| `src/renderer/components/CombinedContextCopy.test.tsx`      | Linux quality           |                  0.113 |
| `src/renderer/components/ProblemDescriptionEditor.test.tsx` | Linux quality           |                  0.086 |
| `src/renderer/components/ProjectIcon.test.tsx`              | Linux quality           |                  0.018 |
| `src/renderer/components/Toolbar.test.tsx`                  | Linux quality           |                  1.022 |
| `src/renderer/components/UpdateControl.test.tsx`            | Linux quality           |                  0.336 |
| `src/renderer/components/ui.test.tsx`                       | Linux quality           |                  0.077 |
| `src/renderer/content/TextBlockEditor.test.tsx`             | Linux quality           |                  0.113 |
| `src/renderer/content/drawing-render.test.ts`               | Linux quality           |                  0.009 |
| `src/renderer/content/useContentPersistence.test.tsx`       | Linux quality           |                  0.540 |
| `src/renderer/export-image.test.ts`                         | Linux quality           |                  0.003 |
| `src/renderer/export/HostedShareDialog.test.tsx`            | Linux quality           |                  1.342 |
| `src/renderer/export/PromptBundleCard.test.tsx`             | Linux quality           |                  0.298 |
| `src/renderer/export/PromptSharingDialog.test.tsx`          | Linux quality           |                  0.121 |
| `src/renderer/export/prompt-export-controller-core.test.ts` | Linux quality           |                  0.040 |
| `src/renderer/export/usePromptBundleController.test.tsx`    | Linux quality           |                  0.014 |
| `src/renderer/navigation-history.test.ts`                   | Linux quality           |                  0.008 |
| `src/renderer/onboarding/OnboardingDemo.test.tsx`           | Linux quality           |                  0.274 |
| `src/renderer/pixelate.test.ts`                             | Linux quality           |                  0.007 |
| `src/renderer/prepare-context.test.ts`                      | Linux quality           |                  0.004 |
| `src/renderer/prompt-bundle-render.test.ts`                 | Linux quality           |                  0.008 |
| `src/renderer/search/SearchDialog.test.tsx`                 | Linux quality           |                  0.094 |
| `src/renderer/settings/AppearanceSettings.test.tsx`         | Linux quality           |                  0.363 |
| `src/renderer/settings/SettingsControls.test.tsx`           | Linux quality           |                  0.341 |
| `src/renderer/settings/SettingsView.test.tsx`               | Linux quality           |                  0.340 |
| `src/renderer/settings/SharingSettings.test.tsx`            | Linux quality           |                  0.590 |
| `src/renderer/settings/preferences.test.ts`                 | Linux quality           |                  0.003 |
| `src/renderer/settings/sharing-preferences.test.tsx`        | Linux quality           |                  0.165 |
| `src/renderer/settings/useAppearance.test.tsx`              | Linux quality           |                  0.024 |
| `src/renderer/settings/useKeyboardShortcuts.test.tsx`       | Linux quality           |                  0.073 |
| `src/renderer/store.test.ts`                                | Linux quality           |                  0.014 |
| `src/renderer/viewport.test.ts`                             | Linux quality           |                  0.001 |
| `src/shared/__tests__/annotation-bounds.test.ts`            | Quality + all platforms |                  0.005 |
| `src/shared/__tests__/annotation-order.test.ts`             | Quality + all platforms |                  0.002 |
| `src/shared/__tests__/clipboard-context.test.ts`            | Quality + all platforms |                  0.003 |
| `src/shared/__tests__/collections.test.ts`                  | Quality + all platforms |                  0.200 |
| `src/shared/__tests__/content-items.test.ts`                | Quality + all platforms |                  0.007 |
| `src/shared/__tests__/crop.test.ts`                         | Quality + all platforms |                  0.017 |
| `src/shared/__tests__/file-safety.test.ts`                  | Quality + all platforms |                  0.053 |
| `src/shared/__tests__/markdown.test.ts`                     | Quality + all platforms |                  0.003 |
| `src/shared/__tests__/notes.test.ts`                        | Quality + all platforms |                  0.001 |
| `src/shared/__tests__/preference-settings.test.ts`          | Quality + all platforms |                  0.009 |
| `src/shared/__tests__/recovery-migration.test.ts`           | Quality + all platforms |                  0.005 |
| `src/shared/__tests__/schema.test.ts`                       | Quality + all platforms |                  0.007 |
| `src/shared/__tests__/screenshot-trash.test.ts`             | Quality + all platforms |                  2.884 |
| `src/shared/__tests__/shortcuts.test.ts`                    | Quality + all platforms |                  0.012 |
| `src/shared/__tests__/terminal-update.test.ts`              | Quality + all platforms |                  0.006 |
| `src/shared/__tests__/update-channels.test.ts`              | Quality + all platforms |                  0.059 |
| `src/shared/__tests__/update-check.test.ts`                 | Quality + all platforms |                  0.002 |
| `src/shared/__tests__/utils.test.ts`                        | Quality + all platforms |                  0.002 |
| `src/shared/__tests__/workflow-errors.test.ts`              | Quality + all platforms |                  0.002 |
| `src/shared/prompt-bundles.test.ts`                         | Quality + all platforms |                  0.007 |
| `src/test/owner-console.test.ts`                            | Quality + all platforms |                  0.900 |
| `src/test/share-copy-ui.test.ts`                            | Quality + all platforms |                  0.020 |

## Other test runners and native coverage

| Test / check                             | Execution retained                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `scripts/dev-electron.test.mjs`          | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/smoke-process.node.test.mjs`    | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/release-readiness.test.mjs`     | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/release-channel.test.mjs`       | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/stage-release-assets.test.mjs`  | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/update-macos.test.mjs`          | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/visual-regression.test.mjs`     | Quality + every package job; macOS updater also verifies the built Mac package          |
| `scripts/ci-changes.test.mjs`            | Quality + every package job; real Git history and fail-closed routing regression checks |
| `electron/hosted-share-contract.test.ts` | Quality + every package job via `test:share-contract`                                   |
| `share-service/test/owner.test.js`       | Service security job on Linux, Windows and macOS                                        |
| `share-service/test/pairing-ui.test.js`  | Service security job on Linux, Windows and macOS                                        |
| `share-service/test/service.test.js`     | Service security job on Linux, Windows and macOS                                        |
| `share-service/test/share-copy.test.js`  | Service security job on Linux, Windows and macOS                                        |
| Unpackaged native walkthrough            | Linux quality                                                                           |
| Packaged native walkthrough              | Linux AppImage, Windows executable, macOS universal archive                             |
| Approved visual comparison               | Windows, all 14 baselines with unchanged tolerances                                     |

No test cases or assertions were deleted. The shared script command is reused by `test` and `test:platform`; the default `test` still runs the complete Vitest and Node suites. Required job names, release gating, artifact publication, and dependencies are unchanged.
