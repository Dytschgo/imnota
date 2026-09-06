import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';
import { OnboardingSettings } from './OnboardingSettings';
import { DEFAULT_APPEARANCE } from './preferences';
import { ShortcutSettings } from './ShortcutSettings';

afterEach(cleanup);

describe('preference controls', () => {
  it('emits independent theme, accent, and glass preference changes', async () => {
    const onChange = vi.fn(async () => {});
    const { rerender } = render(<AppearanceSettings value={DEFAULT_APPEARANCE} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, mode: 'dark' }));

    rerender(
      <AppearanceSettings
        value={{ ...DEFAULT_APPEARANCE, mode: 'dark' }}
        onChange={onChange}
        effectiveAppearance={{
          theme: 'dark',
          accent: 'indigo',
          requestedGlassLevel: 'balanced',
          glassLevel: 'off',
          glassFallbackReason: 'reduced-transparency',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Balanced/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        ...DEFAULT_APPEARANCE,
        mode: 'dark',
        glassLevel: 'balanced',
      }),
    );
  });

  it('records normalized shortcuts, explains reserved keys, and resets defaults', async () => {
    const onChange = vi.fn(async () => {});
    render(<ShortcutSettings value={{ bindings: {} }} onChange={onChange} platform="windows" />);
    const recorder = screen.getByRole('button', { name: 'Shortcut for Text' });

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: 'x', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ bindings: { 'tool.text': 'Ctrl+Shift+X' } }));

    fireEvent.click(screen.getByRole('button', { name: 'Shortcut for Arrow' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Shortcut for Arrow' }), {
      key: 'F4',
      altKey: true,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('reserved');

    fireEvent.click(screen.getByRole('button', { name: 'Reset defaults' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ bindings: {} }));
  });

  it('offers replay without mutating completion state itself', () => {
    const onReplay = vi.fn();
    render(<OnboardingSettings value={{ completed: true, completedVersion: 1 }} onReplay={onReplay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay guide' }));
    expect(onReplay).toHaveBeenCalledOnce();
    expect(screen.getByText('Completed with guide version 1')).toBeInTheDocument();
  });
});
