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
  private pendingIsBackground = false;
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
  /**
   * Manual checks report progress and failures. Background checks (startup,
   * hourly) stay silent: they never flash a "checking" state over an already
   * discovered update and a discovery failure keeps the previous status. A
   * failed native preparation must invalidate the previous candidate because
   * electron-updater may already be configured for the new manifest.
   */
  check(options: { background?: boolean } = {}): Promise<void> {
    if (this.pending) {
      if (!options.background && this.pendingIsBackground) {
        this.pendingIsBackground = false;
        this.send({ state: 'checking' });
      }
      return this.pending;
    }
    if (this.switching || ['downloading', 'downloaded'].includes(this.status.state)) return Promise.resolve();
    if (!this.ops.enabled) {
      if (!options.background)
        this.send({ state: 'idle', message: 'Update checks are available in installed release builds.' });
      return Promise.resolve();
    }
    const previous = { status: this.getStatus(), candidate: this.candidate, terminal: this.terminalUpdate };
    let nativePreparationStarted = false;
    this.candidate = null;
    this.terminalUpdate = null;
    this.pendingIsBackground = options.background === true;
    if (!options.background) this.send({ state: 'checking' });
    this.pending = this.performCheck(() => {
      nativePreparationStarted = true;
    })
      .catch(() => {
        if (this.pendingIsBackground && !nativePreparationStarted) {
          this.candidate = previous.candidate;
          this.terminalUpdate = previous.terminal;
          this.status = previous.status;
          return;
        }
        this.candidate = null;
        this.send({
          state: 'error',
          message:
            'Could not check this channel. Check your connection or try again later. Your projects are unchanged.',
        });
      })
      .finally(() => {
        this.pending = null;
        this.pendingIsBackground = false;
      });
    return this.pending;
  }
  private async performCheck(onNativePreparationStart: () => void) {
    const candidate = await this.ops.discover(this.channel);
    if (!candidate) {
      this.send({ state: 'not-available', message: `No ${this.channel} build is available yet.` });
      return;
    }
    const comparison = compareReleaseVersions(candidate.version, this.ops.currentVersion);
    const sourceChannel = candidate.sourceChannel ?? this.channel;
    const stableFallback = this.channel === 'nightly' && sourceChannel === 'stable';
    if (comparison <= 0) {
      this.candidate = candidate;
      this.send({
        state: 'not-available',
        version: candidate.version,
        releaseUrl: candidate.url,
        releaseNotes: candidate.releaseNotes,
        sourceChannel: candidate.sourceChannel,
        manualDownload: comparison < 0,
        message:
          comparison < 0
            ? `Installed version is newer than ${sourceChannel} ${candidate.version}. Automatic downgrades are disabled. Back up your workspace before manually replacing the app.${stableFallback ? ' Nightly remains selected for future checks.' : ''}`
            : stableFallback
              ? `You’re on stable ${candidate.version}, the newest build currently available. Nightly remains selected for future checks.`
              : `You’re on the latest ${this.channel} version.`,
      });
      return;
    }
    if (!this.ops.manual) {
      onNativePreparationStart();
      await this.ops.prepare(candidate, candidate.sourceChannel ?? this.channel);
    }
    this.candidate = candidate;
    this.send({
      state: 'available',
      version: candidate.version,
      releaseUrl: candidate.url,
      releaseNotes: candidate.releaseNotes,
      sourceChannel: candidate.sourceChannel,
      manualDownload: this.ops.manual,
      terminalCommand: this.terminalUpdate?.command,
      message: stableFallback
        ? `Stable ${candidate.version} is newer than the latest nightly. Nightly remains selected for future checks.`
        : undefined,
    });
  }
  progress(percent: number) {
    if (this.status.state === 'downloading' && Number.isFinite(percent))
      this.send({ ...this.status, percent: Math.max(0, Math.min(percent, 100)) });
  }
  async download() {
    if (this.switching) throw new Error('Check for an update first.');
    if (this.pending) await this.check();
    if (!this.candidate) throw new Error('No update is available to download.');
    if (this.status.manualDownload) {
      if (!this.terminalUpdate && this.ops.prepareTerminal && this.status.state === 'available') {
        try {
          this.terminalUpdate = await this.ops.prepareTerminal(this.candidate);
          this.send({ ...this.status, terminalCommand: this.terminalUpdate.command });
        } catch {
          this.candidate = null;
          this.send({
            state: 'error',
            message:
              'The download could not be prepared. Check for updates to retry. Your projects are unchanged.',
          });
          return;
        }
      }
      if (this.terminalUpdate) {
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
    this.send({ ...this.status, state: 'downloading', percent: 0, message: undefined });
    try {
      await this.ops.download();
      this.send({ ...this.status, state: 'downloaded', percent: 100, message: undefined });
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
