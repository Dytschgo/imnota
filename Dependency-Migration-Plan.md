# Dependency migrations after stable 0.2.6

The user authorized sequential migration of the six open dependency PRs, smaller compatibility PRs where needed, and one cumulative nightly for testing. Stable 0.2.6 stays published. Start from `05fd5a5` and preserve workspace formats and recovery behavior.

## Sequence and PR boundaries

| Order | Existing PR | Target                          | Scope and acceptance                                                                                                                                                                                                                                                     |
| ----- | ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | #7          | eslint-plugin-react-hooks 7.1.1 | Upgrade plugin and preserve the existing rules-of-hooks/error and exhaustive-deps/warn policy explicitly. React Compiler diagnostics are a separate opt-in adoption, not part of replacing the plugin. Lint must remain clean.                                           |
| 2     | #41         | Vitest 4.1.11                   | Migrate test configuration and mocks as required. Preserve full test discovery, platform routing, failure assertions and native coverage.                                                                                                                                |
| 3     | #6          | Zod 4.5.4                       | Adapt validation APIs and prove existing valid/invalid project, IPC and sharing inputs retain their intended behavior. No project schema-version bump. Split compatibility preparation from the dependency switch if the changes grow.                                   |
| 4     | #5          | React-Konva 19.0.10             | Verify actual peer/runtime compatibility first; upgrade React/React DOM and their types only if required. Split reusable React compatibility fixes from the renderer switch if necessary. Verify annotations, drawing integration, keyboard, selection, crop and export. |
| 5     | #8          | Tailwind CSS 4.3.3              | Migrate the CSS build integration and explicit source/theme configuration. Preserve current UI geometry and colors; inspect actual changes before approving any visual baselines.                                                                                        |
| 6     | #4          | Electron 44.2.0                 | Check breaking changes across intermediate Electron majors, runtime APIs, native integration, packaging and update behavior. Separate API preparation from the runtime upgrade if needed. Verify all supported packages and native workflows.                            |

## Per-migration delivery

1. Read the applicable official migration documentation and exact package metadata.
2. Implement only the current dependency migration in an isolated checkout, with its required lockfile and compatibility changes.
3. Run targeted checks, then the required full test/build and platform CI. Preserve existing safeguards and test thresholds; investigate failures rather than bypassing them.
4. Independently review consequential changes and relevant rendered/native evidence.
5. Merge the reviewed migration after checks pass. Close its superseded dependency-bot PR only once its target is delivered. Record the resulting PR and evidence below before beginning the next dependency switch.

## Nightly acceptance and recovery

After all six targets are integrated, independently review the exact main commit and dispatch the guarded nightly workflow. Verify Windows, macOS and Linux packages, native walkthroughs, Windows visual comparisons, all release assets/checksums and three nightly manifests. Download and launch the public Windows build. Confirm stable Latest remains 0.2.6.

Keep prior releases available. If a migration fails acceptance, fix or revert its isolated PR before publication. Keep real workspaces untouched; use synthetic fixtures or backed-up copies. Dependency upgrades must not silently migrate project formats. Packaged CI does not establish manual NSIS/deb/Gatekeeper or all clean-machine update paths.

## Progress

- Hooks plugin: merged in #59 (`7de6bf5`), superseding #7. Lint/type checks, 609 application tests, script tests, all platform CI and native/visual checks passed. Existing Hooks lint policy preserved explicitly.
- Vitest: merged in #60 (`d983079`), superseding #41. All local checks and platform CI passed. Independent v3/v4 discovery comparison retained exactly the same 82 application and 41 platform test files; assertions and configuration are unchanged.
- Zod: merged in #61 (`860b35d`), superseding #6. All platform CI passed, including 612 application tests and native/visual checks. Records explicitly declare string keys and sparse appearance updates preserve omitted backdrop preferences; stored-profile defaults remain intact.
- React-Konva: merged in #62 (`4e501cb`), superseding #5. React/React DOM 19.2.8 and matching types satisfy the renderer's reconciler dependency. Four refs explicitly retain their existing undefined initial state. All platform CI, native annotation/drawing interactions and strict visual checks passed.
- Tailwind: merged in #63 (`b4769de`), superseding #8. Version 4.3.3 uses its dedicated PostCSS plugin and explicit source paths. Existing reset colors remain intact. All platform/native/strict visual checks passed. CI exposed an asynchronous search-test assumption; waiting for the unchanged selected-scope assertion resolved it without changing application behavior.
- Electron clipboard preparation: merged in #64 (`45de8b1`) on Electron 39. All callers await clipboard completion; atomic context writes and failure propagation are covered. All platform/native/visual checks passed.
- Electron macOS preparation: merged in #65 (`3d3bcd4`). Install/update helpers reject incompatible or unreadable minimum OS versions before replacement. Numeric-version and preservation tests, all platform checks and the real Mac archive/update test passed, including a fresh run after integrating #64.
- Electron runtime: migration in progress to 44.2.0. The adapter uses MIME-based ClipboardItems; CI explicitly installs the binary; packaging declares and verifies macOS 13.0.0. Local lint/type checks, 623 application tests, 45 script tests, build and 18 unpackaged Windows native assertion groups passed. All 14 same-host visual comparisons passed unchanged tolerances. A packaged search-input timing failure requires waiting for query/results reset before native clicking; the rebuilt package and exact-head platform CI remain acceptance gates.
- Final cumulative nightly: pending acceptance of the runtime PR. Stable 0.2.6 remains Latest.

## References

- [React Hooks ESLint plugin](https://react.dev/reference/eslint-plugin-react-hooks)
- [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration)
- [Zod 4 migration guide](https://zod.dev/v4/changelog)
