import { Check, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import { useState } from 'react';
import type { EffectiveAppearance } from '../app/useAppearance';
import type { AccentPreset, AppearanceMode, AppearancePreferences, GlassLevel } from './preferences';
import './settings.css';

export interface AppearanceSettingsProps {
  value: AppearancePreferences;
  onChange: (next: AppearancePreferences) => void | Promise<void>;
  effectiveAppearance?: EffectiveAppearance;
  disabled?: boolean;
}

const THEMES: Array<{ value: AppearanceMode; label: string; icon: typeof Monitor }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

const ACCENTS: Array<{ value: AccentPreset; label: string; color: string }> = [
  { value: 'graphite', label: 'Graphite', color: '#7d8798' },
  { value: 'indigo', label: 'Indigo', color: '#6857f5' },
  { value: 'emerald', label: 'Emerald', color: '#159668' },
  { value: 'amber', label: 'Amber', color: '#c77c11' },
];

const GLASS_LEVELS: Array<{ value: GlassLevel; label: string; description: string }> = [
  { value: 'off', label: 'Solid', description: 'No transparency' },
  { value: 'subtle', label: 'Subtle', description: '92% surface' },
  { value: 'balanced', label: 'Balanced', description: '82% surface' },
  { value: 'strong', label: 'Strong', description: '70% surface' },
];

export function AppearanceSettings({
  value,
  onChange,
  effectiveAppearance,
  disabled = false,
}: AppearanceSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = async (patch: Partial<AppearancePreferences>) => {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await onChange({ ...value, ...patch });
    } catch {
      setError('Appearance could not be saved. Your previous preference is still active.');
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = disabled || busy;
  const fallbackMessage =
    effectiveAppearance?.glassFallbackReason === 'reduced-transparency'
      ? 'Solid surfaces are active because the operating system requests reduced transparency.'
      : effectiveAppearance?.glassFallbackReason === 'performance'
        ? 'Solid surfaces are active because the host reported constrained performance.'
        : null;

  return (
    <section className="imnota-preference-section" aria-labelledby="appearance-settings-title">
      <header className="imnota-preference-heading">
        <div>
          <h2 id="appearance-settings-title">Appearance</h2>
          <p>Choose how Imnota looks on this device. Exports keep their neutral white background.</p>
        </div>
      </header>

      <div className="imnota-preference-row">
        <div className="imnota-preference-copy">
          <strong>Theme</strong>
          <span>System follows operating-system changes while Imnota is open.</span>
        </div>
        <div className="imnota-segmented" role="radiogroup" aria-label="Application theme">
          {THEMES.map(({ value: option, label, icon: Icon }) => (
            <label key={option} data-selected={value.mode === option || undefined}>
              <input
                type="radio"
                name="appearance-mode"
                value={option}
                checked={value.mode === option}
                disabled={controlsDisabled}
                onChange={() => void update({ mode: option })}
              />
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <fieldset className="imnota-preference-fieldset" disabled={controlsDisabled}>
        <legend>Accent</legend>
        <p>Accent color marks selected tools, active controls, and primary actions.</p>
        <div className="imnota-accent-options">
          {ACCENTS.map((option) => (
            <label key={option.value} data-selected={value.accent === option.value || undefined}>
              <input
                type="radio"
                name="accent-preset"
                value={option.value}
                checked={value.accent === option.value}
                onChange={() => void update({ accent: option.value })}
              />
              <span
                className="imnota-accent-swatch"
                style={{ background: option.color }}
                aria-hidden="true"
              />
              <span>{option.label}</span>
              {value.accent === option.value && <Check size={14} aria-hidden="true" />}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="imnota-preference-fieldset" disabled={controlsDisabled}>
        <legend>Surface transparency</legend>
        <p>Glass is cosmetic and independent from the accent preset. Solid remains the safest default.</p>
        <div className="imnota-glass-options">
          {GLASS_LEVELS.map((option) => (
            <label key={option.value} data-selected={value.glassLevel === option.value || undefined}>
              <input
                type="radio"
                name="glass-level"
                value={option.value}
                checked={value.glassLevel === option.value}
                onChange={() => void update({ glassLevel: option.value })}
              />
              <span
                className={`imnota-glass-sample imnota-glass-sample-${option.value}`}
                aria-hidden="true"
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
        {value.glassLevel !== 'off' && (
          <label className="imnota-check-row">
            <input
              type="checkbox"
              checked={value.allowPerformanceFallback}
              onChange={(event) => void update({ allowPerformanceFallback: event.target.checked })}
            />
            <span>
              <strong>Allow conservative performance fallback</strong>
              <small>
                Use solid surfaces only when the host supplies an explicit constrained-performance signal.
                Imnota does not guess device capability.
              </small>
            </span>
          </label>
        )}
        {fallbackMessage && (
          <div className="imnota-inline-status" role="status">
            <Sparkles size={15} aria-hidden="true" />
            <span>{fallbackMessage}</span>
          </div>
        )}
      </fieldset>

      {error && (
        <p className="imnota-preference-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
