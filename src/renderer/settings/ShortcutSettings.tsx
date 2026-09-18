import { RotateCcw, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  SHORTCUT_ACTIONS,
  describeCommonShortcut,
  detectShortcutPlatform,
  findShortcutConflicts,
  formatShortcut,
  getDefaultShortcuts,
  keyboardEventToShortcut,
  resolveShortcutBindings,
  validateShortcut,
  type ShortcutActionId,
  type ShortcutPlatform,
  type ShortcutValidationIssue,
} from '../../shared/shortcuts';
import type { ShortcutPreferences } from './preferences';
import './settings.css';

export interface ShortcutSettingsProps {
  value: ShortcutPreferences;
  onChange: (next: ShortcutPreferences) => void | Promise<void>;
  platform?: ShortcutPlatform;
  disabled?: boolean;
}

interface RowNotice {
  actionId: ShortcutActionId;
  kind: ShortcutValidationIssue['kind'] | 'confirm' | 'saved';
  message: string;
  /** Set while a common-shortcut clash waits for the same keys to be pressed again. */
  candidate?: string;
}

export function ShortcutSettings({
  value,
  onChange,
  platform = detectShortcutPlatform(),
  disabled = false,
}: ShortcutSettingsProps) {
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const bindings = useMemo(
    () => resolveShortcutBindings(value.bindings, platform),
    [platform, value.bindings],
  );
  const defaults = useMemo(() => getDefaultShortcuts(platform), [platform]);
  const conflictActions = useMemo(
    () => new Set(findShortcutConflicts(bindings).flatMap((conflict) => conflict.actionIds)),
    [bindings],
  );
  const visibleActions = SHORTCUT_ACTIONS.filter((action) =>
    `${action.label} ${action.group}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = [...new Set(visibleActions.map((action) => action.group))];
  const labelOf = (actionId: ShortcutActionId) =>
    SHORTCUT_ACTIONS.find((action) => action.id === actionId)?.label ?? actionId;

  const save = async (next: ShortcutPreferences) => {
    if (busy || disabled) return false;
    setBusy(true);
    setSaveError('');
    try {
      await onChange(next);
      return true;
    } catch {
      setSaveError('Shortcuts could not be saved. Your previous bindings are still active.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = () => setRecording(null);

  const commit = async (actionId: ShortcutActionId, binding: string | null, done: string) => {
    if (await save({ bindings: { ...value.bindings, [actionId]: binding } })) {
      stopRecording();
      setNotice({ actionId, kind: 'saved', message: done });
    }
  };

  const resetToDefault = async (actionId: ShortcutActionId) => {
    const rest = { ...value.bindings };
    delete rest[actionId];
    if (await save({ bindings: rest })) {
      stopRecording();
      setNotice({
        actionId,
        kind: 'saved',
        message: `Reset to ${formatShortcut(defaults[actionId], platform)}.`,
      });
    }
  };

  const record = async (actionId: ShortcutActionId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stopRecording();
      setNotice(null);
      return;
    }
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      await commit(actionId, null, 'Shortcut cleared. The button and menu actions still work.');
      return;
    }
    // Modifier-only or unrecognised keys never save: the recorder keeps waiting.
    const candidate = keyboardEventToShortcut(event.nativeEvent, platform);
    if (!candidate) return;
    const issue = validateShortcut(actionId, candidate, bindings, platform);
    if (issue) {
      setNotice({ actionId, kind: issue.kind, message: issue.message });
      return;
    }
    const common = describeCommonShortcut(candidate, platform);
    if (common && !(notice?.kind === 'confirm' && notice.candidate === candidate)) {
      setNotice({
        actionId,
        kind: 'confirm',
        candidate,
        message: `${common} It still works while Imnota is focused. Press it again to keep it, or press different keys.`,
      });
      return;
    }
    await commit(actionId, candidate, `Saved ${formatShortcut(candidate, platform)}.`);
  };

  return (
    <section className="imnota-preference-section" aria-labelledby="shortcut-settings-title">
      <header className="imnota-preference-heading imnota-shortcut-heading">
        <div>
          <h2 id="shortcut-settings-title">Keyboard shortcuts</h2>
          <p>Mouse controls remain available. Shortcuts pause while you type or use a dialog.</p>
        </div>
        <button
          type="button"
          className="imnota-secondary-button"
          disabled={disabled || busy}
          onClick={() => void save({ bindings: {} })}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset defaults
        </button>
      </header>

      <label className="imnota-shortcut-search">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Find a shortcut</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an action"
        />
        {query && (
          <button type="button" aria-label="Clear shortcut search" onClick={() => setQuery('')}>
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </label>

      <p className="sr-only" aria-live="polite">
        {recording
          ? `Recording a shortcut for ${labelOf(recording)}. Press the keys to use, Backspace to clear, or Escape to cancel.`
          : ''}
      </p>

      <div className="imnota-shortcut-table">
        {groups.map((group) => (
          <div className="imnota-shortcut-group" key={group}>
            <h3>{group}</h3>
            {visibleActions
              .filter((action) => action.group === group)
              .map((action) => {
                const rowNotice = notice?.actionId === action.id ? notice : null;
                const hasStoredConflict = conflictActions.has(action.id);
                const binding = bindings[action.id];
                const isRecording = recording === action.id;
                const isDefault = binding === defaults[action.id];
                const problem = rowNotice && rowNotice.kind !== 'saved' && rowNotice.kind !== 'confirm';
                return (
                  <div
                    className="imnota-shortcut-row"
                    key={action.id}
                    data-conflict={hasStoredConflict || undefined}
                    data-recording={isRecording || undefined}
                  >
                    <div>
                      <strong>{action.label}</strong>
                      {(rowNotice || hasStoredConflict) && (
                        <small
                          role={problem || (!rowNotice && hasStoredConflict) ? 'alert' : 'status'}
                          data-tone={rowNotice?.kind ?? 'conflict'}
                        >
                          {rowNotice?.message ?? 'This imported binding conflicts with another action.'}
                        </small>
                      )}
                    </div>
                    <div className="imnota-shortcut-controls">
                      <button
                        type="button"
                        className="imnota-shortcut-recorder"
                        aria-label={`Shortcut for ${action.label}`}
                        aria-pressed={isRecording}
                        disabled={disabled || busy}
                        onClick={() => {
                          setRecording(action.id);
                          setNotice(null);
                        }}
                        onBlur={() => {
                          if (isRecording) {
                            stopRecording();
                            if (notice?.kind === 'confirm') setNotice(null);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (isRecording) void record(action.id, event);
                        }}
                      >
                        {isRecording ? 'Press keys…' : formatShortcut(binding, platform)}
                      </button>
                      <button
                        type="button"
                        className="imnota-shortcut-row-action"
                        aria-label={`Reset ${action.label} shortcut to default`}
                        title={`Reset to ${formatShortcut(defaults[action.id], platform)}`}
                        disabled={disabled || busy || isDefault}
                        onClick={() => void resetToDefault(action.id)}
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="imnota-shortcut-row-action"
                        aria-label={`Clear ${action.label} shortcut`}
                        title="Clear shortcut"
                        disabled={disabled || busy || binding === null}
                        onClick={() =>
                          void commit(
                            action.id,
                            null,
                            'Shortcut cleared. The button and menu actions still work.',
                          )
                        }
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
        {visibleActions.length === 0 && (
          <p className="imnota-no-results">No shortcut actions match “{query}”.</p>
        )}
      </div>
      <p className="imnota-shortcut-help">
        Click a shortcut, then press the keys. The saved combination appears in the button. Backspace clears
        while recording; Escape cancels.
      </p>
      {saveError && (
        <p className="imnota-preference-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
