export interface DisposableTray {
  destroy(): void;
}

export function onSuccessfulQuit(
  events: { once(event: 'will-quit', listener: () => void): unknown },
  cleanup: () => void,
): void {
  events.once('will-quit', cleanup);
}

/** Run only from Electron's `will-quit`: before-quit may still be cancelled by a renderer. */
export function teardownTrayAfterSuccessfulQuit(input: {
  tray: DisposableTray | null;
  clearCaptureShortcut(): void;
  stopProjectWatches(): void;
}): null {
  input.clearCaptureShortcut();
  input.tray?.destroy();
  input.stopProjectWatches();
  return null;
}
