import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FaultCommand, FaultObservation } from '../../shared/native-faults';
import { ErrorBoundary } from '../components/ErrorBoundary';

const receiver = vi.hoisted(() => {
  const value = {
    nonce: '11111111-1111-4111-8111-111111111111',
    callback: (value: unknown) => {
      void value;
    },
    report: vi.fn(),
    onCommand(callback: (value: unknown) => void) {
      value.callback = callback;
      return () => {};
    },
  };
  Object.assign(window, { imnotaNativeFault: value });
  return value;
});
import { NativeFaultProbe, registerNativeFaultAdapter } from './native-fault-probe';

const projectId = 'project_22222222-2222-4222-8222-222222222222';
function command(action: FaultCommand['action'], extra: Partial<FaultCommand> = {}) {
  receiver.callback({
    nonce: receiver.nonce,
    caseId: 'screenshot',
    requestId: '33333333-3333-4333-8333-333333333333',
    projectId,
    projectPath: '/synthetic',
    action,
    ...extra,
  });
}
function adapter() {
  const state: Omit<FaultObservation, 'nonce' | 'caseId' | 'requestId' | 'event'> = {
    projectId,
    projectPath: '/synthetic',
    acceptedRevision: 'a'.repeat(64),
    snapshotRevision: 'a'.repeat(64),
    pendingMetadata: false,
    pendingContent: false,
    pendingScreenshot: false,
    nativeMutations: 1,
    selectedItemId: 'fixture',
    externalChange: null,
    warning: '',
    error: '',
  };
  const queueMetadata = vi.fn(() => {
    state.pendingMetadata = true;
  });
  registerNativeFaultAdapter({
    read: () => state,
    queueMetadata,
    stageDrafts: () => {
      state.pendingContent = true;
      state.pendingScreenshot = true;
    },
  });
  return { state, queueMetadata };
}
afterEach(() => {
  cleanup();
  adapter();
  command('disarm');
  receiver.report.mockClear();
  vi.restoreAllMocks();
});
it('rejects wrong nonce, project and unknown commands before calling the actual input handler', () => {
  const value = adapter();
  expect(() =>
    command('queue-fixture-metadata', { nonce: '44444444-4444-4444-8444-444444444444' }),
  ).toThrow();
  expect(() => command('queue-fixture-metadata', { projectPath: '/foreign' })).toThrow();
  expect(() => receiver.callback({ arbitrarySetter: true })).toThrow();
  expect(value.queueMetadata).not.toHaveBeenCalled();
  command('queue-fixture-metadata');
  expect(value.queueMetadata).toHaveBeenCalledWith('Fixture queued metadata');
  expect(receiver.report).toHaveBeenLastCalledWith(expect.objectContaining({ pendingMetadata: true }));
});
it('throws inside React under StrictMode and uses actual panel Retry and resetKey recovery', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  adapter();
  const tree = (key: string) => (
    <StrictMode>
      <ErrorBoundary variant="panel" resetKey={key}>
        <NativeFaultProbe scope="panel" />
        <p>Drawing ready</p>
      </ErrorBoundary>
    </StrictMode>
  );
  const mounted = render(tree('first'));
  act(() => command('render-panel-failure'));
  expect(screen.getByTestId('error-fallback-panel')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  act(() => command('clear-render-failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Drawing ready')).toBeInTheDocument();
  act(() => command('render-panel-failure'));
  act(() => command('clear-render-failure'));
  mounted.rerender(tree('second'));
  expect(screen.getByText('Drawing ready')).toBeInTheDocument();
});
it('retains authentic read closures after the root unmount, then releases on disarm', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const value = adapter();
  render(
    <StrictMode>
      <ErrorBoundary variant="app">
        <NativeFaultProbe scope="app" />
        <p>App ready</p>
      </ErrorBoundary>
    </StrictMode>,
  );
  act(() => command('stage-recovery-drafts'));
  expect(screen.getByTestId('error-fallback-app')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus();
  value.state.acceptedRevision = null;
  act(() => command('observe'));
  expect(receiver.report).toHaveBeenLastCalledWith(
    expect.objectContaining({
      acceptedRevision: null,
      pendingContent: true,
      pendingScreenshot: true,
      pendingMetadata: true,
    }),
  );
  act(() => command('disarm'));
  expect(() => command('observe')).toThrow('Unowned');
});
