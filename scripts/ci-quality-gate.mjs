import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QUALITY_GATE_JOBS = [
  'changes',
  'quality-checks',
  'share-service',
  'package',
  'dependency-review',
];

export function qualityGateErrors(needs, eventName) {
  const docsOnly =
    eventName === 'pull_request' &&
    needs?.changes?.result === 'success' &&
    needs.changes.outputs?.docs_only === 'true';
  const allowedSkips = new Set([
    ...(docsOnly ? ['package', 'share-service'] : []),
    ...(eventName === 'push' ? ['dependency-review'] : []),
  ]);
  const errors = [];
  if (!['pull_request', 'push'].includes(eventName)) {
    errors.push(`Unsupported Validate event: ${eventName}`);
  }
  // Missing/unknown results fail closed too. Inspect extra dependencies so a new
  // job cannot hide a failure even before it receives an explicit skip policy.
  for (const job of new Set([...QUALITY_GATE_JOBS, ...Object.keys(needs ?? {})])) {
    const result = needs?.[job]?.result;
    if (result === 'success' || (result === 'skipped' && allowedSkips.has(job))) continue;
    errors.push(`${job}: ${result ?? 'missing result'} (success required)`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = qualityGateErrors(
      JSON.parse(process.env.IMNOTA_CI_NEEDS ?? ''),
      process.env.GITHUB_EVENT_NAME,
    );
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('All applicable Validate jobs succeeded.');
    }
  } catch (error) {
    console.error('Cannot evaluate Validate dependencies:', error.message);
    process.exitCode = 1;
  }
}
