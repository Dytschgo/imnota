import { useRef, useState } from 'react';
import type { PreferenceSettings } from '../../shared/preferences';
import type { PreferenceSettingsUpdate } from '../../shared/workflow-bridge';
import { Button } from '../components/ui';

export function ExportPresetSettings({
  preferences,
  disabled,
  onSave,
  nativeCopyAvailable,
}: {
  preferences: PreferenceSettings;
  disabled: boolean;
  onSave?: (update: PreferenceSettingsUpdate) => Promise<void>;
  nativeCopyAvailable: boolean;
}) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const presets = preferences.exportPresets;
  const selected = presets.find((preset) => preset.id === selectedId);
  const locked = disabled || pending || !onSave;
  const trimmedName = name.trim();
  const duplicate = presets.some((preset) => preset.name.toLowerCase() === trimmedName.toLowerCase());
  async function save(update: PreferenceSettingsUpdate, after: () => void) {
    if (locked || busy.current || !onSave) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await onSave(update);
      after();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save export preferences. Try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="settings-section" aria-labelledby="export-presets-title">
      <h2 id="export-presets-title">Export presets</h2>
      <p>Save your current copy format and recognised-text option together. Presets stay on this device.</p>
      <label className="field">
        <span className="field-label">Saved preset</span>
        <select
          aria-label="Saved export preset"
          value={selected?.id ?? ''}
          disabled={locked || !presets.length}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">Choose a preset</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p>
          {
            {
              files: 'Markdown and PNG files',
              'files-rich': 'Files, text, and image',
              rich: 'Text and image',
            }[nativeCopyAvailable ? selected.defaultFunction : 'rich']
          }{' '}
          · Recognised text {selected.includeRecognisedText ? 'included' : 'excluded'}
        </p>
      )}
      <div className="settings-actions">
        <Button
          disabled={locked || !selected}
          onClick={() => {
            if (selected)
              void save(
                {
                  nativeCopy: { defaultFunction: nativeCopyAvailable ? selected.defaultFunction : 'rich' },
                  promptExport: { includeRecognisedText: selected.includeRecognisedText },
                },
                () => undefined,
              );
          }}
        >
          Apply preset
        </Button>
        <Button
          disabled={locked || !selected}
          onClick={() => {
            if (selected)
              void save({ exportPresets: presets.filter((preset) => preset.id !== selected.id) }, () =>
                setSelectedId(''),
              );
          }}
        >
          Remove preset
        </Button>
      </div>
      <label className="field">
        <span className="field-label">New preset name</span>
        <input
          aria-label="New export preset name"
          value={name}
          maxLength={60}
          disabled={locked || presets.length >= 20}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {duplicate && <p role="status">Choose a name you have not used yet.</p>}
      {presets.length >= 20 && <p role="status">You have 20 presets. Remove one to save another.</p>}
      <Button
        disabled={locked || !trimmedName || duplicate || presets.length >= 20}
        onClick={() => {
          const preset = {
            id: crypto.randomUUID(),
            name: trimmedName,
            defaultFunction: nativeCopyAvailable ? preferences.nativeCopy.defaultFunction : ('rich' as const),
            includeRecognisedText: preferences.promptExport.includeRecognisedText,
          };
          void save({ exportPresets: [...presets, preset] }, () => {
            setName('');
            setSelectedId(preset.id);
          });
        }}
      >
        Save current options
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
