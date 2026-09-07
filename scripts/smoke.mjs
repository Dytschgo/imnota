import { runNativeVerification } from './smoke-process.mjs';

try {
  const report = await runNativeVerification({
    packagedExecutable: process.argv[2],
    mode: process.env.IMNOTA_SMOKE_MODE === 'stress' ? 'stress' : 'smoke',
  });
  console.log(
    `Application confirmed ${report.mode} verification: Imnota ${report.version}; ${report.assertions?.length ?? 0} assertion groups.`,
  );
} catch (error) {
  console.error(`Smoke verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
