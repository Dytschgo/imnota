import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';

const engine = vi.hoisted(() => ({ props: null as ExcalidrawProps | null, serialize: vi.fn() }));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: ExcalidrawProps) => {
    engine.props = props;
    return null;
  },
  getSceneVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((sum, item) => sum + item.version, 0),
  serializeAsJSON: engine.serialize,
}));
import { DrawingEditor } from './DrawingEditor';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('theme changes stay display-only and edits retain source background and shape colors', () => {
  const onChange = vi.fn();
  const elements = [{ type: 'ellipse', version: 1, strokeColor: '#123456', backgroundColor: '#fedcba' }];
  const source = JSON.stringify({ elements, appState: { viewBackgroundColor: '#f0e0d0' } });
  const { rerender } = render(<DrawingEditor source={source} theme="dark" onChange={onChange} />);
  expect(engine.props?.initialData).toMatchObject({
    elements,
    appState: { viewBackgroundColor: 'transparent' },
  });
  const appState = {
    activeTool: { type: 'selection' },
    currentItemRoundness: 'sharp',
    viewBackgroundColor: 'transparent',
  };
  const emit = (scene: typeof elements) =>
    act(() =>
      engine.props?.onChange?.(
        scene as unknown as Parameters<NonNullable<ExcalidrawProps['onChange']>>[0],
        appState as Parameters<NonNullable<ExcalidrawProps['onChange']>>[1],
        {},
      ),
    );
  emit(elements);
  rerender(<DrawingEditor source={source} theme="light" onChange={onChange} />);
  emit(elements);
  expect(onChange).not.toHaveBeenCalled();
  expect(engine.serialize).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByTestId('drawing-editor-canvas'), { key: 'ArrowRight' });
  const edited = [{ ...elements[0], version: 2 }];
  engine.serialize.mockReturnValue('saved edit');
  emit(edited);
  expect(engine.serialize).toHaveBeenCalledWith(
    edited,
    expect.objectContaining({ viewBackgroundColor: '#f0e0d0' }),
    {},
    'local',
  );
  expect(onChange).toHaveBeenCalledWith('saved edit');
  rerender(<DrawingEditor source="saved edit" theme="dark" onChange={onChange} />);
  emit(edited);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('drawing tools wait for the engine and the first enabled click reaches it', () => {
  render(
    <DrawingEditor source={JSON.stringify({ elements: [], appState: {} })} theme="dark" onChange={vi.fn()} />,
  );
  const rectangle = screen.getByRole('button', { name: 'Rectangle' });
  expect(rectangle).toBeDisabled();
  const api = { updateScene: vi.fn(), setActiveTool: vi.fn() };
  fireEvent.click(rectangle);
  expect(api.setActiveTool).not.toHaveBeenCalled();
  act(() => {
    const receiveApi = engine.props?.excalidrawAPI;
    if (typeof receiveApi !== 'function') throw new Error('Missing drawing engine callback');
    receiveApi(api as unknown as Parameters<typeof receiveApi>[0]);
  });
  expect(rectangle).toBeEnabled();
  fireEvent.click(rectangle);
  expect(api.setActiveTool).toHaveBeenCalledExactlyOnceWith({ type: 'rectangle' });
});
