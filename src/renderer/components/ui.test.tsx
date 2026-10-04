import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Modal } from './ui';

afterEach(cleanup);

describe('UI primitives', () => {
  it.each(['hidden', 'inert', 'display:none', 'visibility:hidden', 'disabled', 'tabindex=-1'])(
    'excludes %s controls when wrapping in either direction',
    (kind) => {
      render(
        <Modal title="Tab boundaries" onClose={vi.fn()}>
          <button>Last visible action</button>
          <div data-testid="unavailable-parent">
            <button data-testid="unavailable-action">Unavailable action</button>
          </div>
        </Modal>,
      );
      const parent = screen.getByTestId('unavailable-parent');
      const unavailable = screen.getByTestId('unavailable-action');
      if (kind === 'hidden' || kind === 'inert') parent.setAttribute(kind, '');
      if (kind === 'display:none') parent.style.display = 'none';
      if (kind === 'visibility:hidden') parent.style.visibility = 'hidden';
      if (kind === 'disabled') unavailable.setAttribute('disabled', '');
      if (kind === 'tabindex=-1') unavailable.tabIndex = -1;
      const close = screen.getByRole('button', { name: 'Close' });
      const last = screen.getByRole('button', { name: 'Last visible action' });
      last.focus();
      expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
      expect(close).toHaveFocus();
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(last).toHaveFocus();
    },
  );

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

  it('contains background autofocus in the top dialog and returns to the underlying dialog', () => {
    const view = (confirm: boolean, hidden = false) => (
      <>
        <button>Background editor</button>
        <Modal title="Restore" onClose={vi.fn()} hidden={hidden}>
          <button>Restore drawing</button>
        </Modal>
        {confirm && (
          <Modal title="Confirm" onClose={vi.fn()}>
            <input aria-label="Confirmation" data-autofocus />
          </Modal>
        )}
      </>
    );
    const { rerender, unmount } = render(view(false));
    const restore = screen.getByRole('button', { name: 'Restore drawing' });
    restore.focus();
    rerender(view(true));
    const confirmation = screen.getByRole('textbox', { name: 'Confirmation' });
    expect(confirmation).toHaveFocus();
    const background = screen.getByRole('button', { name: 'Background editor' });
    background.focus();
    expect(confirmation).toHaveFocus();
    restore.focus();
    expect(confirmation).toHaveFocus();
    rerender(view(false));
    expect(restore).toHaveFocus();
    background.focus();
    expect(restore).toHaveFocus();
    rerender(view(false, true));
    background.focus();
    expect(background).toHaveFocus();
    rerender(view(false));
    // Revealing a hidden parent preserves its previous inner focus target.
    screen.getByRole('button', { name: 'Close' }).focus();
    restore.focus();
    background.focus();
    expect(restore).toHaveFocus();
    unmount();
    expect(document.activeElement).toBe(document.body);
  });

  it('falls back inside the dialog after its focused action is removed and tabs from a status', () => {
    const view = (action: boolean) => (
      <>
        <button>Background editor</button>
        <Modal title="Restore" onClose={vi.fn()}>
          <a href="https://example.com">Help</a>
          <a href="https://example.com/source">Source</a>
          <p role="status" tabIndex={-1}>
            Restored drawing.
          </p>
          {action && <button>Restore drawing</button>}
        </Modal>
      </>
    );
    const { rerender } = render(view(true));
    screen.getByRole('button', { name: 'Restore drawing' }).focus();
    rerender(view(false));
    screen.getByRole('button', { name: 'Background editor' }).focus();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    const link = screen.getByRole('link', { name: 'Help' });
    link.focus();
    // Let the browser advance between ordinary links in its native tab order.
    expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(true);
    const status = screen.getByRole('status');
    status.focus();
    fireEvent.keyDown(status, { key: 'Tab' });
    expect(close).toHaveFocus();
    status.focus();
    fireEvent.keyDown(status, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('link', { name: 'Source' })).toHaveFocus();
  });

  it('allows a dynamically inserted paste receiver only inside the open modal', () => {
    render(
      <Modal title="Share bundles" onClose={vi.fn()}>
        <button>Rich copy</button>
      </Modal>,
    );
    const copy = screen.getByRole('button', { name: 'Rich copy' });
    copy.focus();
    const receiver = document.createElement('div');
    receiver.contentEditable = 'true';
    receiver.tabIndex = 0;
    document.body.append(receiver);
    receiver.focus();
    expect(copy).toHaveFocus();
    screen.getByRole('dialog').append(receiver);
    receiver.focus();
    expect(receiver).toHaveFocus();
    receiver.remove();
    copy.focus();
    expect(copy).toHaveFocus();
  });

  it.each([undefined, -1])(
    'honors an editable receiver with tabindex %s in both tab boundaries',
    (tabIndex) => {
      render(
        <Modal title="Share bundles" onClose={vi.fn()}>
          <button>Rich copy</button>
          <div contentEditable tabIndex={tabIndex} role="textbox" aria-label="Paste receiver" />
        </Modal>,
      );
      const close = screen.getByRole('button', { name: 'Close' });
      const copy = screen.getByRole('button', { name: 'Rich copy' });
      const receiver = screen.getByRole('textbox', { name: 'Paste receiver' });
      // jsdom supports focusing contenteditable but does not implement this getter.
      Object.defineProperty(receiver, 'isContentEditable', { value: true });
      expect(receiver.tabIndex).toBe(-1);
      if (tabIndex === undefined) expect(receiver).not.toHaveAttribute('tabindex');
      else expect(receiver).toHaveAttribute('tabindex', '-1');

      copy.focus();
      if (tabIndex === undefined) {
        // fireEvent does not perform native Tab navigation. The handler must leave
        // this move uncancelled so the browser can advance to the editing host.
        expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
        receiver.focus();
        expect(receiver).toHaveFocus();
        expect(fireEvent.keyDown(receiver, { key: 'Tab', shiftKey: true })).toBe(true);
        expect(fireEvent.keyDown(receiver, { key: 'Tab' })).toBe(false);
      } else {
        expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(false);
      }
      expect(close).toHaveFocus();
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(tabIndex === undefined ? receiver : copy).toHaveFocus();
    },
  );
});
