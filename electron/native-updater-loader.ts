/** The parts of electron-updater's `autoUpdater` that are configured before first use. */
export interface ConfigurableNativeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface NativeUpdaterEvents {
  progress(percent: number): void;
  /** Asynchronous native failure; check and download promises report their own errors. */
  error(): void;
}

/**
 * Loads the native updater on first use instead of at startup. The updater is configured
 * and observed before any caller receives it, so no updater call can run unconfigured.
 * A failed load rejects that call and is attempted again by the next one.
 */
export function createNativeUpdaterLoader<Updater extends ConfigurableNativeUpdater>(
  load: () => Promise<Updater>,
  events: NativeUpdaterEvents,
) {
  let loaded: Updater | undefined;
  let loading: Promise<Updater> | undefined;
  return {
    /** The configured updater, once a load has completed. */
    get loaded(): Updater | undefined {
      return loaded;
    },
    load(): Promise<Updater> {
      loading ??= load()
        .then((updater) => {
          updater.autoDownload = false;
          updater.autoInstallOnAppQuit = false;
          updater.on('download-progress', (progress) => events.progress(progress.percent));
          updater.on('error', () => events.error());
          loaded = updater;
          return updater;
        })
        .catch((error: unknown) => {
          loading = undefined;
          throw error;
        });
      return loading;
    },
  };
}
