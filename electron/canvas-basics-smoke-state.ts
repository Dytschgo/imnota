import type { NativeUiDriver } from './smoke-native-driver.js';

/** Keep a focused resize exercise from changing later viewport-labelled captures. */
export async function withRestoredCanvasSmokeState(
  driver: NativeUiDriver,
  settleCanvas: () => Promise<void>,
  exercise: () => Promise<void>,
): Promise<void> {
  const position = driver.browserWindow.getPosition();
  const viewport = await driver.evaluate<{ width: number; height: number }>(`(() => {
    const originalFocus = document.activeElement;
    window.__imnotaRestoreCanvasBasicsFocus = () => {
      delete window.__imnotaRestoreCanvasBasicsFocus;
      if (!originalFocus?.isConnected) throw new Error('Original canvas smoke focus target was removed.');
      document.activeElement?.blur();
      originalFocus.focus({ preventScroll: true });
      if (document.activeElement !== originalFocus) throw new Error('Canvas smoke did not restore its original focus.');
    };
    return { width: window.innerWidth, height: window.innerHeight };
  })()`);
  let failed = false;
  let failure: unknown;
  try {
    await exercise();
  } catch (error) {
    failed = true;
    failure = error;
  }
  const cleanupErrors: unknown[] = [];
  const restore = async (operation: () => void | Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  await restore(() => driver.resize(viewport));
  await restore(() => {
    driver.browserWindow.setPosition(position[0], position[1], false);
    const actual = driver.browserWindow.getPosition();
    if (actual[0] !== position[0] || actual[1] !== position[1])
      throw new Error('Canvas smoke did not restore its original window position.');
  });
  await restore(async () => {
    // The native canvas walkthrough resumes in Fit mode, not the zoom-in used for this capture.
    await driver.evaluate(
      `document.querySelector('.konvajs-content').parentElement.dispatchEvent(new CustomEvent('imnota:canvas-command', { detail: 'fit' }))`,
    );
    await settleCanvas();
  });
  await restore(() => driver.evaluate<void>('window.__imnotaRestoreCanvasBasicsFocus()'));
  if (cleanupErrors.length)
    throw new AggregateError(
      [...(failed ? [failure] : []), ...cleanupErrors],
      'Canvas basics state restoration failed.',
      failed ? { cause: failure } : undefined,
    );
  if (failed) throw failure;
}
