import { normalizeNativeVerificationMode, runNativeVerification } from './smoke-process.mjs';
import { runPackagedFaults } from './smoke-faults.mjs';

import { verifyFaultEvidenceManifest } from './native-fault-retention.mjs';

try {
  const mode = normalizeNativeVerificationMode(process.env.IMNOTA_SMOKE_MODE);
  if (process.argv[2] === '--verify-fault-evidence') {
    if (process.argv.length !== 4) throw new Error('Expected a downloaded native fault evidence directory.');
    verifyFaultEvidenceManifest(process.argv[3]);
  } else if (mode === 'faults') {
    if (process.argv.length !== 6)
      throw new Error('Fault mode requires executable, supplied package, running executable and asar.');
    await runPackagedFaults({
      executable: process.argv[2],
      suppliedPackage: process.argv[3],
      runningExecutable: process.argv[4],
      asar: process.argv[5],
    });
  } else {
    const report = await runNativeVerification({
      packagedExecutable: process.argv[2],
      mode,
    });
    console.log(
      `Application confirmed ${report.mode} verification: Imnota ${report.version}; ${report.assertions?.length ?? 0} assertion groups.`,
    );
  }
} catch (error) {
  console.error(`Smoke verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
