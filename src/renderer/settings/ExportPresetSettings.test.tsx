import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCE_SETTINGS } from '../../shared/preferences';
import { ExportPresetSettings } from './ExportPresetSettings';

afterEach(cleanup);
const preset = {
  id: 'review',
  name: 'Review',
  defaultFunction: 'rich' as const,
  includeRecognisedText: false,
};

describe('export presets', () => {
  it('saves the effective rich-copy format when native file clipboard is unavailable', async () => {
    const onSave = vi.fn(async () => {});
    render(
      <ExportPresetSettings
        nativeCopyAvailable={false}
        preferences={DEFAULT_PREFERENCE_SETTINGS}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('New export preset name'), { target: { value: 'Mac review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        exportPresets: [
          {
            id: expect.any(String),
            name: 'Mac review',
            defaultFunction: 'rich',
            includeRecognisedText: false,
          },
        ],
      }),
    );
  });
  it('saves current options, applies both options together, and removes only the selected preset', async () => {
    const onSave = vi.fn(async () => {});
    const preferences = {
      ...DEFAULT_PREFERENCE_SETTINGS,
      nativeCopy: { defaultFunction: 'rich' as const },
      promptExport: { includeRecognisedText: false },
    };
    const { rerender } = render(
      <ExportPresetSettings
        nativeCopyAvailable={true}
        preferences={preferences}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('New export preset name'), { target: { value: ' Review ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ exportPresets: [{ ...preset, id: expect.any(String) }] }),
    );
    await waitFor(() => expect(screen.getByLabelText('New export preset name')).toHaveValue(''));
    const second = { ...preset, id: 'second', name: 'Other' };
    rerender(
      <ExportPresetSettings
        nativeCopyAvailable={true}
        preferences={{ ...DEFAULT_PREFERENCE_SETTINGS, exportPresets: [preset, second] }}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Saved export preset'), { target: { value: preset.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith({
        nativeCopy: { defaultFunction: 'rich' },
        promptExport: { includeRecognisedText: false },
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove preset' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove preset' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ exportPresets: [second] }));
  });

  it('keeps the name and previous options on save failure so the user can retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
    render(
      <ExportPresetSettings
        nativeCopyAvailable={true}
        preferences={DEFAULT_PREFERENCE_SETTINGS}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('New export preset name'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(screen.getByLabelText('New export preset name')).toHaveValue('Review');
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('New export preset name')).toHaveValue(''));
  });

  it('prevents duplicate names and overlapping saves', async () => {
    let finish!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ExportPresetSettings
        nativeCopyAvailable={true}
        preferences={{ ...DEFAULT_PREFERENCE_SETTINGS, exportPresets: [preset] }}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('New export preset name'), { target: { value: ' REVIEW ' } });
    expect(screen.getByRole('button', { name: 'Save current options' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New export preset name'), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save current options' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Saved export preset')).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByLabelText('New export preset name')).toBeEnabled());
  });
});
