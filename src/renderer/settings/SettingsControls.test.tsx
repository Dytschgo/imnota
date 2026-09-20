import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';
import { OnboardingSettings } from './OnboardingSettings';
import { DEFAULT_APPEARANCE, DEFAULT_PREFERENCE_SETTINGS, type PreferenceSettings } from './preferences';
import { ShortcutSettings } from './ShortcutSettings';
import { SettingsView } from './SettingsView';
import { mergePreferenceSettings } from '../../shared/preference-settings';

vi.mock('../components/UpdateControl', () => ({ UpdateControl: () => null }));

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
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        bindings: expect.objectContaining({ 'capture.region': 'Ctrl+Shift+5', 'tool.text': 'T' }),
      }),
    );
  });

  it('shows recording state, confirms common OS combinations, and reports the saved keys', async () => {
    const onChange = vi.fn(async () => {});
    render(<ShortcutSettings value={{ bindings: {} }} onChange={onChange} platform="windows" />);
    const recorder = screen.getByRole('button', {
      name: 'Shortcut for Capture screen region (experimental)',
    });
    expect(recorder).toHaveTextContent('Ctrl + Shift + 5');

    fireEvent.click(recorder);
    expect(recorder).toHaveTextContent('Press keys…');
    expect(recorder).toHaveAttribute('aria-pressed', 'true');

    // Modifier-only presses never save a partial combination.
    fireEvent.keyDown(recorder, { key: 'Control', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(recorder, { key: 's', ctrlKey: true, shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Ctrl + Shift + S is also used by');

    fireEvent.keyDown(recorder, { key: 's', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ bindings: { 'capture.region': 'Ctrl+Shift+S' } }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved Ctrl + Shift + S.');
  });

  it('resets one shortcut to its default and clears one shortcut', async () => {
    let settings: PreferenceSettings = {
      ...DEFAULT_PREFERENCE_SETTINGS,
      shortcuts: {
        bindings: {
          'capture.region': 'Ctrl+Alt+Y',
          'tool.text': 'Ctrl+Shift+X',
        },
      },
    };
    const onChange = vi.fn(async (next) => {
      settings = mergePreferenceSettings(settings, { shortcuts: next });
      rerender(<ShortcutSettings value={settings.shortcuts} onChange={onChange} platform="windows" />);
    });
    const { rerender } = render(
      <ShortcutSettings value={settings.shortcuts} onChange={onChange} platform="windows" />,
    );
    expect(screen.getByRole('button', { name: 'Reset Arrow shortcut to default' })).toBeDisabled();
    const capture = screen.getByRole('button', { name: 'Shortcut for Capture screen region (experimental)' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear Capture screen region (experimental) shortcut' }),
    );
    await waitFor(() => expect(capture).toHaveTextContent('Not set'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Capture screen region (experimental) shortcut to default' }),
    );
    await waitFor(() => expect(capture).toHaveTextContent('Ctrl + Shift + 5'));
    expect(settings.shortcuts.bindings['capture.region']).toBe('Ctrl+Shift+5');

    fireEvent.click(screen.getByRole('button', { name: 'Reset defaults' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Shortcut for Text' })).toHaveTextContent('T'),
    );
    expect(settings.shortcuts.bindings).toMatchObject({ 'capture.region': 'Ctrl+Shift+5', 'tool.text': 'T' });
  });

  it('records shifted top-row digits from their Digit code', async () => {
    const onChange = vi.fn(async () => {});
    render(<ShortcutSettings value={{ bindings: {} }} onChange={onChange} platform="windows" />);
    const recorder = screen.getByRole('button', { name: 'Shortcut for Text' });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: '#', code: 'Digit3', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ bindings: { 'tool.text': 'Ctrl+Shift+3' } }));
  });

  it('offers replay without mutating completion state or workspace files', () => {
    const onReplay = vi.fn();
    render(<OnboardingSettings value={{ completed: true, completedVersion: 1 }} onReplay={onReplay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay guide' }));
    expect(onReplay).toHaveBeenCalledOnce();
    expect(screen.getByText('Completed with guide version 1')).toBeInTheDocument();
    expect(screen.getByText(/without changing a workspace/i)).toBeInTheDocument();
  });

  it('shows the Windows native copy default and emits a persisted-function change', async () => {
    const onNativeCopyChange = vi.fn(async () => {});
    render(
      <SettingsView
        activeCategory="Sharing"
        preferences={DEFAULT_PREFERENCE_SETTINGS}
        nativeCopyAvailable
        onNativeCopyChange={onNativeCopyChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Native copy functions' });
    expect(select).toHaveValue('files');
    fireEvent.change(select, { target: { value: 'files-rich' } });
    await waitFor(() => expect(onNativeCopyChange).toHaveBeenCalledWith({ defaultFunction: 'files-rich' }));
  });

  it('hides native copy functions when the host capability is unavailable', () => {
    render(<SettingsView activeCategory="Sharing" preferences={DEFAULT_PREFERENCE_SETTINGS} />);
    expect(screen.queryByRole('combobox', { name: 'Native copy functions' })).not.toBeInTheDocument();
  });

  it('keeps the saved native copy choice when a settings update is rejected', async () => {
    const onNativeCopyChange = vi.fn(async () => Promise.reject(new Error('disk full')));
    render(
      <SettingsView
        activeCategory="Sharing"
        preferences={DEFAULT_PREFERENCE_SETTINGS}
        nativeCopyAvailable
        onNativeCopyChange={onNativeCopyChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Native copy functions' });
    fireEvent.change(select, { target: { value: 'rich' } });
    await waitFor(() => expect(onNativeCopyChange).toHaveBeenCalledWith({ defaultFunction: 'rich' }));
    expect(select).toHaveValue('files');
  });

  it('explains when the background capture shortcut could not be registered', () => {
    render(
      <SettingsView
        activeCategory="Shortcuts"
        preferences={{
          ...DEFAULT_PREFERENCE_SETTINGS,
          capture: { experimentalRegionCapture: true },
        }}
      />,
    );
    expect(screen.getByTestId('capture-shortcut-summary')).toHaveTextContent(
      'The background shortcut is not active',
    );

    cleanup();
    render(
      <SettingsView
        activeCategory="Shortcuts"
        preferences={{
          ...DEFAULT_PREFERENCE_SETTINGS,
          capture: { experimentalRegionCapture: true },
        }}
        globalCaptureShortcutRegistered
      />,
    );
    expect(screen.getByTestId('capture-shortcut-summary')).toHaveTextContent(
      'even when Imnota is in the background',
    );
  });
});
