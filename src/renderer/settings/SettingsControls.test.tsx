import { usePreferences } from '../app/usePreferences';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';
import { OnboardingSettings } from './OnboardingSettings';
import { DEFAULT_APPEARANCE, DEFAULT_PREFERENCE_SETTINGS, type PreferenceSettings } from './preferences';
import { ShortcutSettings } from './ShortcutSettings';
import { SettingsView } from './SettingsView';
import { mergePreferenceSettings } from '../../shared/preference-settings';

vi.mock('../components/UpdateControl', () => ({ UpdateControl: () => null }));
vi.mock('./background-library', () => ({
  savedBackgrounds: vi.fn(async () => []),
  saveBackground: vi.fn(async () => {}),
  removeBackground: vi.fn(async () => {}),
}));

afterEach(cleanup);

describe('preference controls', () => {
  it('opens local diagnostics and reports access failure without changing preferences', async () => {
    const openDiagnosticsFolder = vi.fn().mockRejectedValue(new Error('access denied'));
    vi.stubGlobal('imnota', { openDiagnosticsFolder });
    try {
      render(<SettingsView activeCategory="Workspace" />);
      fireEvent.click(screen.getByRole('button', { name: 'Open diagnostics folder' }));
      await waitFor(() => expect(openDiagnosticsFolder).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/Local diagnostics are unavailable/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
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
    fireEvent.click(screen.getByRole('checkbox', { name: /Glass surfaces/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        ...DEFAULT_APPEARANCE,
        mode: 'dark',
        glassLevel: 'balanced',
      }),
    );
  });

  it('shows an older saved glass level as on and switches it off', async () => {
    const onChange = vi.fn(async () => {});
    render(
      <AppearanceSettings value={{ ...DEFAULT_APPEARANCE, glassLevel: 'subtle' }} onChange={onChange} />,
    );
    const glass = screen.getByRole('checkbox', { name: /Glass surfaces/ });
    expect(glass).toBeChecked();
    fireEvent.click(glass);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, glassLevel: 'off' }));
  });

  it('keeps retired toggles out of Settings', () => {
    const { rerender } = render(<SettingsView activeCategory="Features" />);
    expect(screen.queryByRole('checkbox', { name: 'Enable screen capture' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Screen capture' })).toBeInTheDocument();
    rerender(<SettingsView activeCategory="Shortcuts" />);
    expect(screen.queryByText('Open recent project')).not.toBeInTheDocument();
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
      name: 'Shortcut for Capture screen area',
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
    const capture = screen.getByRole('button', { name: 'Shortcut for Capture screen area' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Capture screen area shortcut' }));
    await waitFor(() => expect(capture).toHaveTextContent('Not set'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Capture screen area shortcut to default' }));
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

  it('lists the rail reorder keys and the newer actions, and flags only stored conflicts', () => {
    const { rerender } = render(
      <ShortcutSettings value={{ bindings: {} }} onChange={vi.fn()} platform="windows" />,
    );
    // The rail keys share Alt + Arrow with previous/next screenshot without being a conflict.
    expect(screen.getByRole('button', { name: 'Shortcut for Move focused rail item up' })).toHaveTextContent(
      'Alt + ArrowUp',
    );
    expect(screen.getByRole('button', { name: 'Shortcut for Go back' })).toHaveTextContent('Alt + ArrowLeft');
    expect(screen.getByRole('button', { name: 'Shortcut for Redact' })).toHaveTextContent('M');
    expect(screen.getByRole('button', { name: 'Shortcut for Delete current item' })).toHaveTextContent(
      'Ctrl + Delete',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // A binding saved by an older version keeps its key; the new action shows as not set.
    rerender(
      <ShortcutSettings value={{ bindings: { 'tool.text': 'M' } }} onChange={vi.fn()} platform="windows" />,
    );
    expect(screen.getByRole('button', { name: 'Shortcut for Text' })).toHaveTextContent('M');
    expect(screen.getByRole('button', { name: 'Shortcut for Redact' })).toHaveTextContent('Not set');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers replay without mutating completion state or workspace files', () => {
    const onReplay = vi.fn();
    render(<OnboardingSettings value={{ completed: true, completedVersion: 1 }} onReplay={onReplay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay guide' }));
    expect(onReplay).toHaveBeenCalledOnce();
    expect(screen.getByText('Completed with guide version 1')).toBeInTheDocument();
    expect(screen.getByText(/without changing a workspace/i)).toBeInTheDocument();
  });

  it('leaves the copy format choice to the Copy Bundle menu', () => {
    render(<SettingsView activeCategory="Sharing" preferences={DEFAULT_PREFERENCE_SETTINGS} />);
    expect(screen.queryByRole('combobox', { name: 'Native copy functions' })).not.toBeInTheDocument();
  });

  it('explains when the background capture shortcut could not be registered', () => {
    render(
      <SettingsView
        activeCategory="Features"
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
        activeCategory="Features"
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

  it('defaults beta recognised text in Markdown off and emits a persisted change', async () => {
    const onPromptExportChange = vi.fn(async () => {});
    render(
      <SettingsView
        activeCategory="Features"
        preferences={DEFAULT_PREFERENCE_SETTINGS}
        onPromptExportChange={onPromptExportChange}
      />,
    );
    const toggle = screen.getByRole('checkbox', { name: 'Include recognised text in Markdown' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(onPromptExportChange).toHaveBeenCalledWith({ includeRecognisedText: true }));
  });
});

function PreferenceSaveHarness({ panel }: { panel: 'appearance' | 'shortcuts' }) {
  const preferences = usePreferences();
  if (preferences.loading) return <p>Loading preferences</p>;
  return panel === 'appearance' ? (
    <AppearanceSettings value={preferences.settings.appearance} onChange={preferences.saveAppearance} />
  ) : (
    <ShortcutSettings
      value={preferences.settings.shortcuts}
      onChange={preferences.saveShortcuts}
      platform="windows"
    />
  );
}

for (const panel of ['appearance', 'shortcuts'] as const) {
  it.each(['committed', 'precommit', 'readback-failed'] as const)(
    `${panel} preserves the error and observed settings for %s`,
    async (outcome) => {
      let settings = structuredClone(DEFAULT_PREFERENCE_SETTINGS);
      const failure = outcome === 'precommit' ? 'Disk full before replacement.' : COMMITTED_WRITE_WARNING;
      const getPreferenceSettings = vi.fn(async () => ({
        ok: true as const,
        value: { settings, profile: { settingsFileExists: true, migratedFromLegacyProfile: false } },
      }));
      const setPreferenceSettings = vi.fn(async (patch: Partial<PreferenceSettings>) => {
        if (outcome !== 'precommit') settings = { ...settings, ...patch };
        if (outcome === 'readback-failed')
          getPreferenceSettings.mockRejectedValueOnce(new Error('Read unavailable.'));
        return { ok: false, error: { code: 'unexpected', message: failure, retryable: false } };
      });
      vi.stubGlobal('imnota', {
        getPreferenceSettings,
        setPreferenceSettings,
        getNativePerformanceProfile: async () => ({
          ok: true,
          value: {
            platform: 'windows',
            performanceClass: 'standard',
            reducedEffectsRecommended: false,
            reasons: [],
          },
        }),
        getNativeCapabilities: async () => ({
          ok: true,
          value: { fileClipboard: true, globalCaptureShortcutRegistered: true },
        }),
      });
      try {
        render(<PreferenceSaveHarness panel={panel} />);
        if (panel === 'appearance') fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
        else {
          const recorder = await screen.findByRole('button', { name: 'Shortcut for Text' });
          fireEvent.click(recorder);
          fireEvent.keyDown(recorder, { key: 'x', ctrlKey: true, shiftKey: true });
        }
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(failure));
        expect(screen.getByRole('alert')).not.toHaveTextContent(/previous .* active/);
        if (panel === 'appearance')
          expect(
            screen.getByRole('radio', { name: outcome === 'committed' ? 'Dark' : 'System' }),
          ).toBeChecked();
        else {
          const recorder = screen.getByRole('button', { name: 'Shortcut for Text' });
          fireEvent.keyDown(recorder, { key: 'Escape' });
          expect(recorder).toHaveTextContent(outcome === 'committed' ? 'Ctrl + Shift + X' : 'T');
        }
        expect(setPreferenceSettings).toHaveBeenCalledOnce();
        expect(getPreferenceSettings).toHaveBeenCalledTimes(outcome === 'precommit' ? 1 : 2);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
}
