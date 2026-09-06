import type { UpdateChannel, UpdateStatus } from '../src/shared/types.js';
import { compareReleaseVersions, type ReleaseCandidate } from './releases.js';

interface Operations {
  currentVersion: string;
  enabled: boolean;
  manual: boolean;
  discover: (channel: UpdateChannel) => Promise<ReleaseCandidate | null>;
  prepare: (release: ReleaseCandidate, channel: UpdateChannel) => Promise<void>;
  download: () => Promise<unknown>;
  install: () => void | Promise<void>;
  open: (url: string) => Promise<unknown>;
  prepareTerminal?: (release: ReleaseCandidate) => Promise<{ command: string; run: () => Promise<void> }>;
  emit: (status: UpdateStatus) => void;
}

/** One update operation at a time: a selected release can never cross channels. */
export class UpdateController {
  private status: UpdateStatus;
  private candidate: ReleaseCandidate | null = null;
  private pending: Promise<void> | null = null;
  private switching = false;
  private terminalUpdate: { command: string; run: () => Promise<void> } | null = null;
  private launchingTerminal = false;
  constructor(
    private channel: UpdateChannel,
    private readonly ops: Operations,
  ) {
    this.status = { state: 'idle', channel, currentVersion: ops.currentVersion };
  }
  getStatus() {
    return { ...this.status };
  }
  private send(status: UpdateStatus) {
    this.status = { currentVersion: this.ops.currentVersion, channel: this.channel, ...status };
    this.ops.emit(this.getStatus());
  }
  async switchChannel(channel: UpdateChannel, persist: () => Promise<void>) {
    if (
      this.switching ||
      this.pending ||
      ['checking', 'downloading', 'downloaded'].includes(this.status.state)
    )
      throw new Error('Finish the current update check or installation before switching channels.');
    this.switching = true;
    try {
      await persist();
      this.channel = channel;
      this.candidate = null;
      this.send({ state: 'idle' });
    } finally {
      this.switching = false;
    }
    void this.check();
  }
  check(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.switching || ['downloading', 'downloaded'].includes(this.status.state)) return Promise.resolve();
    if (!this.ops.enabled) {
      this.send({ state: 'idle', message: 'Update checks are available in installed release builds.' });
      return Promise.resolve();
    }
    this.candidate = null;
    this.terminalUpdate = null;
    this.send({ state: 'checking' });
    this.pending = this.performCheck()
      .catch(() => {
        this.candidate = null;
        this.send({
          state: 'error',
          message:
            'Could not check this channel. Check your connection or try again later. Your projects are unchanged.',
        });
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  private async performCheck() {
    const candidate = await this.ops.discover(this.channel);
    if (!candidate) {
      this.send({ state: 'not-available', message: `No ${this.channel} build is available yet.` });
      return;
    }
    const comparison = compareReleaseVersions(candidate.version, this.ops.currentVersion);
    if (comparison <= 0) {
      this.candidate = candidate;
      this.send({
        state: 'not-available',
        version: candidate.version,
        releaseUrl: candidate.url,
        manualDownload: comparison < 0,
        message:
          comparison < 0
            ? `Installed version is newer than ${this.channel} ${candidate.version}. Automatic downgrades are disabled. Back up your workspace before manually replacing the app.`
            : `You’re on the latest ${this.channel} version.`,
      });
      return;
    }
    if (!this.ops.manual) await this.ops.prepare(candidate, this.channel);
    if (this.ops.manual && this.ops.prepareTerminal)
      this.terminalUpdate = await this.ops.prepareTerminal(candidate);
    this.candidate = candidate;
    this.send({
      state: 'available',
      version: candidate.version,
      releaseUrl: candidate.url,
      manualDownload: this.ops.manual,
      terminalCommand: this.terminalUpdate?.command,
    });
  }
  progress(percent: number) {
    if (this.status.state === 'downloading' && Number.isFinite(percent))
      this.send({ ...this.status, percent: Math.max(0, Math.min(percent, 100)) });
  }
  async download() {
    if (!this.candidate || this.switching || this.pending) throw new Error('Check for an update first.');
    if (this.status.manualDownload) {
      if (this.terminalUpdate && this.status.state === 'available') {
        if (this.launchingTerminal) return;
        this.launchingTerminal = true;
        try {
          await this.terminalUpdate.run();
        } finally {
          this.launchingTerminal = false;
        }
        return;
      }
      await this.ops.open(this.candidate.url);
      return;
    }
    if (this.status.state !== 'available') throw new Error('No update is ready to download.');
    this.send({ ...this.status, state: 'downloading', percent: 0 });
    try {
      await this.ops.download();
      this.send({ ...this.status, state: 'downloaded', percent: 100 });
    } catch {
      this.candidate = null;
      this.send({
        state: 'error',
        message: 'The download failed. Check for updates to retry. Your projects are unchanged.',
      });
    }
  }
  async install() {
    if (this.status.state !== 'downloaded' || this.ops.manual || this.status.installing)
      throw new Error('Download an update before installing.');
    this.send({ ...this.status, installing: true, message: 'Preparing to restart…' });
    try {
      await this.ops.install();
    } catch {
      this.installationFailed();
      throw new Error('The update could not be installed. Your current app is still available.');
    }
  }
  installationFailed() {
    if (!this.status.installing) return;
    this.send({
      ...this.status,
      installing: false,
      message: 'Installation could not start. Your current app is unchanged. Try restarting to update again.',
    });
  }
}
