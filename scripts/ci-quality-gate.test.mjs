import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { dump, load } from 'js-yaml';
import { QUALITY_GATE_JOBS, qualityGateErrors } from './ci-quality-gate.mjs';

function successfulNeeds(docsOnly = 'false') {
  return Object.fromEntries(
    QUALITY_GATE_JOBS.map((job) => [
      job,
      { result: 'success', outputs: job === 'changes' ? { docs_only: docsOnly } : {} },
    ]),
  );
}

test('all successful jobs pass for PRs and main pushes', () => {
  for (const event of ['pull_request', 'push']) {
    assert.deepEqual(qualityGateErrors(successfulNeeds(), event), []);
  }
});

test('any failure or cancellation fails, including packaging and docs-only runs', () => {
  for (const docsOnly of ['false', 'true']) {
    for (const job of QUALITY_GATE_JOBS) {
      for (const result of ['failure', 'cancelled']) {
        const needs = successfulNeeds(docsOnly);
        needs[job].result = result;
        assert.deepEqual(qualityGateErrors(needs, 'pull_request'), [`${job}: ${result} (success required)`]);
      }
    }
  }
});

test('only a successful docs-only PR classification permits package/service skips', () => {
  const needs = successfulNeeds('true');
  needs.package.result = 'skipped';
  needs['share-service'].result = 'skipped';
  assert.deepEqual(qualityGateErrors(needs, 'pull_request'), []);
  for (const docsOnly of ['false', undefined, '', 'TRUE']) {
    needs.changes.outputs.docs_only = docsOnly;
    assert.equal(qualityGateErrors(needs, 'pull_request').length, 2);
  }
  needs.changes.outputs.docs_only = 'true';
  assert.equal(qualityGateErrors(needs, 'push').length, 2);
  needs.changes.result = 'failure';
  assert.equal(qualityGateErrors(needs, 'pull_request').length, 3);
});

test('required skips fail even on docs-only PRs; dependency review may skip only on push', () => {
  for (const job of ['changes', 'quality-checks', 'dependency-review']) {
    const needs = successfulNeeds('true');
    needs[job].result = 'skipped';
    assert.equal(qualityGateErrors(needs, 'pull_request').length, 1, job);
  }
  const needs = successfulNeeds();
  needs['dependency-review'].result = 'skipped';
  assert.deepEqual(qualityGateErrors(needs, 'push'), []);
});

test('missing or unknown results and unsupported events fail closed', () => {
  for (const result of [undefined, '', 'pending', 'neutral']) {
    const needs = successfulNeeds();
    needs.package.result = result;
    assert.equal(qualityGateErrors(needs, 'pull_request').length, 1);
  }
  const needs = successfulNeeds();
  delete needs.package;
  assert.equal(qualityGateErrors(needs, 'pull_request').length, 1);
  assert.equal(qualityGateErrors(null, 'pull_request').length, QUALITY_GATE_JOBS.length);
  assert.equal(qualityGateErrors(successfulNeeds(), 'workflow_dispatch').length, 1);
  needs.package = { result: 'success' };
  needs.future = { result: 'failure' };
  assert.equal(qualityGateErrors(needs, 'pull_request').length, 1);
});

test('CLI exits unsuccessfully for package failure, cancellation and malformed input', () => {
  const script = fileURLToPath(new URL('./ci-quality-gate.mjs', import.meta.url));
  for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
    const needs = successfulNeeds();
    needs.package.result = result;
    const cli = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, IMNOTA_CI_NEEDS: JSON.stringify(needs), GITHUB_EVENT_NAME: 'pull_request' },
    });
    assert.equal(cli.status, result === 'success' ? 0 : 1, cli.stderr);
    if (result !== 'success') assert.match(cli.stderr, new RegExp(`package: ${result}`));
  }
  const malformed = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, IMNOTA_CI_NEEDS: '{', GITHUB_EVENT_NAME: 'pull_request' },
  });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Cannot evaluate Validate dependencies/);
});

function assertWorkflowJobCoverage(workflow) {
  const { jobs } = load(workflow);
  assert.ok(jobs, 'workflow must define jobs');
  const aggregate = jobs.quality;
  assert.ok(aggregate, 'quality job must retain its required check name');
  const requiredJobs = Object.keys(jobs)
    .filter((job) => job !== 'quality')
    .sort();
  const needs = typeof aggregate.needs === 'string' ? [aggregate.needs] : aggregate.needs;
  assert.deepEqual(
    needs?.slice().sort(),
    requiredJobs,
    'quality.needs must include every other workflow job',
  );
  assert.deepEqual(
    [...QUALITY_GATE_JOBS].sort(),
    requiredJobs,
    'every workflow job must have a quality gate policy entry',
  );
  return aggregate;
}

test('a commented job missing from quality.needs and the policy fails workflow coverage', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const withFutureJob = `${workflow}\n  future-required-gate: # required security scan
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
`;
  assert.throws(
    () => assertWorkflowJobCoverage(withFutureJob),
    /quality.needs must include every other workflow job/,
  );

  const withDependency = load(withFutureJob);
  withDependency.jobs.quality.needs.push('future-required-gate');
  assert.throws(
    () => assertWorkflowJobCoverage(dump(withDependency)),
    /every workflow job must have a quality gate policy entry/,
  );
});

test('required quality context always waits for every workflow job and passes classifier outputs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const aggregate = assertWorkflowJobCoverage(workflow);
  assert.equal(Object.hasOwn(aggregate, 'name'), false, 'do not rename the required context');
  assert.equal(aggregate.if, '${{ always() }}');
  const gateStep = aggregate.steps.find((step) => step.run === 'node scripts/ci-quality-gate.mjs');
  assert.ok(gateStep, 'quality must run the gate script');
  assert.equal(gateStep.env?.IMNOTA_CI_NEEDS, '${{ toJSON(needs) }}');
});
