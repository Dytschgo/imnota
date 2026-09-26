import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PREFERENCE_SETTINGS,
  type AppearancePreferences,
  type CapturePreferences,
  type OnboardingPreferences,
  type PreferenceSettings,
  type PreferenceSettingsResult,
  type ShortcutPreferences,
  type AgentAccessPreferences,
} from '../../shared/preferences';
import type { BackupPreferences } from '../../shared/backups';
import type {
  NativeCapabilities,
  NativePerformanceProfile,
  PreferenceSettingsUpdate,
} from '../../shared/workflow-bridge';
import { getRendererBridge, workflowMessage, workflowValue } from './workflow';

const UNKNOWN_PERFORMANCE: NativePerformanceProfile = {
  platform: 'unknown',
  performanceClass: 'standard',
  reducedEffectsRecommended: false,
  reasons: [],
};
const UNKNOWN_CAPABILITIES: NativeCapabilities = {
  windowsFileClipboard: false,
  globalCaptureShortcutRegistered: false,
};

export interface PreferenceController {
  result: PreferenceSettingsResult | null;
  settings: PreferenceSettings;
  performance: NativePerformanceProfile;
  capabilities: NativeCapabilities;
  loading: boolean;
  saving: boolean;
  error: string;
  save(update: PreferenceSettingsUpdate): Promise<PreferenceSettingsResult>;
  saveAppearance(value: AppearancePreferences): Promise<void>;
  saveShortcuts(value: ShortcutPreferences): Promise<void>;
  saveBackups(value: BackupPreferences): Promise<void>;
  saveCapture(value: CapturePreferences): Promise<void>;
  saveOnboarding(value: OnboardingPreferences): Promise<void>;
  saveNativeCopy(value: PreferenceSettings['nativeCopy']): Promise<void>;
  savePromptExport(value: PreferenceSettings['promptExport']): Promise<void>;
  saveUpdates(value: PreferenceSettings['updates']): Promise<void>;
  saveAgentAccess(value: AgentAccessPreferences): Promise<void>;
  clearError(): void;
}

export function usePreferences(): PreferenceController {
  const [result, setResult] = useState<PreferenceSettingsResult | null>(null);
  const [performance, setPerformance] = useState(UNKNOWN_PERFORMANCE);
  const [capabilities, setCapabilities] = useState(UNKNOWN_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const bridge = getRendererBridge();
    void Promise.all([
      Promise.resolve().then(() => bridge.getPreferenceSettings()),
      Promise.resolve().then(() => bridge.getNativePerformanceProfile()),
      Promise.resolve()
        .then(() => bridge.getNativeCapabilities())
        .then(workflowValue)
        .catch(() => UNKNOWN_CAPABILITIES),
    ])
      .then(([settingsResult, performanceResult, capabilitiesResult]) => {
        if (!active) return;
        setResult(workflowValue(settingsResult));
        setPerformance(workflowValue(performanceResult));
        setCapabilities(capabilitiesResult);
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
      const bridge = getRendererBridge();
      const next = workflowValue(await bridge.setPreferenceSettings(update));
      setResult(next);
      try {
        setCapabilities(workflowValue(await bridge.getNativeCapabilities()));
      } catch {
        /* Keep the last known host capabilities if the follow-up read fails. */
      }
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
    capabilities,
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
    saveBackups: async (backups) => {
      await save({ backups });
    },
    saveCapture: async (capture) => {
      await save({ capture });
    },
    saveOnboarding: async (onboarding) => {
      await save({ onboarding });
    },
    saveNativeCopy: async (nativeCopy) => {
      await save({ nativeCopy });
    },
    savePromptExport: async (promptExport) => {
      await save({ promptExport });
    },
    saveUpdates: async (updates) => {
      await save({ updates });
    },
    saveAgentAccess: async (agentAccess) => {
      await save({ agentAccess });
    },
    clearError: () => setError(''),
  };
}
