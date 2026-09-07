import { Check, ImagePlus, Monitor, Moon, Sparkles, Sun, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  BACKDROP_PRESETS,
  BACKGROUND_IMAGE_MAX_BYTES,
  BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH,
  BACKGROUND_IMAGE_MAX_DIMENSION,
  BACKGROUND_IMAGE_MAX_PIXELS,
  backdropPresetValue,
  type BackdropPreset,
} from '../../shared/preferences';
import { backdropPresetUrl, type EffectiveAppearance } from '../app/useAppearance';
import { Button } from '../components/ui';
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

const BACKDROP_LABELS: Record<BackdropPreset, string> = {
  graphite: 'Graphite',
  indigo: 'Indigo',
  emerald: 'Emerald',
  amber: 'Amber',
};

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  if (typeof image.decode === 'function') {
    await image.decode();
    return image;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image decode failed.'));
  });
  return image;
}

async function normalizeBackdrop(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error('Image has no usable dimensions.');
  const scale = Math.min(
    1,
    BACKGROUND_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(BACKGROUND_IMAGE_MAX_PIXELS / (sourceWidth * sourceHeight)),
  );
  const canvas = document.createElement('canvas');
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image normalization is unavailable.');

  for (let pass = 0; pass < 3; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.88, 0.78, 0.68]) {
      const normalized = canvas.toDataURL('image/jpeg', quality);
      if (normalized.length <= BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH) return normalized;
    }
    width = Math.max(1, Math.floor(width * 0.8));
    height = Math.max(1, Math.floor(height * 0.8));
  }
  throw new Error('Image remains too large after normalization.');
}

export function AppearanceSettings({
  value,
  onChange,
  effectiveAppearance,
  disabled = false,
}: AppearanceSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);

  useEffect(
    () => () => {
      readGeneration.current += 1;
    },
    [],
  );

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
        <legend>Glass surfaces</legend>
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

      <section className="imnota-background-settings" aria-labelledby="background-settings-title">
        <div className="imnota-background-heading">
          <div>
            <h3 id="background-settings-title">Backdrop</h3>
            <p>
              Choose a bundled image or upload one from this device. Balanced or Strong glass lets it show
              through.
            </p>
          </div>
          <div className="imnota-background-actions">
            <Button variant="soft" disabled={controlsDisabled} onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={14} aria-hidden="true" />
              Choose image
            </Button>
            {value.backgroundImage && (
              <Button
                variant="ghost"
                disabled={controlsDisabled}
                data-testid="backdrop-remove"
                onClick={() => void update({ backgroundImage: '' })}
              >
                <Trash2 size={14} aria-hidden="true" />
                Remove
              </Button>
            )}
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              disabled={controlsDisabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                  setError('Choose an image file from this device.');
                  return;
                }
                if (file.size > BACKGROUND_IMAGE_MAX_BYTES) {
                  setError('Choose an image smaller than 5.5 MB.');
                  return;
                }
                const generation = ++readGeneration.current;
                const reader = new FileReader();
                reader.onload = () => {
                  if (generation !== readGeneration.current || typeof reader.result !== 'string') return;
                  void normalizeBackdrop(reader.result)
                    .then((normalized) => {
                      if (generation === readGeneration.current) void update({ backgroundImage: normalized });
                    })
                    .catch(() => {
                      if (generation === readGeneration.current)
                        setError('That image could not be normalized. Choose a smaller image.');
                    });
                };
                reader.onerror = () => {
                  if (generation === readGeneration.current)
                    setError('The background image could not be read. Try another local image.');
                };
                reader.readAsDataURL(file);
              }}
            />
          </div>
        </div>
        <label className="imnota-range-row">
          <span>
            <strong>Background opacity</strong>
            <small>Lower the image when it competes with screenshot details.</small>
          </span>
          <span className="imnota-range-control">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={value.backgroundOpacity}
              disabled={controlsDisabled || !value.backgroundImage}
              onChange={(event) => void update({ backgroundOpacity: Number(event.target.value) })}
            />
            <output>{Math.round(value.backgroundOpacity * 100)}%</output>
          </span>
        </label>
        <div className="imnota-backdrop-presets" role="group" aria-label="Bundled backdrops">
          <span>Bundled backdrops</span>
          <div>
            {BACKDROP_PRESETS.map((preset) => {
              const selected = value.backgroundImage === backdropPresetValue(preset);
              return (
                <button
                  type="button"
                  className={`imnota-backdrop-preset ${selected ? 'active' : ''}`}
                  key={preset}
                  data-testid={`backdrop-preset-${preset}`}
                  aria-pressed={selected}
                  disabled={controlsDisabled}
                  onClick={() => void update({ backgroundImage: backdropPresetValue(preset) })}
                >
                  <img src={backdropPresetUrl(preset)} alt="" />
                  <span>{BACKDROP_LABELS[preset]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {error && (
        <p className="imnota-preference-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
