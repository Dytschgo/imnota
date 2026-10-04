import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { terminalUpdateArguments } from './terminal-update.js';
import type { ReleaseCandidate } from './releases.js';
import { UpdateFailure } from './update-controller.js';

interface SessionEvents {
  progress: (percent: number) => void;
  /** The helper stopped after the download was ready; nothing will be installed. */
  failed: (message: string) => void;
}

const HELPER_STOPPED = 'The update helper stopped before the update was installed.';

/**
 * Follows the background `update-macos.sh --in-app` helper through its log:
 * download progress, the verified-and-waiting marker, and its failure reason.
 * Installation is requested with SIGUSR1; the helper then waits for Imnota to
 * quit, replaces the app and reopens it (or restores and reopens the old one).
 */
export class MacUpdateSession {
  readonly ready: Promise<void>;
  private state: 'downloading' | 'ready' | 'installing' | 'exited' = 'downloading';
  private buffer = '';
  private archiveStarted = false;
  private failure: string | undefined;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    private readonly signal: (signal: NodeJS.Signals) => boolean,
    private readonly events: SessionEvents,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  get downloading() {
    return this.state === 'downloading';
  }
  /** The helper has exited; `failureMessage` explains why when it stopped early. */
  get finished() {
    return this.state === 'exited';
  }
  get failureMessage() {
    return this.failure ?? HELPER_STOPPED;
  }

  /** Accepts log output in arbitrary chunks; curl progress segments end in a carriage return. */
  consume(text: string) {
    this.buffer += text;
    const segments = this.buffer.split(/[\r\n]/);
    this.buffer = segments.pop() ?? '';
    for (const segment of segments) this.segment(segment);
  }

  install() {
    if (this.state !== 'ready') throw new Error('The downloaded update is no longer available.');
    if (!this.signal('SIGUSR1')) throw new Error('The update helper is no longer running.');
    this.state = 'installing';
  }

  /** Called with the final log contents once the helper exits. */
  exited(code: number | null, remaining = '') {
    if (this.state === 'exited') return;
    this.consume(remaining);
    this.segment(this.buffer);
    this.buffer = '';
    const previous = this.state;
    this.state = 'exited';
    if (previous === 'downloading') this.rejectReady(new UpdateFailure(this.failure ?? HELPER_STOPPED));
    else if (previous === 'ready' || code !== 0) this.events.failed(this.failure ?? HELPER_STOPPED);
  }

  private segment(line: string) {
    const failed = /Update failed: (.+)$/.exec(line);
    if (failed) this.failure = failed[1].trim();
    if (line === 'IMNOTA_UPDATE archive') this.archiveStarted = true;
    else if (line === 'IMNOTA_UPDATE ready' && this.state === 'downloading') {
      this.state = 'ready';
      this.events.progress(100);
      this.resolveReady();
    } else if (this.archiveStarted && this.state === 'downloading') {
      const percent = /(\d{1,3}(?:\.\d+)?)%\s*$/.exec(line);
      if (percent) this.events.progress(Math.min(Number(percent[1]), 100));
    }
  }
}

/**
 * Copies the helper out of the app bundle it will replace and starts it in
 * its own session with output in a log file, so it survives Imnota quitting.
 */
export async function startMacUpdate(
  release: ReleaseCandidate,
  options: { appPath: string; appPid: number; helperPath: string; cachePath: string; currentVersion: string },
  events: SessionEvents,
  pollMs = 250,
): Promise<MacUpdateSession> {
  const args = terminalUpdateArguments(release, options.appPath, options.currentVersion);
  const directory = await fs.mkdtemp(path.join(options.cachePath, 'imnota-update-'));
  const helper = path.join(directory, 'update-macos.sh');
  const logPath = path.join(directory, 'update.log');
  await fs.copyFile(options.helperPath, helper);
  await fs.chmod(helper, 0o700);
  const log = await fs.open(logPath, 'a', 0o600);
  let child;
  try {
    child = spawn('/bin/bash', [helper, '--in-app', String(options.appPid), ...args], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
  } finally {
    await log.close();
  }
  child.unref();
  const reader = await fs.open(logPath, 'r');
  let offset = 0;
  const read = async () => {
    let text = '';
    for (;;) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await reader.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) return text;
      offset += bytesRead;
      text += chunk.subarray(0, bytesRead).toString('utf8');
    }
  };
  const session = new MacUpdateSession((signal) => child.exitCode === null && child.kill(signal), events);
  let reading = Promise.resolve();
  // Progress only matters until the update is verified; the exit handler reads the rest.
  const poll = () => {
    if (!session.downloading) clearInterval(timer);
    else reading = reading.then(async () => session.consume(await read())).catch(() => undefined);
  };
  const timer = setInterval(poll, pollMs);
  // Exit is reported after the final log read so its failure reason is never lost.
  const finish = (code: number | null) => {
    clearInterval(timer);
    void reading
      .then(read)
      .catch(() => '')
      .then((remaining) => {
        session.exited(code, remaining);
        return reader.close();
      })
      .then(() => fs.rm(directory, { recursive: true, force: true }))
      .catch(() => undefined);
  };
  child.once('exit', finish);
  child.once('error', () => finish(null));
  return session;
}
