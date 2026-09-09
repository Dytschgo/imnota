import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Modal } from './ui';

afterEach(cleanup);

describe('UI primitives', () => {
  it('places dialogs outside clipped glass panels and dismisses only the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <aside style={{ overflow: 'hidden', filter: 'blur(0)' }}>
        <Modal title="Rename collection" onClose={onClose}>
          <input data-autofocus aria-label="Collection name" />
          <button>Rename collection</button>
        </Modal>
      </aside>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Rename collection' });
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('traps modal focus, closes on Escape and restores the previous focus', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Feedback round" onClose={onClose}>
        <input aria-label="Name" />
        <button>Save round</button>
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save round' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('renders an accessible action and responds to click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Copy AI context</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy AI context' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
