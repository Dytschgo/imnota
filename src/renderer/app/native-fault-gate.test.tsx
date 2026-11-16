import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  delete (window as Window & { imnotaNativeFault?: unknown }).imnotaNativeFault;
  vi.resetModules();
});

it('keeps the probe unloaded and inert without the fault receiver', async () => {
  const gate = await import('./native-fault-gate');
  await gate.loadNativeFaultProbe();
  expect(gate.nativeFaultReceiverPresent).toBe(false);
  const save = vi.fn(async () => true);
  await expect(gate.observeNativeFaultSave(save)).resolves.toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(() => gate.reportNativeFaultTransition()).not.toThrow();
  const { container } = render(<gate.NativeFaultProbe scope="app" />);
  expect(container).toBeEmptyDOMElement();
});

it('delegates to the loaded probe when the fault receiver is present', async () => {
  let deliver: (command: unknown) => void = () => {};
  const receiver = {
    nonce: '11111111-1111-4111-8111-111111111111',
    report: vi.fn(),
    onCommand(callback: (command: unknown) => void) {
      deliver = callback;
      return () => {};
    },
  };
  Object.assign(window, { imnotaNativeFault: receiver });
  const gate = await import('./native-fault-gate');
  expect(gate.nativeFaultReceiverPresent).toBe(true);
  await gate.loadNativeFaultProbe();
  const projectId = 'project_22222222-2222-4222-8222-222222222222';
  gate.registerNativeFaultAdapter({
    read: () => ({
      projectId,
      projectPath: '/synthetic',
      acceptedRevision: null,
      snapshotRevision: null,
      pendingMetadata: false,
      pendingContent: false,
      pendingScreenshot: false,
      nativeMutations: 0,
      selectedItemId: null,
      externalChange: null,
      warning: '',
      error: '',
    }),
    queueMetadata: vi.fn(),
    stageDrafts: vi.fn(),
  });
  deliver({
    nonce: receiver.nonce,
    caseId: 'screenshot',
    requestId: '33333333-3333-4333-8333-333333333333',
    projectId,
    projectPath: '/synthetic',
    action: 'observe',
  });
  expect(receiver.report).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'observe' }));
  // The command schema still rejects malformed input before any handler runs.
  expect(() => deliver({ arbitrarySetter: true })).toThrow();
});
