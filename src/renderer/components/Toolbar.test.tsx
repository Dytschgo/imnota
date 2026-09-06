import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
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

describe('annotation toolbar', () => {
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
