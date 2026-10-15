import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
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

test('required quality context always waits for every workflow job and passes classifier outputs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobGraph = workflow.split(/^jobs:\r?$/m)[1];
  assert.ok(jobGraph, 'workflow must define jobs');
  const jobs = [...jobGraph.matchAll(/^  ([\w-]+):\r?$/gm)].map((match) => match[1]);
  assert.deepEqual(jobs.filter((job) => job !== 'quality').sort(), [...QUALITY_GATE_JOBS].sort());
  const aggregate = /^  quality:\r?\n([\s\S]*?)(?=^  [\w-]+:)/m.exec(workflow)?.[1];
  assert.ok(aggregate, 'quality job must retain its required check name');
  assert.doesNotMatch(aggregate, /^    name:/m, 'do not rename the required context');
  const needs = /^    needs: \[([^\]]+)\]/m
    .exec(aggregate)?.[1]
    .split(',')
    .map((job) => job.trim());
  assert.deepEqual(needs?.sort(), [...QUALITY_GATE_JOBS].sort());
  assert.match(aggregate, /^    if: \$\{\{ always\(\) \}\}\r?$/m);
  assert.match(aggregate, /IMNOTA_CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(aggregate, /run: node scripts\/ci-quality-gate\.mjs/);
});
