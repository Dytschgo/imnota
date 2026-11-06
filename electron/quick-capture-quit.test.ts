// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { guardPendingCaptureQuit } from './quick-capture-quit.js';

function setup(count = 2) {
  let beforeQuit!: (event: { preventDefault(): void }) => void;
  const access = {
    store: {
      size: count,
      discardAll: vi.fn(() => {
        access.store.size = 0;
      }),
    },
    show: vi.fn(async () => undefined),
    allowQuit: vi.fn(),
  };
  const input = {
    onBeforeQuit: (handler: typeof beforeQuit) => {
      beforeQuit = handler;
    },
    access: () => access,
    ask: vi.fn(async () => false),
    report: vi.fn(),
    quit: vi.fn(),
  };
  guardPendingCaptureQuit(input);
  const attempt = () => {
    const event = { preventDefault: vi.fn() };
    beforeQuit(event);
    return event;
  };
  return { access, input, attempt };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

it('preserves pending captures and reopens them after Keep working', async () => {
  const { access, input, attempt } = setup();
  expect(attempt().preventDefault).toHaveBeenCalledOnce();
  await settle();
  expect(input.ask).toHaveBeenCalledWith(2);
  expect(access.show).toHaveBeenCalledWith(true);
  expect(access.store.size).toBe(2);
  expect(input.quit).not.toHaveBeenCalled();
});
it('discards only after explicit confirmation, then permits the ordinary quit path', async () => {
  const { access, input, attempt } = setup();
  input.ask.mockResolvedValue(true);
  attempt();
  await settle();
  expect(access.store.discardAll).toHaveBeenCalledOnce();
  expect(access.allowQuit).toHaveBeenCalledOnce();
  expect(input.quit).toHaveBeenCalledOnce();
  expect(access.store.size).toBe(0);
});
it('prevents a busy capture from being discarded or quit before its write result is known', async () => {
  const { access, input, attempt } = setup();
  input.ask.mockResolvedValue(true);
  access.store.discardAll.mockImplementation(() => {
    throw new Error('Capture action in progress');
  });
  attempt();
  await settle();
  expect(input.report).toHaveBeenCalledWith('Capture action in progress');
  expect(input.quit).not.toHaveBeenCalled();
  expect(access.store.size).toBe(2);
});
it('retains captures and reports a failed native confirmation instead of quitting', async () => {
  const { access, input, attempt } = setup();
  input.ask.mockRejectedValue(new Error('Dialog unavailable'));
  attempt();
  await settle();
  expect(input.report).toHaveBeenCalledWith('Dialog unavailable');
  expect(input.quit).not.toHaveBeenCalled();
  expect(access.store.size).toBe(2);
});
it('coalesces repeated quit requests while confirmation is pending and leaves empty quits alone', () => {
  const { input, attempt } = setup();
  input.ask.mockImplementation(() => new Promise(() => undefined));
  attempt();
  attempt();
  expect(input.ask).toHaveBeenCalledTimes(1);
  const empty = setup(0);
  expect(empty.attempt().preventDefault).not.toHaveBeenCalled();
  expect(empty.input.ask).not.toHaveBeenCalled();
  expect(empty.access.allowQuit).toHaveBeenCalledOnce();
});
