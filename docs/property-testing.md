# Property tests and diagnostic coverage

Property tests run in the ordinary full and platform suites. `fast-check` generates
schema 1–4 project data, mixed content, identifiers, user text, portable names and
hostile paths. Properties check schema round trips, collection/export ordering,
identity preservation, path containment, actual persisted metadata and migration
failure recovery. Existing example tests and native checks remain required.

Every run defaults to seed `439041101` (`0x1a2b3c4d`). Use a specific seed for a
deliberate exploration, or replay the seed and shrink path printed by fast-check.
For example in PowerShell:

```powershell
$env:IMNOTA_PROPERTY_SEED = '439041101'
corepack pnpm exec vitest run electron/files.property.test.ts
$env:IMNOTA_PROPERTY_PATH = '0:1:2' # Replace with the reported path.
corepack pnpm exec vitest run electron/files.property.test.ts -t 'rejects every string that contains a path separator'
Remove-Item Env:IMNOTA_PROPERTY_SEED, Env:IMNOTA_PROPERTY_PATH
```

Apply a shrink path only to the specific reported test. `IMNOTA_PROPERTY_RUNS`
multiplies bounded case counts (integer 1–100); filesystem properties intentionally
use fewer cases. Seeds must fit a signed 32-bit integer. Invalid settings fail
rather than silently changing the requested run. Clear overrides after use.

The properties record four known failures with `it.fails`: Windows device names
are accepted by the filename schema; a generated device-name property confirms
the same gap; DEL/C1 and Windows-forbidden filename characters remain accepted;
schema 3 collation-equivalent IDs can leave tie ordering dependent on storage
order. These are explicit expected failures, not passing security guarantees.
They require separately scoped fixes; the property PR does not change production
validation or ordering. Fixing them makes their expected-failure tests fail until
the tests are converted to ordinary passing regression tests.

Run `corepack pnpm test:coverage` for text, HTML and JSON summary reports in ignored
`coverage/`. It uses the ordinary Vitest discovery and includes untested application
sources, excluding test fixtures and declarations. Script tests and the separate
sharing service are outside this application coverage report. Test failures still
fail the local command; there are no coverage percentage thresholds or baseline
updates. The existing CI test step remains required. A separate diagnostic step
retains the report as `application-coverage` for 14 days and cannot change the
required tests' result. Counts and percentages describe instrumented execution,
not native receiver acceptance or release readiness.

The CI coverage addition belongs to the property PR. Integrate it alongside PR
#193's workflow pins and timeout/secret-scan changes without replacing those
changes; rerun workflow validation on the integrated file.
