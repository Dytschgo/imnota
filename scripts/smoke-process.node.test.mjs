import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { URL } from 'node:url';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isStrictChild,
  normalizeNativeVerificationMode,
  nativeVerificationEnvironment,
  prepareArtifactDirectory,
  removeRunDirectory,
} from './smoke-process.mjs';

const temporary = [];
const temporaryRoot = realpathSync(tmpdir());
afterEach(() => {
  for (const target of temporary.splice(0)) rmSync(target, { recursive: true, force: true });
});

describe('native smoke process safety', () => {
  it('fails promptly and kills a signal-resistant child on SIGTERM', { timeout: 10_000 }, async (t) => {
    const helper = new URL('./walkthrough-child.mjs', import.meta.url).href;
    const childCode = `
      process.on('SIGTERM', () => {});
      process.on('SIGINT', () => {});
      console.log(process.pid);
      setInterval(() => {}, 60_000);
    `;
    const launcher = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import { runWalkthroughChild } from ${JSON.stringify(helper)};
      process.on('message', signal => process.emit(signal));
      try {
        await runWalkthroughChild(process.execPath, ['--eval', ${JSON.stringify(childCode)}]);
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      } finally {
        process.disconnect();
      }
    `,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    let childPid;
    t.after(() => {
      launcher.kill();
      if (childPid) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    });
    let stderr = '';
    launcher.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exit = once(launcher, 'exit');
    const [ready] = await once(launcher.stdout, 'data');
    childPid = Number(ready.toString().trim());
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    // Windows cannot deliver POSIX signals with process.kill; IPC emits the
    // launcher's actual SIGTERM event on every OS after its child is ready.
    launcher.send('SIGTERM');
    const [code] = await exit;
    assert.equal(code, 1, stderr);
    assert.match(stderr, /cancelled by SIGTERM/);
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  });
  it('selects the focused clipboard workflow explicitly', () => {
    assert.equal(normalizeNativeVerificationMode(), 'smoke');
    assert.equal(normalizeNativeVerificationMode('clipboard'), 'clipboard');
    assert.throws(() => normalizeNativeVerificationMode('unknown'), /Unknown native verification mode/);
  });
  it('uses built renderer assets and enables synthetic capture only on supported native platforms', () => {
    const inherited = {
      ELECTRON_RUN_AS_NODE: '1',
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
      IMNOTA_SMOKE_CAPTURE_SOURCE: 'real',
      PATH: 'test',
    };
    assert.deepEqual(nativeVerificationEnvironment(inherited, 'win32'), {
      PATH: 'test',
      IMNOTA_SMOKE_CAPTURE_SOURCE: 'synthetic',
    });
    assert.deepEqual(nativeVerificationEnvironment(inherited, 'darwin'), {
      PATH: 'test',
      IMNOTA_SMOKE_CAPTURE_SOURCE: 'synthetic',
    });
    assert.deepEqual(nativeVerificationEnvironment(inherited, 'linux'), { PATH: 'test' });
    assert.deepEqual(
      nativeVerificationEnvironment(
        { ...inherited, IMNOTA_SMOKE_CAPTURE_CAPABILITY: 'real-memory-only' },
        'win32',
      ),
      { PATH: 'test', IMNOTA_SMOKE_CAPTURE_CAPABILITY: 'real-memory-only' },
    );
    assert.equal(inherited.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(inherited.VITE_DEV_SERVER_URL, 'http://localhost:5173');
    assert.equal(inherited.IMNOTA_SMOKE_CAPTURE_SOURCE, 'real');
  });
  it('accepts a dedicated newly created artifact directory and rejects broad names', () => {
    const parent = mkdtempSync(join(temporaryRoot, 'imnota-smoke-script-test-'));
    temporary.push(parent);
    const target = join(parent, 'imnota-verification-artifacts-ci');
    assert.equal(prepareArtifactDirectory(target), resolve(target));
    assert.throws(() => prepareArtifactDirectory(parent), /dedicated/);
    assert.equal(isStrictChild(parent, target), true);
    assert.equal(isStrictChild(parent, parent), false);
  });

  it('rejects artifact aliases and existing reports', () => {
    const parent = mkdtempSync(join(temporaryRoot, 'imnota-smoke-script-test-'));
    temporary.push(parent);
    const real = join(parent, 'real-artifacts');
    const alias = join(parent, 'imnota-smoke-artifacts-link');
    mkdirSync(real);
    let aliasCreated = false;
    try {
      symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
      aliasCreated = true;
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
    if (aliasCreated) assert.throws(() => prepareArtifactDirectory(alias), /link|alias/);
    const existing = join(parent, 'imnota-smoke-artifacts-existing');
    mkdirSync(existing);
    writeFileSync(join(existing, 'verification-report.json'), '{}');
    assert.throws(() => prepareArtifactDirectory(existing), /newly created|empty/);
  });

  it('refuses cleanup outside its exact temporary result namespace', () => {
    const parent = mkdtempSync(join(temporaryRoot, 'imnota-smoke-script-test-'));
    temporary.push(parent);
    assert.throws(() => removeRunDirectory(parent), /Refusing/);
    const matchingButUnowned = join(temporaryRoot, 'imnota-smoke-result-unowned-test');
    mkdirSync(matchingButUnowned, { recursive: true });
    temporary.push(matchingButUnowned);
    assert.throws(() => removeRunDirectory(matchingButUnowned), /ownership marker/);
    assert.doesNotThrow(() => removeRunDirectory(resolve(temporaryRoot, 'imnota-smoke-result-not-created')));
  });
});
