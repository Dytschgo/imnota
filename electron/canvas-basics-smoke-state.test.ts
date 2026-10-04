import { afterEach, expect, test, vi } from 'vitest';
import type { NativeUiDriver } from './smoke-native-driver.js';
import { withRestoredCanvasSmokeState } from './canvas-basics-smoke-state.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  document.body.innerHTML =
    '<button id="original">Original focus</button><div id="stage"><div class="konvajs-content"></div></div><button id="changed">Changed focus</button>';
  const original = document.querySelector<HTMLButtonElement>('#original')!;
  original.focus();
  const size = { width: window.innerWidth, height: window.innerHeight };
  let position = [20, 30];
  let scale = 0.5;
  document.querySelector('#stage')!.addEventListener('imnota:canvas-command', (event) => {
    if ((event as CustomEvent).detail === 'fit') scale = 0.5;
  });
  const driver = {
    browserWindow: {
      getPosition: () => [...position],
      setPosition: (x: number, y: number) => {
        position = [x, y];
      },
    },
    evaluate: vi.fn(async (source: string) => eval(source)),
    resize: vi.fn(async (viewport: typeof size) => {
      vi.stubGlobal('innerWidth', viewport.width);
      vi.stubGlobal('innerHeight', viewport.height);
    }),
  };
  const settle = vi.fn(async () => {
    expect({ width: window.innerWidth, height: window.innerHeight }).toEqual(size);
    expect(scale).toBe(0.5);
  });
  const changeState = async () => {
    await driver.resize({ width: 1440, height: 900 });
    driver.browserWindow.setPosition(50, 60);
    scale = 0.8;
    document.querySelector<HTMLButtonElement>('#changed')!.focus();
  };
  return {
    driver: driver as unknown as NativeUiDriver,
    size,
    original,
    settle,
    changeState,
    position: () => position,
  };
}

test.each([false, true])(
  'restores viewport, position, Fit and original focus after failure=%s',
  async (failed) => {
    const f = fixture();
    const failure = new Error('saved rectangle nudge failed');
    const result = withRestoredCanvasSmokeState(f.driver, f.settle, async () => {
      await f.changeState();
      if (failed) throw failure;
    });
    if (failed) await expect(result).rejects.toBe(failure);
    else await result;
    expect(f.driver.resize).toHaveBeenLastCalledWith(f.size);
    expect(f.position()).toEqual([20, 30]);
    expect(document.activeElement).toBe(f.original);
    expect(f.settle).toHaveBeenCalledOnce();
  },
);

test('retains the outcome failure and attempts Fit/focus cleanup even when restoring the viewport fails', async () => {
  const f = fixture();
  const failure = new Error('saved rectangle nudge failed');
  const cleanupFailure = new Error('OS clamped restored viewport');
  const result = withRestoredCanvasSmokeState(f.driver, f.settle, async () => {
    await f.changeState();
    vi.mocked(f.driver.resize).mockRejectedValueOnce(cleanupFailure);
    throw failure;
  });
  const error = await result.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError)) throw new Error('Expected aggregate restoration failure');
  expect(error.cause).toBe(failure);
  expect(error.errors).toContain(failure);
  expect(error.errors).toContain(cleanupFailure);
  expect(f.settle).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(f.original);
});
