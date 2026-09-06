import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShortcutBindings } from '../../shared/shortcuts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function Harness({ bindings, onText }: { bindings: ShortcutBindings; onText: () => void }) {
  useKeyboardShortcuts({
    bindings,
    platform: 'windows',
    handlers: { 'tool.text': onText },
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
});
