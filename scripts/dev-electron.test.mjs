import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createElectronEnvironment, forwardedSignals, launchElectron } from './dev-electron.mjs';

function createHarness() {
  const child = new EventEmitter();
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    return true;
  };

  const processHost = new EventEmitter();
  processHost.pid = 42;
  processHost.exitCode = undefined;
  processHost.signals = [];
  processHost.kill = (pid, signal) => {
    processHost.signals.push([pid, signal]);
  };

  let spawnCall;
  const spawnProcess = (command, args, options) => {
    spawnCall = { command, args, options };
    return child;
  };

  return { child, processHost, spawnProcess, getSpawnCall: () => spawnCall };
}

test('removes only ELECTRON_RUN_AS_NODE from a copied environment', () => {
  const source = {
    ELECTRON_RUN_AS_NODE: '1',
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    IMNOTA_EXAMPLE: 'kept',
  };

  assert.deepEqual(createElectronEnvironment(source), {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    IMNOTA_EXAMPLE: 'kept',
  });
  assert.equal(source.ELECTRON_RUN_AS_NODE, '1');
});

test('launches Electron with the sanitized environment and inherited stdio', () => {
  const harness = createHarness();
  launchElectron({
    command: 'electron-test',
    args: ['.'],
    cwd: 'test-worktree',
    environment: {
      ELECTRON_RUN_AS_NODE: '1',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      PATH: 'kept',
    },
    processHost: harness.processHost,
    spawnProcess: harness.spawnProcess,
  });

  assert.deepEqual(harness.getSpawnCall(), {
    command: 'electron-test',
    args: ['.'],
    options: {
      cwd: 'test-worktree',
      env: {
        VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
        PATH: 'kept',
      },
      stdio: 'inherit',
    },
  });
});

test('forwards terminal signals to Electron and mirrors its exit code', () => {
  const harness = createHarness();
  launchElectron({ processHost: harness.processHost, spawnProcess: harness.spawnProcess });

  harness.processHost.emit('SIGTERM');
  assert.deepEqual(harness.child.signals, ['SIGTERM']);

  harness.child.emit('exit', 7, null);
  assert.equal(harness.processHost.exitCode, 7);
  for (const signal of forwardedSignals) {
    assert.equal(harness.processHost.listenerCount(signal), 0);
  }
});

test('mirrors an Electron signal exit after removing relay listeners', () => {
  const harness = createHarness();
  launchElectron({ processHost: harness.processHost, spawnProcess: harness.spawnProcess });

  harness.child.emit('exit', null, 'SIGINT');
  assert.deepEqual(harness.processHost.signals, [[42, 'SIGINT']]);
  for (const signal of forwardedSignals) {
    assert.equal(harness.processHost.listenerCount(signal), 0);
  }
});
