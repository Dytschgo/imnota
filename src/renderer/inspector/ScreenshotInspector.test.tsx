import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Annotation, ScreenshotRecord } from '../../shared/types';
import { ScreenshotInspector } from './ScreenshotInspector';

afterEach(cleanup);

const shot: ScreenshotRecord = {
  collectionId: '001-collection',
  id: 'shot',
  originalFilename: 'shot.png',
  storedFilename: 'shot.png',
  title: 'Shot',
  description: '',
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  priority: 'medium',
  annotationFile: 'shot.annotations.json',
  descriptionFile: 'shot.md',
  originalWidth: 100,
  originalHeight: 100,
  includeInExport: true,
};

function renderInspector(selectedAnnotation: Annotation | null, onDeleteAnnotation = vi.fn()) {
  render(
    <ScreenshotInspector
      shot={shot}
      selectedAnnotation={selectedAnnotation}
      onUpdateShot={vi.fn()}
      onDescriptionChange={vi.fn()}
      onUndoDescription={vi.fn()}
      canUndoDescription={false}
      onChangeAnnotation={vi.fn()}
      onDeleteAnnotation={onDeleteAnnotation}
      onDuplicate={vi.fn()}
    />,
  );
  return onDeleteAnnotation;
}

it('deletes the selected annotation with the mouse, including retired kinds', () => {
  // Callouts can no longer be created but older projects still contain them.
  const onDelete = renderInspector({
    id: 'a',
    kind: 'callout',
    x: 1,
    y: 2,
    width: 30,
    height: 20,
    zIndex: 0,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete annotation' }));
  expect(onDelete).toHaveBeenCalledOnce();
});

it('offers deletion only while an annotation is selected', () => {
  renderInspector(null);
  expect(screen.queryByRole('button', { name: 'Delete annotation' })).not.toBeInTheDocument();
});

it('edits and removes recorded source info, and explains when it is off', () => {
  const onUpdateShot = vi.fn();
  const source = {
    via: 'capture' as const,
    capturedAt: '2026-10-10T10:15:00.000Z',
    app: 'Visual Studio Code',
    windowTitle: 'C:\\Users\\Dylan\\App.tsx - Visual Studio Code',
  };
  const props = {
    selectedAnnotation: null,
    onUpdateShot,
    onDescriptionChange: vi.fn(),
    onUndoDescription: vi.fn(),
    canUndoDescription: false,
    onChangeAnnotation: vi.fn(),
    onDeleteAnnotation: vi.fn(),
    onDuplicate: vi.fn(),
  };
  const { rerender } = render(<ScreenshotInspector {...props} shot={{ ...shot, source }} />);
  expect(screen.getByLabelText('Window title')).toHaveValue('C:\\Users\\Dylan\\App.tsx - Visual Studio Code');
  expect(screen.getByText(/Written into exported Markdown/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://shop.example' } });
  expect(onUpdateShot).toHaveBeenLastCalledWith({ source: { ...source, url: 'https://shop.example' } });
  fireEvent.change(screen.getByLabelText('App'), { target: { value: '' } });
  expect(onUpdateShot).toHaveBeenLastCalledWith({
    source: { via: 'capture', capturedAt: source.capturedAt, windowTitle: source.windowTitle },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove source info' }));
  expect(onUpdateShot).toHaveBeenLastCalledWith({ source: undefined });

  rerender(<ScreenshotInspector {...props} shot={{ ...shot, source }} sourceContextEnabled={false} />);
  expect(screen.getByText(/Not exported while source info is off/)).toBeInTheDocument();
  rerender(<ScreenshotInspector {...props} shot={shot} sourceContextEnabled={false} />);
  expect(screen.getByText(/Source info is off/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Window title')).not.toBeInTheDocument();
});
