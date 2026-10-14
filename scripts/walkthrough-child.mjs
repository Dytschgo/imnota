import { spawn } from 'node:child_process';
import { clearTimeout, setTimeout } from 'node:timers';

// A wrapper gives its Node child time to forward cancellation to a separately
// supervised Electron group before forcing the wrapper's own group to stop.
export function runWalkthroughChild(
  command,
  args,
  { timeoutMs, cancellationGraceMs = 1_000, forwardToGroup = true, ...options } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    let cancelled;
    let exited;
    let stopping = false;
    let forceKill;
    const handlers = new Map();
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    };
    const finish = () => {
      if (!exited || stopping) return;
      cleanup();
      if (cancelled) reject(new Error(`Native verification cancelled by ${cancelled}.`));
      else if (timedOut)
        reject(new Error(`Native verification exceeded its ${Math.round(timeoutMs / 1000)} second limit.`));
      else resolve(exited);
    };
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const stop = (signal, graceMs) => {
      if (stopping) return;
      stopping = true;
      if (process.platform === 'win32') {
        // Killing only the portable launcher first can orphan its extracted exe.
        const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('error', (error) => {
          console.error(`Unable to terminate native verification tree: ${error.message}`);
          child.kill('SIGKILL');
        });
        killer.once('close', () => {
          stopping = false;
          finish();
        });
      } else {
        // Forward to Node first so nested launchers can stop their own groups.
        if (forwardToGroup) killGroup(signal);
        else child.kill(signal);
        forceKill = setTimeout(() => {
          try {
            killGroup('SIGKILL');
          } catch (error) {
            console.error(`Unable to terminate native verification group: ${error.message}`);
            child.kill('SIGKILL');
          }
          stopping = false;
          finish();
        }, graceMs);
      }
    };
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            forceKill = setTimeout(() => stop('SIGKILL', 0), 5_000);
          }, timeoutMs);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        if (cancelled) return;
        cancelled = signal;
        clearTimeout(timeout);
        clearTimeout(forceKill);
        stop(signal, cancellationGraceMs);
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      exited = { code, signal };
      finish();
    });
  });
}
