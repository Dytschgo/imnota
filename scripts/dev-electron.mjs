import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import electron from 'electron';

export const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export function createElectronEnvironment(sourceEnvironment = process.env) {
  const environment = { ...sourceEnvironment };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

export function launchElectron({
  command = electron,
  args = ['.'],
  cwd = process.cwd(),
  environment = process.env,
  processHost = process,
  spawnProcess = spawn,
} = {}) {
  const child = spawnProcess(command, args, {
    cwd,
    env: createElectronEnvironment(environment),
    stdio: 'inherit',
  });
  const signalHandlers = new Map();
  let settled = false;

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      processHost.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (!child.killed) child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    processHost.on(signal, handler);
  }

  child.once('error', (error) => {
    if (settled) return;
    settled = true;
    removeSignalHandlers();
    console.error(`Unable to launch Electron: ${error.message}`);
    processHost.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    removeSignalHandlers();
    if (signal) {
      processHost.kill(processHost.pid, signal);
      return;
    }
    processHost.exitCode = code ?? 1;
  });

  return child;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) launchElectron();
