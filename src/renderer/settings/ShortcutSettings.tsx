import { RotateCcw, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  SHORTCUT_ACTIONS,
  detectShortcutPlatform,
  findShortcutConflicts,
  formatShortcut,
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

export function ShortcutSettings({
  value,
  onChange,
  platform = detectShortcutPlatform(),
  disabled = false,
}: ShortcutSettingsProps) {
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [query, setQuery] = useState('');
  const [issue, setIssue] = useState<{ actionId: ShortcutActionId; issue: ShortcutValidationIssue } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const bindings = useMemo(
    () => resolveShortcutBindings(value.bindings, platform),
    [platform, value.bindings],
  );
  const conflictActions = useMemo(
    () => new Set(findShortcutConflicts(bindings).flatMap((conflict) => conflict.actionIds)),
    [bindings],
  );
  const visibleActions = SHORTCUT_ACTIONS.filter((action) =>
    `${action.label} ${action.group}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = [...new Set(visibleActions.map((action) => action.group))];

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

  const record = async (actionId: ShortcutActionId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setIssue(null);
      return;
    }
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      if (await save({ bindings: { ...value.bindings, [actionId]: null } })) {
        setRecording(null);
        setIssue(null);
      }
      return;
    }
    const candidate = keyboardEventToShortcut(event.nativeEvent, platform);
    if (!candidate) return;
    const nextIssue = validateShortcut(actionId, candidate, bindings, platform);
    if (nextIssue) {
      setIssue({ actionId, issue: nextIssue });
      return;
    }
    if (await save({ bindings: { ...value.bindings, [actionId]: candidate } })) {
      setRecording(null);
      setIssue(null);
    }
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

      <div className="imnota-shortcut-table">
        {groups.map((group) => (
          <div className="imnota-shortcut-group" key={group}>
            <h3>{group}</h3>
            {visibleActions
              .filter((action) => action.group === group)
              .map((action) => {
                const actionIssue = issue?.actionId === action.id ? issue.issue : null;
                const hasStoredConflict = conflictActions.has(action.id);
                return (
                  <div
                    className="imnota-shortcut-row"
                    key={action.id}
                    data-conflict={hasStoredConflict || undefined}
                  >
                    <div>
                      <strong>{action.label}</strong>
                      {(actionIssue || hasStoredConflict) && (
                        <small role="alert">
                          {actionIssue?.message ?? 'This imported binding conflicts with another action.'}
                        </small>
                      )}
                    </div>
                    <button
                      type="button"
                      className="imnota-shortcut-recorder"
                      aria-label={`Shortcut for ${action.label}`}
                      aria-pressed={recording === action.id}
                      disabled={disabled || busy}
                      onClick={() => {
                        setRecording(action.id);
                        setIssue(null);
                      }}
                      onBlur={() => {
                        if (recording === action.id) setRecording(null);
                      }}
                      onKeyDown={(event) => {
                        if (recording === action.id) void record(action.id, event);
                      }}
                    >
                      {recording === action.id
                        ? 'Press shortcut'
                        : formatShortcut(bindings[action.id], platform)}
                    </button>
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
        Press Backspace while recording to clear a binding. Escape cancels.
      </p>
      {saveError && (
        <p className="imnota-preference-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
