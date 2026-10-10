import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { packagedSmokePreflight } from './verify-packaged.mjs';

const everything = () => true;

test('preflight passes when the packaged build, display and sudo are present', () => {
  const previous = process.env.DISPLAY;
  process.env.DISPLAY = ':99';
  try {
    const result = packagedSmokePreflight({
      platform: 'linux',
      version: '1.2.3',
      has: everything,
      command: everything,
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.target, resolve('release', 'Imnota-1.2.3.AppImage'));
  } finally {
    if (previous === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = previous;
  }
});

test('preflight names the build command for each missing artifact', () => {
  const linux = packagedSmokePreflight({
    platform: 'linux',
    version: '1.2.3',
    has: () => false,
    command: everything,
  });
  assert.match(
    linux.problems[0],
    /^Run "pnpm package:linux" first \(expected .*Imnota-1\.2\.3\.AppImage\)\.$/,
  );
  assert.ok(linux.problems.some((problem) => problem.includes('Run "pnpm build" first')));
  const windows = packagedSmokePreflight({
    platform: 'windows',
    version: '1.2.3',
    has: () => false,
    command: everything,
  });
  assert.match(windows.problems[0], /^Run "pnpm package:win" first \(expected .*Imnota 1\.2\.3\.exe\)\.$/);
  assert.match(windows.problems[1], /win-unpacked/);
  assert.deepEqual(packagedSmokePreflight({ platform: 'plan9', version: '1' }).problems, [
    'Unsupported packaged smoke platform plan9. Use linux or windows.',
  ]);
});

test('preflight requires a display and sudo on linux', () => {
  const previous = { DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY };
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  try {
    const { problems } = packagedSmokePreflight({
      platform: 'linux',
      version: '1',
      has: everything,
      command: () => false,
    });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /xvfb-run --auto-servernum/);
    assert.match(problems[1], /sudo is required/);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value !== undefined) process.env[key] = value;
  }
});

test('a fresh clone without a build exits 2 with a clean "build first" message and no stack trace', () => {
  const empty = mkdtempSync(join(tmpdir(), 'imnota-verify-packaged-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/verify-packaged.mjs', 'linux', empty], {
      encoding: 'utf8',
      env: { ...process.env, DISPLAY: ':99', IMNOTA_EXPECT_VERSION: '9.9.9' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Packaged smoke cannot start: build first\./);
    assert.ok(
      result.stderr.includes(
        `Run "pnpm package:linux" first (expected ${join(empty, 'Imnota-9.9.9.AppImage')}).`,
      ),
    );
    assert.doesNotMatch(result.stderr, /ENOENT|\n\s+at /);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
