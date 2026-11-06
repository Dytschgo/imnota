import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { QuickCaptureState } from '../shared/quick-capture';
import { QuickCaptures } from './QuickCaptures';

vi.mock('../renderer/components/AnnotationCanvas', () => ({
  AnnotationCanvas: () => <div data-testid="compact-canvas" />,
}));
vi.mock('../renderer/export-image', () => ({
  renderAnnotatedImage: vi.fn(async () => 'data:image/png;base64,edited'),
}));
let changed: () => void;
let state: QuickCaptureState;
beforeEach(() => {
  state = {
    cards: ['first', 'second'].map((id, index) => ({
      id,
      revision: 1,
      width: 480 + index * 120,
      height: 300,
      previewDataUrl: `data:image/png;base64,${id}`,
      busy: false,
      dragAvailable: false,
    })),
    destinations: [
      { projectPath: '/a', collectionId: 'one', label: 'A / One' },
      { projectPath: '/b', collectionId: 'two', label: 'B / Two' },
    ],
  };
  window.imnotaQuickCapture = {
    state: vi.fn(async () => ({ ok: true as const, value: structuredClone(state) })),
    onChange: vi.fn((handler) => {
      changed = handler;
      return () => undefined;
    }),
    onDragError: vi.fn(() => () => undefined),
    copy: vi.fn(async () => ({ ok: true as const, value: undefined })),
    discard: vi.fn(async (input) => {
      state.cards = state.cards.filter((card) => card.id !== input.id);
      changed();
      return { ok: true as const, value: undefined };
    }),
    add: vi.fn(async () => ({ ok: true as const, value: undefined })),
    edit: vi.fn(async (input) => ({
      ok: true as const,
      value: {
        image: { filename: input.id, dataUrl: 'data:image/png;base64,original', width: 600, height: 300 },
        annotations: [],
      },
    })),
    apply: vi.fn(async (input) => {
      state.cards.find((card) => card.id === input.id)!.revision++;
      changed();
      return { ok: true as const, value: undefined };
    }),
    resize: vi.fn(async () => ({ ok: true as const, value: undefined })),
    hide: vi.fn(async () => ({ ok: true as const, value: undefined })),
    prepareDrag: vi.fn(async () => ({ ok: true as const, value: undefined })),
    startDrag: vi.fn(),
  };
});
afterEach(cleanup);

it('honors an overlay Annotate request without adding or discarding any pending capture', async () => {
  state.editorCaptureId = 'second';
  render(<QuickCaptures />);
  await screen.findByTestId('compact-canvas');
  expect(window.imnotaQuickCapture.edit).toHaveBeenCalledExactlyOnceWith({ id: 'second', revision: 1 });
  expect(window.imnotaQuickCapture.add).not.toHaveBeenCalled();
  expect(window.imnotaQuickCapture.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }));
  await screen.findByTestId('quick-capture-first');
  expect(screen.getByTestId('quick-capture-second')).toBeVisible();
});
async function show() {
  render(<QuickCaptures />);
  await screen.findByTestId('quick-capture-first');
}

it('copies only the chosen capture, keeps both after failure and exposes an explicit retry', async () => {
  vi.mocked(window.imnotaQuickCapture.copy).mockResolvedValueOnce({
    ok: false,
    error: { code: 'capture-failed', message: 'Clipboard unavailable', retryable: true },
  });
  await show();
  const second = within(screen.getByTestId('quick-capture-second'));
  fireEvent.click(second.getByRole('button', { name: 'Copy image' }));
  expect(await second.findByRole('alert')).toHaveTextContent('Clipboard unavailable');
  expect(screen.getByTestId('quick-capture-first')).toBeVisible();
  fireEvent.click(second.getByRole('button', { name: 'Copy image' }));
  expect(await second.findByRole('status')).toHaveTextContent('Image copied.');
  expect(window.imnotaQuickCapture.copy).toHaveBeenNthCalledWith(1, { id: 'second', revision: 1 });
  expect(window.imnotaQuickCapture.copy).toHaveBeenNthCalledWith(2, { id: 'second', revision: 1 });
});

it('requires a chosen destination and retains its identity when collection options reorder', async () => {
  await show();
  const first = within(screen.getByTestId('quick-capture-first'));
  expect(first.getByRole('button', { name: 'Add' })).toBeDisabled();
  fireEvent.change(first.getByRole('combobox'), { target: { value: JSON.stringify(['/b', 'two']) } });
  state.destinations.reverse();
  act(() => changed());
  await waitFor(() => expect(first.getByRole('combobox')).toHaveValue(JSON.stringify(['/b', 'two'])));
  fireEvent.click(first.getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(window.imnotaQuickCapture.add).toHaveBeenCalledWith({
      id: 'first',
      revision: 1,
      destination: { projectPath: '/b', collectionId: 'two' },
    }),
  );
});

it('opens and applies annotation to the intended capture without consuming the other card', async () => {
  await show();
  fireEvent.click(
    within(screen.getByTestId('quick-capture-second')).getByRole('button', { name: 'Annotate' }),
  );
  await screen.findByTestId('compact-canvas');
  expect(window.imnotaQuickCapture.edit).toHaveBeenCalledWith({ id: 'second', revision: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Apply edits' }));
  await screen.findByTestId('quick-capture-first');
  expect(window.imnotaQuickCapture.apply).toHaveBeenCalledWith({
    id: 'second',
    revision: 1,
    annotations: [],
    pngDataUrl: 'data:image/png;base64,edited',
  });
  fireEvent.click(
    within(screen.getByTestId('quick-capture-second')).getByRole('button', { name: 'Copy image' }),
  );
  await waitFor(() =>
    expect(window.imnotaQuickCapture.copy).toHaveBeenCalledWith({ id: 'second', revision: 2 }),
  );
  expect(screen.getByTestId('quick-capture-first')).toBeVisible();
});

it('supports card keyboard copy/hide and discards only the explicitly selected card', async () => {
  await show();
  const second = screen.getByTestId('quick-capture-second');
  fireEvent.keyDown(second, { key: 'Enter' });
  await waitFor(() =>
    expect(window.imnotaQuickCapture.copy).toHaveBeenCalledWith({ id: 'second', revision: 1 }),
  );
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(window.imnotaQuickCapture.hide).toHaveBeenCalledTimes(1);
  expect(window.imnotaQuickCapture.discard).not.toHaveBeenCalled();
  fireEvent.click(within(second).getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(screen.queryByTestId('quick-capture-second')).not.toBeInTheDocument());
  expect(screen.getByTestId('quick-capture-first')).toBeVisible();
  expect(window.imnotaQuickCapture.discard).toHaveBeenCalledExactlyOnceWith({ id: 'second', revision: 1 });
});
