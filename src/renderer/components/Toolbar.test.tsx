import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Toolbar, type ToolbarProps } from './Toolbar';

function props(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    tool: 'select',
    setTool: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: true,
    canRedo: true,
    onZoom: vi.fn(),
    onFit: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('annotation toolbar', () => {
  test('dismisses tooltips after activation and departure, and reopens only on a new hover', () => {
    vi.useFakeTimers();
    const setTool = vi.fn();
    render(<Toolbar {...props({ setTool })} />);
    const tool = screen.getByRole('button', { name: 'Text' });
    const hover = () => {
      fireEvent.pointerEnter(tool);
      act(() => vi.advanceTimersByTime(320));
    };
    hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('add editable text');
    fireEvent.pointerDown(tool);
    fireEvent.focus(tool);
    fireEvent.pointerUp(tool);
    fireEvent.click(tool);
    expect(setTool).toHaveBeenCalledWith('text');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerLeave(tool);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).toBeNull();
    hover();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerLeave(tool);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(tool);
    fireEvent.pointerLeave(tool);
    act(() => vi.advanceTimersByTime(320));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test.each(['outside release', 'pointer cancellation'])('restores keyboard tooltips after %s', (ending) => {
    vi.useFakeTimers();
    render(<Toolbar {...props()} />);
    const tool = screen.getByRole('button', { name: 'Arrow' });
    fireEvent.pointerDown(tool);
    if (ending === 'outside release') {
      fireEvent.pointerLeave(tool);
      fireEvent.pointerUp(document.body);
    } else {
      fireEvent.pointerCancel(tool);
    }
    act(() => tool.focus());
    act(() => vi.advanceTimersByTime(320));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Point to a specific interface detail.');
    expect(tool).toHaveFocus();
  });

  test('supports keyboard discovery and Escape without losing focus or changing tools', () => {
    vi.useFakeTimers();
    const setTool = vi.fn();
    render(<Toolbar {...props({ setTool })} />);
    const tool = screen.getByRole('button', { name: 'Arrow' });
    act(() => tool.focus());
    act(() => vi.advanceTimersByTime(320));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Point to a specific interface detail.');
    fireEvent.keyDown(tool, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(tool).toHaveFocus();
    expect(setTool).not.toHaveBeenCalled();
  });

  test('keeps the six primary tools directly available and advanced tools in More', () => {
    const setTool = vi.fn();
    const { container } = render(<Toolbar {...props({ setTool })} />);
    const primary = container.querySelector('.annotation-primary-tools');
    expect(primary).not.toBeNull();
    expect(
      within(primary as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Select / Move',
      'Text',
      'Arrow',
      'Rectangle',
      'Highlight',
      'Note / Step',
      'More annotation tools',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'More annotation tools' }));
    const menu = screen.getByRole('menu', { name: 'More annotation tools' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Pixelation/ }));
    expect(setTool).toHaveBeenCalledWith('pixelate');
  });

  test('keeps More keyboard navigable and restores focus after dismissal or selection', async () => {
    const setTool = vi.fn();
    const { container } = render(<Toolbar {...props({ setTool })} />);
    const toolbar = within(container);

    const trigger = toolbar.getByRole('button', { name: 'More annotation tools' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const redaction = await toolbar.findByRole('menuitemradio', { name: /^Redaction mask/ });
    await waitFor(() => expect(redaction).toHaveFocus());

    fireEvent.keyDown(redaction, { key: 'End' });
    const deleteAnnotation = toolbar.getByRole('menuitemradio', { name: /Delete annotation/ });
    await waitFor(() => expect(deleteAnnotation).toHaveFocus());
    fireEvent.keyDown(deleteAnnotation, { key: 'Home' });
    await waitFor(() => expect(redaction).toHaveFocus());
    fireEvent.keyDown(redaction, { key: 'ArrowUp' });
    await waitFor(() => expect(deleteAnnotation).toHaveFocus());
    fireEvent.keyDown(deleteAnnotation, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(toolbar.getByRole('menuitemradio', { name: /Delete annotation/ })).toHaveFocus(),
    );
    fireEvent.click(toolbar.getByRole('menuitemradio', { name: /Delete annotation/ }));
    expect(setTool).toHaveBeenCalledWith('eraser');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('closes More when Tab or Shift+Tab moves focus outside the popup', async () => {
    const { container } = render(<Toolbar {...props()} />);
    const toolbar = within(container);
    const trigger = toolbar.getByRole('button', { name: 'More annotation tools' });
    const undo = toolbar.getByRole('button', { name: 'Undo' });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const redaction = await toolbar.findByRole('menuitemradio', { name: /^Redaction mask/ });
    await waitFor(() => expect(redaction).toHaveFocus());
    fireEvent.keyDown(redaction, { key: 'Tab' });
    fireEvent.blur(redaction, { relatedTarget: undo });
    await waitFor(() => expect(toolbar.queryByRole('menu', { name: 'More annotation tools' })).toBeNull());

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const firstItem = await toolbar.findByRole('menuitemradio', { name: /^Redaction mask/ });
    await waitFor(() => expect(firstItem).toHaveFocus());
    fireEvent.keyDown(firstItem, { key: 'Tab', shiftKey: true });
    trigger.focus();
    await waitFor(() => expect(toolbar.queryByRole('menu', { name: 'More annotation tools' })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  test('fills available container space and keeps overflow navigation and focus correct on resize', async () => {
    let width = 600;
    let resize = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const size = this.classList.contains('annotation-toolbar')
        ? width
        : this.classList.contains('annotation-view-tools')
          ? 260
          : this.classList.contains('annotation-palette')
            ? 82
            : this.getAttribute('aria-label') === 'More annotation tools'
              ? 58
              : this.tagName === 'BUTTON'
                ? 29
                : 0;
      return { width: size, height: 29, top: 0, left: 0, right: size, bottom: 29, x: 0, y: 0, toJSON() {} };
    });
    const setTool = vi.fn();
    const initialProps = props({ setTool, tool: 'crop' });
    const { rerender } = render(<Toolbar {...initialProps} />);
    expect(screen.getByRole('button', { name: 'Crop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Freehand' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'More annotation tools' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const freehand = screen.getByRole('menuitemradio', { name: /^Freehand/ });
    await waitFor(() => expect(freehand).toHaveFocus());
    expect(screen.queryByRole('menuitemradio', { name: /^Crop/ })).toBeNull();
    fireEvent.keyDown(freehand, { key: 'End' });
    const remove = screen.getByRole('menuitemradio', { name: /Delete annotation/ });
    await waitFor(() => expect(remove).toHaveFocus());
    fireEvent.keyDown(remove, { key: 'ArrowDown' });
    await waitFor(() => expect(freehand).toHaveFocus());
    act(() => {
      width = 1000;
      resize();
    });
    expect(screen.queryByRole('button', { name: 'More annotation tools' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Freehand' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete annotation' })).toBeInTheDocument();
    act(() => {
      width = 400;
      resize();
    });
    expect(screen.getByRole('button', { name: 'More annotation tools' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'More annotation tools' })).toHaveClass('is-active');
    fireEvent.keyDown(screen.getByRole('button', { name: 'More annotation tools' }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /^Arrow/ })).toHaveFocus());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Crop/ }));
    expect(setTool).toHaveBeenCalledWith('crop');
    act(() => {
      width = 600;
      resize();
    });
    expect(screen.getByRole('button', { name: 'Crop' })).toBeInTheDocument();
    rerender(<Toolbar {...initialProps} onColorSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Crop' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Quick annotation colors' })).toBeInTheDocument();
  });

  test('renders the optional ten-color quick palette and reports selection', () => {
    const onColorSelect = vi.fn();
    render(<Toolbar {...props({ selectedColor: '#22c55e', onColorSelect })} />);
    const palette = screen.getByRole('group', { name: 'Quick annotation colors' });
    expect(within(palette).getAllByRole('button')).toHaveLength(10);
    expect(within(palette).getByRole('button', { name: 'Use color #22c55e' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(palette).getByRole('button', { name: 'Use color #3b82f6' }));
    expect(onColorSelect).toHaveBeenCalledWith('#3b82f6');
  });
});
