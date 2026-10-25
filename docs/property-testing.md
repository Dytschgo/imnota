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

Filename tests preserve read tolerance for existing stored names such as `NUL`,
`CON.txt`, `COM1`, `a\u007fb`, `a\u0085b` and names containing `< > " | ? *`.
The shared `portableFilename` helper replaces forbidden characters, strips C0,
DEL and C1 controls, removes trailing dots/spaces and prefixes reserved device
names when generating new disk names. One seeded property checks its output
across arbitrary text, device-name casing/extensions and forbidden characters;
a disk-reopen test confirms an existing schema 3 project referencing `CON.png`
still loads unchanged. No read/load schema was tightened or stored file renamed.
The schema 3 ordering observation remains a known bug: IDs `a` and `a\u0000`
compare equal under collation and retain opposite orders when their storage
arrays are reversed.

The tests use no expected-failure wrappers or exception-catching oracle. A setup
error, invalid fast-check replay path or unexpected product throw fails the test.
Each generated assertion receives its own seed and run settings; one property's
execution does not advance another's generator. The shared helper validates seed
and run-factor bounds; fast-check validates replay paths when the selected
property runs. Replay only generated properties, using the selected test's path.

The ordering bug requires a separately scoped production fix. When it lands,
the ordering expectation must require the same deterministic result in both
storage orders. Filename read tolerance remains intentional for compatibility;
portable generation does not migrate existing names or repair legacy files that
the host filesystem cannot open.

Run `corepack pnpm test:coverage` for text, HTML and JSON summary reports in ignored
`coverage/`. It uses the ordinary Vitest discovery and includes untested application
sources, excluding test fixtures and declarations. Script tests and the separate
sharing service are outside this application coverage report. Test failures still
fail the local command; there are no coverage percentage thresholds or baseline
updates. Validate runs this command as its required application test execution,
then runs `pnpm test:scripts` separately; it no longer runs Vitest twice. Coverage
generation or test failures fail quality checks. A diagnostic upload retains the
report as `application-coverage` for 14 days, including reports from failed tests.
Counts and percentages describe instrumented execution,
not native receiver acceptance or release readiness.

Nightly and stable retain their ordinary fail-closed `pnpm test` execution and
separate diagnostic coverage run. Coverage percentages and report retention are
diagnostic in all workflows. Validate the combined workflow after any further
integration.
