import { runNativeVerification } from './smoke-process.mjs';

if (!process.env.IMNOTA_SMOKE_ARTIFACT_DIR) {
  console.error('Set IMNOTA_SMOKE_ARTIFACT_DIR to a new absolute imnota-verification-artifacts-* directory.');
  process.exitCode = 2;
} else {
  try {
    const report = await runNativeVerification({
      packagedExecutable: process.argv[2],
      mode: 'stress',
    });
    console.log(JSON.stringify({ artifacts: report.artifacts, timings: report.timings }, null, 2));
  } catch (error) {
    console.error(
      `Visual/performance verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
