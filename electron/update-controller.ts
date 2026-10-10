import { afterFileCommit } from './files.js';
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
  emit: (status: UpdateStatus) => void;
}

/** A failure whose message is safe and useful to show the user. */
export class UpdateFailure extends Error {}

/** One update operation at a time: a selected release can never cross channels. */
export class UpdateController {
  private status: UpdateStatus;
  private candidate: ReleaseCandidate | null = null;
  private pending: Promise<void> | null = null;
  private pendingIsBackground = false;
  private switching = false;
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
      await afterFileCommit(persist, () => {
        this.channel = channel;
        this.candidate = null;
        this.send({ state: 'idle' });
      });
    } finally {
      this.switching = false;
    }
    void this.check();
  }
  /**
   * Manual checks report progress and failures. Background checks (startup,
   * hourly) stay silent: they never flash a "checking" state over an already
   * discovered update and a discovery failure keeps the previous status. A
   * failed preparation must invalidate the previous candidate because a
   * native updater may already target the new release.
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
    const previous = { status: this.getStatus(), candidate: this.candidate };
    let preparationStarted = false;
    this.candidate = null;
    this.pendingIsBackground = options.background === true;
    if (!options.background) this.send({ state: 'checking' });
    this.pending = this.performCheck(() => {
      preparationStarted = true;
    })
      .catch(() => {
        if (this.pendingIsBackground && !preparationStarted) {
          this.candidate = previous.candidate;
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
  private async performCheck(onPreparationStart: () => void) {
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
      onPreparationStart();
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
      await this.ops.open(this.candidate.url);
      return;
    }
    if (this.status.state !== 'available') throw new Error('No update is ready to download.');
    this.send({ ...this.status, state: 'downloading', percent: 0, message: undefined });
    try {
      await this.ops.download();
      this.send({ ...this.status, state: 'downloaded', percent: 100, message: undefined });
    } catch (error) {
      this.candidate = null;
      this.send({
        state: 'error',
        message: `${error instanceof UpdateFailure ? `${error.message} ` : 'The download failed. '}Check for updates to retry. Your projects are unchanged.`,
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
  /** The downloaded update was discarded outside the controller, e.g. its helper stopped. */
  downloadLost(message: string) {
    if (this.status.state !== 'downloaded') return;
    this.candidate = null;
    this.send({
      state: 'error',
      message: `${message} Check for updates to retry. Your projects are unchanged.`,
    });
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
