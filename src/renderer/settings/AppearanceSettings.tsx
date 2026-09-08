import { Check, ImagePlus, Monitor, Moon, Sparkles, Sun, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  CHARACTER_BACKDROP_PRESETS,
  GENERIC_BACKDROP_PRESETS,
  BACKGROUND_IMAGE_MAX_BYTES,
  BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH,
  BACKGROUND_IMAGE_MAX_DIMENSION,
  BACKGROUND_IMAGE_MAX_PIXELS,
  appearanceBackdrop,
  backdropPresetValue,
  type BackdropPreset,
} from '../../shared/preferences';
import { backdropPresetUrl, type EffectiveAppearance } from '../app/useAppearance';
import { Button } from '../components/ui';
import type { AccentPreset, AppearanceMode, AppearancePreferences, GlassLevel } from './preferences';
import './settings.css';
import {
  savedBackgrounds,
  saveBackground,
  removeBackground,
  type SavedBackground,
} from './background-library';

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
  'mist-light': 'Mist light',
  'sand-light': 'Sand light',
  'slate-dark': 'Slate dark',
  'dusk-dark': 'Dusk dark',
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
  const [library, setLibrary] = useState<SavedBackground[]>([]);
  const initialBackground = useRef(value.backgroundImage);
  useEffect(() => {
    let active = true;
    savedBackgrounds()
      .then(async (images) => {
        if (active) setLibrary(images);
        const current = initialBackground.current;
        if (current.startsWith('data:') && !images.some((image) => image.dataUrl === current)) {
          await saveBackground('Previous uploaded image', current);
          if (active) setLibrary(await savedBackgrounds());
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Your saved backdrop library could not be opened. Existing appearance settings are unchanged.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const busyRef = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      readGeneration.current += 1;
    },
    [],
  );

  const invalidatePendingUpload = () => {
    readGeneration.current += 1;
    return readGeneration.current;
  };

  const update = async (
    patch: Partial<AppearancePreferences>,
    { invalidateUpload = true }: { invalidateUpload?: boolean } = {},
  ) => {
    if (invalidateUpload) invalidatePendingUpload();
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onChange({
        ...valueRef.current,
        ...patch,
        ...('backgroundImage' in patch && !('desktopGlass' in patch) ? { desktopGlass: false } : {}),
      });
    } catch {
      setError('Appearance could not be saved. Your previous preference is still active.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const controlsDisabled = disabled || busy;
  const activeTheme = effectiveAppearance?.theme ?? (value.mode === 'light' ? 'light' : 'dark');
  const activeBackdrop = appearanceBackdrop(value, activeTheme);
  const desktopBackdrop = Boolean(value.desktopGlass && !activeBackdrop.image);
  const updateBackdrop = (image: string) => {
    if (value.useSameBackdropForBoth) return update({ backgroundImage: image });
    return activeTheme === 'dark'
      ? update({ darkBackgroundImage: image })
      : update({ lightBackgroundImage: image });
  };
  const updateBackdropOpacity = (opacity: number) => {
    if (value.useSameBackdropForBoth) return update({ backgroundOpacity: opacity });
    return activeTheme === 'dark'
      ? update({ darkBackgroundOpacity: opacity })
      : update({ lightBackgroundOpacity: opacity });
  };
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
              Choose a bundled image or upload one from this device. Light mode automatically reveals the
              image through glass surfaces.
            </p>
          </div>
          <div className="imnota-background-actions">
            <Button variant="soft" disabled={controlsDisabled} onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={14} aria-hidden="true" />
              Choose image
            </Button>
            {activeBackdrop.image && (
              <Button
                variant="ghost"
                disabled={controlsDisabled}
                data-testid="backdrop-remove"
                onClick={() => void updateBackdrop('')}
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
                const generation = invalidatePendingUpload();
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                  setError('Choose an image file from this device.');
                  return;
                }
                if (file.size > BACKGROUND_IMAGE_MAX_BYTES) {
                  setError('Choose an image smaller than 5.5 MB.');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  if (generation !== readGeneration.current || typeof reader.result !== 'string') return;
                  void normalizeBackdrop(reader.result)
                    .catch(() => {
                      throw new Error('decode-failed');
                    })
                    .then(async (normalized) => {
                      if (generation !== readGeneration.current) return;
                      await saveBackground(file.name, normalized);
                      if (generation !== readGeneration.current) return;
                      setLibrary(await savedBackgrounds());
                      if (generation === readGeneration.current) await updateBackdrop(normalized);
                    })
                    .catch((failure: unknown) => {
                      if (generation === readGeneration.current)
                        setError(
                          failure instanceof Error && failure.message === 'decode-failed'
                            ? 'That image could not be normalized. Choose a smaller image.'
                            : 'That image could not be saved. Check available disk space and remove an unused library image if all 12 slots are full.',
                        );
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
        <div className="imnota-background-modes" role="group" aria-label="Backdrop source">
          <button
            type="button"
            disabled={controlsDisabled}
            aria-pressed={!activeBackdrop.image && !value.desktopGlass}
            onClick={() =>
              void (value.useSameBackdropForBoth
                ? update({ backgroundImage: '', desktopGlass: false })
                : activeTheme === 'dark'
                  ? update({ darkBackgroundImage: '', desktopGlass: false })
                  : update({ lightBackgroundImage: '', desktopGlass: false }))
            }
          >
            No image
          </button>
          <button
            type="button"
            disabled={controlsDisabled}
            aria-pressed={!activeBackdrop.image && Boolean(value.desktopGlass)}
            onClick={() =>
              void (value.useSameBackdropForBoth
                ? update({
                    backgroundImage: '',
                    desktopGlass: true,
                    glassLevel: value.glassLevel === 'off' ? 'balanced' : value.glassLevel,
                  })
                : activeTheme === 'dark'
                  ? update({
                      darkBackgroundImage: '',
                      desktopGlass: true,
                      glassLevel: value.glassLevel === 'off' ? 'balanced' : value.glassLevel,
                    })
                  : update({
                      lightBackgroundImage: '',
                      desktopGlass: true,
                      glassLevel: value.glassLevel === 'off' ? 'balanced' : value.glassLevel,
                    }))
            }
          >
            Desktop glass (Beta)
          </button>
        </div>
        {desktopBackdrop && (
          <p className="imnota-background-hint" role="status">
            {effectiveAppearance?.desktopGlassStatus === 'active'
              ? 'Desktop glass (Beta) is active. '
              : 'Solid fallback is active on this configuration. '}
            Beta: scrolling or transparency may show rendering glitches. Choose No image or Solid surfaces if
            this happens. Uses native desktop material on macOS and supported Windows 11 systems. Other
            systems, reduced transparency, and constrained-performance mode use solid surfaces.
          </p>
        )}
        <label className="imnota-range-row">
          <span>
            <strong>{desktopBackdrop ? 'Glass tint' : 'Background opacity'}</strong>
            <small>
              {desktopBackdrop
                ? 'Lower the tint to reveal more of the desktop material.'
                : 'Lower the image when it competes with screenshot details.'}
            </small>
          </span>
          <span className="imnota-range-control">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={activeBackdrop.opacity}
              disabled={controlsDisabled || (!activeBackdrop.image && !value.desktopGlass)}
              onChange={(event) => void updateBackdropOpacity(Number(event.target.value))}
            />
            <output>{Math.round(activeBackdrop.opacity * 100)}%</output>
          </span>
        </label>
        <label className="imnota-check-row imnota-backdrop-theme-link">
          <input
            type="checkbox"
            checked={value.useSameBackdropForBoth}
            disabled={controlsDisabled}
            onChange={(event) => {
              if (event.target.checked) {
                void update({
                  useSameBackdropForBoth: true,
                  backgroundImage: activeBackdrop.image,
                  backgroundOpacity: activeBackdrop.opacity,
                });
              } else {
                void update({
                  useSameBackdropForBoth: false,
                  ...(value.themeBackdropsInitialized
                    ? {}
                    : {
                        themeBackdropsInitialized: true,
                        lightBackgroundImage: activeBackdrop.image,
                        darkBackgroundImage: activeBackdrop.image,
                        lightBackgroundOpacity: activeBackdrop.opacity,
                        darkBackgroundOpacity: activeBackdrop.opacity,
                      }),
                });
              }
            }}
          />
          <span>
            <strong>Use the same image and opacity in light and dark themes</strong>
            <small>
              Turn this off to choose a separate backdrop for {activeTheme} mode. System mode follows the
              current operating-system theme.
            </small>
          </span>
        </label>
        {[
          { label: 'Generic', presets: GENERIC_BACKDROP_PRESETS },
          { label: 'Characters', presets: CHARACTER_BACKDROP_PRESETS },
        ].map(({ label, presets }) => (
          <div key={label} className="imnota-backdrop-presets" role="group" aria-label={`${label} backdrops`}>
            <span>
              {label}
              {value.useSameBackdropForBoth ? '' : ` for ${activeTheme} mode`}
            </span>
            <div>
              {presets.map((preset) => {
                const selected = activeBackdrop.image === backdropPresetValue(preset);
                return (
                  <button
                    type="button"
                    className={`imnota-backdrop-preset ${selected ? 'active' : ''}`}
                    key={preset}
                    data-testid={`backdrop-preset-${preset}`}
                    aria-pressed={selected}
                    disabled={controlsDisabled}
                    onClick={() => void updateBackdrop(backdropPresetValue(preset))}
                  >
                    <img src={backdropPresetUrl(preset)} alt="" loading="lazy" />
                    <span>{BACKDROP_LABELS[preset]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="imnota-backdrop-presets" role="group" aria-label="Uploaded backdrops">
          <span>Your images{value.useSameBackdropForBoth ? '' : ` for ${activeTheme} mode`}</span>
          <div>
            {library.map((entry) => (
              <div key={entry.id} className="imnota-uploaded-backdrop">
                <button
                  type="button"
                  className="imnota-backdrop-preset"
                  disabled={controlsDisabled}
                  aria-pressed={activeBackdrop.image === entry.dataUrl}
                  onClick={() => void updateBackdrop(entry.dataUrl)}
                >
                  <img src={entry.preview ?? entry.dataUrl} alt="" loading="lazy" />
                  <span title={entry.name}>{entry.name}</span>
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  aria-label={`Remove ${entry.name} from library`}
                  onClick={async () => {
                    try {
                      await removeBackground(entry.id);
                      setLibrary(await savedBackgrounds());
                    } catch {
                      setError('The image could not be removed from your library. Try again.');
                    }
                  }}
                >
                  Remove from library
                </button>
              </div>
            ))}
          </div>
          {!library.length && (
            <p>Uploaded images stay on this device so you can select them again. Up to 12 images.</p>
          )}
          {activeBackdrop.image.startsWith('data:') &&
            !library.some((entry) => entry.dataUrl === activeBackdrop.image) && (
              <Button
                variant="soft"
                disabled={controlsDisabled}
                onClick={async () => {
                  try {
                    await saveBackground('Previous uploaded image', activeBackdrop.image);
                    setLibrary(await savedBackgrounds());
                  } catch {
                    setError(
                      'The current image could not be added. Check disk space or remove an unused library image.',
                    );
                  }
                }}
              >
                Keep current image in library
              </Button>
            )}
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
