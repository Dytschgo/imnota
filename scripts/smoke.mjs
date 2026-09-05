import { spawnSync } from 'node:child_process';
import process from 'node:process';
import electron from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// macOS exposes its temporary directory through /var -> /private/var.
// Resolve only our newly created fixture; retain strict no-link checks for user files.
const reportDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'imnota-smoke-result-')));
const reportPath = join(reportDirectory, 'result.json');
const profilePath = join(reportDirectory, 'profile');
mkdirSync(profilePath);
const env = {
  ...process.env,
  IMNOTA_SMOKE: '1',
  IMNOTA_SMOKE_RESULT: reportPath,
  IMNOTA_SMOKE_USER_DATA: profilePath,
};
delete env.ELECTRON_RUN_AS_NODE;
const packagedExecutable = process.argv[2];
try {
  const result = spawnSync(packagedExecutable ?? electron, packagedExecutable ? [] : ['.'], {
    env,
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    let detail = '';
    try {
      detail = JSON.parse(readFileSync(reportPath, 'utf8')).error ?? '';
    } catch {
      /* Process may fail before app startup. */
    }
    throw new Error(
      `The smoke executable failed (exit ${result.status}, signal ${result.signal}): ${detail || result.error?.message || 'no application report'}`,
    );
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (
    report.passed !== true ||
    typeof report.version !== 'string' ||
    (env.IMNOTA_EXPECT_VERSION && report.version !== env.IMNOTA_EXPECT_VERSION)
  )
    throw new Error('The application did not confirm the expected smoke-test result.');
  console.log(`Application confirmed smoke success: Imnota ${report.version}`);
} catch (error) {
  console.error(`Smoke verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
