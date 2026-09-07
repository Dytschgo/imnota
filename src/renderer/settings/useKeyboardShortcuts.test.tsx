import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutBindings } from '../../shared/shortcuts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

afterEach(cleanup);

function Harness({
  bindings,
  onText,
  onCollections = () => {},
  onDelete = () => {},
  platform = 'windows',
}: {
  bindings: ShortcutBindings;
  onText: () => void;
  onCollections?: () => void;
  onDelete?: () => void;
  platform?: 'windows' | 'mac';
}) {
  useKeyboardShortcuts({
    bindings,
    platform,
    handlers: {
      'tool.text': onText,
      'panel.toggleCollections': onCollections,
      'edit.deleteAnnotation': onDelete,
    },
  });
  return (
    <div>
      <input aria-label="Description" />
      <div role="dialog">
        <button type="button">Dialog action</button>
      </div>
    </div>
  );
}

describe('useKeyboardShortcuts', () => {
  it('deletes with Mac Backspace but never while typing or inside a dialog', () => {
    const onDelete = vi.fn();
    const { getByLabelText, getByRole } = render(
      <Harness bindings={{}} platform="mac" onText={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledOnce();
    fireEvent.keyDown(getByLabelText('Description'), { key: 'Backspace' });
    fireEvent.keyDown(getByRole('button', { name: 'Dialog action' }), { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledOnce();
  });
  it('runs a configured action outside typing and dialog contexts', () => {
    const onText = vi.fn();
    const { getByRole, getByLabelText } = render(<Harness bindings={{}} onText={onText} />);

    fireEvent.keyDown(window, { key: 't' });
    expect(onText).toHaveBeenCalledOnce();

    fireEvent.keyDown(getByLabelText('Description'), { key: 't' });
    fireEvent.keyDown(getByRole('button', { name: 'Dialog action' }), { key: 't' });
    expect(onText).toHaveBeenCalledOnce();
  });

  it('does not run either side of a shortcut conflict', () => {
    const onText = vi.fn();
    render(<Harness bindings={{ 'tool.text': 'A' }} onText={onText} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onText).not.toHaveBeenCalled();
  });

  it('matches a shifted top-row digit through the runtime hook', () => {
    const onCollections = vi.fn();
    render(<Harness bindings={{}} onText={vi.fn()} onCollections={onCollections} />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '!',
          code: 'Digit1',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCollections).toHaveBeenCalledOnce();
  });
});
