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

Four ordinary tests record known product bugs with explicit current-behavior
expectations: the filename schema accepts `NUL`, `CON.txt` and `COM1`; a seeded
device-name property confirms acceptance across generated casing and extension
variants; `a\u007fb`, `a\u0085b` and names containing `< > " | ? *` are accepted;
schema 3 IDs `a` and `a\u0000` compare equal under collation and retain opposite
orders when their storage arrays are reversed. These passing observations do not
establish portable filename validation or storage-independent tie ordering.

The tests use no expected-failure wrappers or exception-catching oracle. A setup
error, invalid fast-check replay path or unexpected product throw fails the test.
Each generated assertion receives its own seed and run settings; one property's
execution does not advance another's generator. The shared helper validates seed
and run-factor bounds; fast-check validates replay paths when the selected
property runs. Replay only generated properties, using the selected test's path.

These bugs require separately scoped production fixes. When a fix lands, its
current-behavior test must fail until the acceptance expectation is inverted or
the ordering expectation requires the same deterministic result in both storage
orders. The property PR changes no production validation or ordering.

Run `corepack pnpm test:coverage` for text, HTML and JSON summary reports in ignored
`coverage/`. It uses the ordinary Vitest discovery and includes untested application
sources, excluding test fixtures and declarations. Script tests and the separate
sharing service are outside this application coverage report. Test failures still
fail the local command; there are no coverage percentage thresholds or baseline
updates. The existing CI test step remains required. A separate diagnostic step
retains the report as `application-coverage` for 14 days and cannot change the
required tests' result. Counts and percentages describe instrumented execution,
not native receiver acceptance or release readiness.

The CI coverage addition is integrated alongside PR #193's workflow pins and
timeout/secret-scan changes. The ordinary `pnpm test` step remains fail-closed;
only coverage reporting and retention are diagnostic. Validate the combined
workflow after any further integration.
