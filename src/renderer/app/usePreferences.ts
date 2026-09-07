import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PREFERENCE_SETTINGS,
  type AppearancePreferences,
  type OnboardingPreferences,
  type PreferenceSettings,
  type PreferenceSettingsResult,
  type ShortcutPreferences,
} from '../../shared/preferences';
import type { NativePerformanceProfile, PreferenceSettingsUpdate } from '../../shared/workflow-bridge';
import { getRendererBridge, workflowMessage, workflowValue } from './workflow';

const UNKNOWN_PERFORMANCE: NativePerformanceProfile = {
  platform: 'unknown',
  performanceClass: 'standard',
  reducedEffectsRecommended: false,
  reasons: [],
};

export interface PreferenceController {
  result: PreferenceSettingsResult | null;
  settings: PreferenceSettings;
  performance: NativePerformanceProfile;
  loading: boolean;
  saving: boolean;
  error: string;
  save(update: PreferenceSettingsUpdate): Promise<PreferenceSettingsResult>;
  saveAppearance(value: AppearancePreferences): Promise<void>;
  saveShortcuts(value: ShortcutPreferences): Promise<void>;
  saveOnboarding(value: OnboardingPreferences): Promise<void>;
  clearError(): void;
}

export function usePreferences(): PreferenceController {
  const [result, setResult] = useState<PreferenceSettingsResult | null>(null);
  const [performance, setPerformance] = useState(UNKNOWN_PERFORMANCE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const bridge = getRendererBridge();
    void Promise.all([
      Promise.resolve().then(() => bridge.getPreferenceSettings()),
      Promise.resolve().then(() => bridge.getNativePerformanceProfile()),
    ])
      .then(([settingsResult, performanceResult]) => {
        if (!active) return;
        setResult(workflowValue(settingsResult));
        setPerformance(workflowValue(performanceResult));
      })
      .catch((reason) => {
        if (active)
          setError(workflowMessage(reason, 'Preferences could not be loaded. Safe defaults are active.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (update: PreferenceSettingsUpdate) => {
    setSaving(true);
    setError('');
    try {
      const next = workflowValue(await getRendererBridge().setPreferenceSettings(update));
      setResult(next);
      return next;
    } catch (reason) {
      setError(
        workflowMessage(reason, 'This preference could not be saved. Your previous setting is active.'),
      );
      throw reason;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    result,
    settings: result?.settings ?? DEFAULT_PREFERENCE_SETTINGS,
    performance,
    loading,
    saving,
    error,
    save,
    saveAppearance: async (appearance) => {
      await save({ appearance });
    },
    saveShortcuts: async (shortcuts) => {
      await save({ shortcuts });
    },
    saveOnboarding: async (onboarding) => {
      await save({ onboarding });
    },
    clearError: () => setError(''),
  };
}
