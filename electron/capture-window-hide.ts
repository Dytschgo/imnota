/** The window surface capture hides; BrowserWindow satisfies it. */
export interface HideableWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  hide(): void;
  show(): void;
  setOpacity(opacity: number): void;
  once(event: 'hide', listener: () => void): unknown;
  removeListener(event: 'hide', listener: () => void): unknown;
}

const HIDE_EVENT_TIMEOUT_MS = 1000;
/** macOS keeps compositing a fading window briefly after it reports hidden. */
const MAC_HIDE_SETTLE_MS = 350;

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Hide Imnota before a still is taken, so it never appears in the capture.
 * macOS animates hiding; zero opacity removes the window from the next frame
 * immediately, then the hide event and a short settle cover the compositor.
 */
export async function hideWindowForCapture(
  window: HideableWindow | null | undefined,
  platform: NodeJS.Platform = process.platform,
  wait: (milliseconds: number) => Promise<void> = sleep,
): Promise<boolean> {
  if (!window || window.isDestroyed() || !window.isVisible()) return false;
  if (platform !== 'darwin') {
    window.hide();
    return true;
  }
  window.setOpacity(0);
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeListener('hide', finish);
      resolve();
    };
    window.once('hide', finish);
    window.hide();
    void wait(HIDE_EVENT_TIMEOUT_MS).then(finish);
  });
  await wait(MAC_HIDE_SETTLE_MS);
  return true;
}

/** Bring a window hidden for capture back with full opacity. */
export function restoreWindowAfterCapture(window: HideableWindow | null | undefined): void {
  if (!window || window.isDestroyed()) return;
  window.show();
  window.setOpacity(1);
}
