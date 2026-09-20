import { FolderOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { EffectiveAppearance } from '../app/useAppearance';
import { Button } from '../components/ui';
import { UpdateControl } from '../components/UpdateControl';
import { WhatsNewSettings, type WhatsNewAction } from '../components/WhatsNew';
import { useAppStore } from '../store';
import { AppearanceSettings } from './AppearanceSettings';
import { OnboardingSettings } from './OnboardingSettings';
import type { PreferenceSettings } from './preferences';
import { DEFAULT_PREFERENCE_SETTINGS } from './preferences';
import { ShortcutSettings } from './ShortcutSettings';
import {
  describeCommonShortcut,
  detectShortcutPlatform,
  formatShortcut,
  resolveShortcutBindings,
} from '../../shared/shortcuts';
import { SharingSettings } from './SharingSettings';
import { saveWorkspaceSettingsPatch } from './sharing-preferences';
import { BackupSettings } from './BackupSettings';
import type { BackupPreferences, BackupRestoreResult } from '../../shared/backups';
import type { ProjectListItem } from '../../shared/types';
import type { UpdateStatus } from '../../shared/types';
import { findWhatsNewRelease, whatsNewReleaseUrl } from '../../shared/whats-new';

export const SETTINGS_CATEGORIES = [
  'Appearance',
  'Shortcuts',
  'Workspace',
  'Sharing',
  'Backups & history',
  'Updates & about',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export interface SettingsViewProps {
  activeCategory?: SettingsCategory;
  onCategoryChange?(category: SettingsCategory): void;
  preferences?: PreferenceSettings;
  effectiveAppearance?: EffectiveAppearance;
  savingPreferences?: boolean;
  preferenceError?: string;
  onAppearanceChange?(value: PreferenceSettings['appearance']): void | Promise<void>;
  onShortcutChange?(value: PreferenceSettings['shortcuts']): void | Promise<void>;
  onWorkbenchChange?(value: PreferenceSettings['workbench']): void | Promise<void>;
  nativeCopyAvailable?: boolean;
  onNativeCopyChange?(value: PreferenceSettings['nativeCopy']): void | Promise<void>;
  projects?: ProjectListItem[];
  onBackupChange?(value: BackupPreferences): void | Promise<void>;
  onBeforeBackupAction?(): boolean | Promise<boolean>;
  onBackupRestored?(result: BackupRestoreResult): void | Promise<void>;
  onBackupRestoreFailed?(): void;
  onCaptureChange?(value: PreferenceSettings['capture']): void | Promise<void>;
  onReplayOnboarding?(): void;
  onDownload?: () => Promise<void>;
  onInstall?: () => Promise<void>;
  updateStatus?: UpdateStatus | null;
  onReplayWhatsNew?(): void;
  onWhatsNewAction?(action: WhatsNewAction): void;
  onWorkspaceChanged?(): void | Promise<void>;
}

export function SettingsView({
  activeCategory,
  onCategoryChange,
  preferences = DEFAULT_PREFERENCE_SETTINGS,
  effectiveAppearance = {
    theme: 'dark',
    accent: 'indigo',
    requestedGlassLevel: 'off',
    glassLevel: 'off',
    glassFallbackReason: 'user-disabled',
  },
  savingPreferences = false,
  preferenceError = '',
  onAppearanceChange,
  onShortcutChange = async () => undefined,
  onWorkbenchChange,
  nativeCopyAvailable = false,
  onNativeCopyChange,
  projects = [],
  onBackupChange = async () => undefined,
  onBeforeBackupAction = () => true,
  onBackupRestored,
  onBackupRestoreFailed,
  onCaptureChange = async () => undefined,
  onReplayOnboarding = () => undefined,
  onDownload,
  onInstall,
  updateStatus,
  onReplayWhatsNew = () => undefined,
  onWhatsNewAction = () => undefined,
  onWorkspaceChanged,
}: SettingsViewProps) {
  const { settings, set } = useAppStore();
  const [legacyError, setLegacyError] = useState('');
  const [uncontrolledCategory, setUncontrolledCategory] = useState<SettingsCategory>('Appearance');
  const group = activeCategory ?? uncontrolledCategory;
  const shortcutPlatform = detectShortcutPlatform();
  const captureShortcut = resolveShortcutBindings(preferences.shortcuts.bindings, shortcutPlatform)[
    'capture.region'
  ];
  const captureShortcutNote = captureShortcut
    ? describeCommonShortcut(captureShortcut, shortcutPlatform)
    : null;
  const selectCategory = (category: SettingsCategory) => {
    if (activeCategory === undefined) setUncontrolledCategory(category);
    onCategoryChange?.(category);
  };
  const saveLegacy = async (patch: Partial<typeof settings>) => {
    setLegacyError('');
    try {
      set({ settings: await saveWorkspaceSettingsPatch(patch) });
    } catch {
      setLegacyError('This preference could not be saved. Your previous setting is still active.');
    }
  };
  return (
    <section className="settings-view" data-testid="settings-view">
      <div className="settings-heading">
        <h1>Settings</h1>
        <p>
          Control the app, workspace, shortcuts, and sharing defaults without moving project files out of your
          local workspace.
        </p>
      </div>
      <nav className="settings-navigation" aria-label="Settings categories">
        {SETTINGS_CATEGORIES.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={group === name ? 'page' : undefined}
            onClick={() => selectCategory(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {(preferenceError || legacyError) && (
        <p className="settings-error" role="alert">
          {preferenceError || legacyError}
        </p>
      )}
      <div className="settings-grid">
        <div hidden={group !== 'Appearance'}>
          <AppearanceSettings
            value={preferences.appearance}
            onChange={
              onAppearanceChange ??
              (async (value) => {
                await saveLegacy({ theme: value.mode });
              })
            }
            effectiveAppearance={effectiveAppearance}
            disabled={savingPreferences}
          />
        </div>
        <div hidden={group !== 'Shortcuts'}>
          <ShortcutSettings
            value={preferences.shortcuts}
            onChange={onShortcutChange}
            disabled={savingPreferences}
          />
          <section className="settings-section" aria-labelledby="capture-settings-title">
            <h2 id="capture-settings-title">Experimental capture</h2>
            <label className="settings-switch">
              <span>
                <strong>Capture a screen region</strong>
                <small>
                  Windows and macOS only while platform validation is in progress. Captures stay local.
                  Windows lets you choose a display when more than one is attached and captures only that
                  display; macOS uses the display under the pointer.
                </small>
                <small data-testid="capture-shortcut-summary">
                  Shortcut: <kbd>{formatShortcut(captureShortcut, shortcutPlatform)}</kbd>
                  {captureShortcut
                    ? ' even when Imnota is in the background. Change it under Screenshots above.'
                    : '. The toolbar camera button and the Add menu still work.'}
                  {captureShortcutNote ? ` ${captureShortcutNote}` : ''}
                </small>
              </span>
              <input
                type="checkbox"
                checked={preferences.capture.experimentalRegionCapture}
                disabled={savingPreferences}
                onChange={(event) =>
                  void onCaptureChange({ experimentalRegionCapture: event.target.checked })
                }
              />
            </label>
          </section>
        </div>
        <div hidden={group !== 'Updates & about'}>
          <UpdateControl onInstall={onInstall} onDownload={onDownload} />
          <WhatsNewSettings
            version={updateStatus?.currentVersion}
            channel={updateStatus?.channel ?? settings.updateChannel}
            releaseUrl={
              findWhatsNewRelease(updateStatus?.currentVersion)
                ? whatsNewReleaseUrl(updateStatus?.currentVersion)
                : undefined
            }
            onReplay={onReplayWhatsNew}
            onAction={onWhatsNewAction}
          />
          <OnboardingSettings
            value={preferences.onboarding}
            onReplay={onReplayOnboarding}
            disabled={savingPreferences}
          />
        </div>
        {group === 'Backups & history' && (
          <BackupSettings
            value={preferences.backups}
            projects={projects}
            disabled={savingPreferences}
            onChange={onBackupChange}
            onBeforeAction={onBeforeBackupAction}
            onRestored={onBackupRestored}
            onRestoreFailed={onBackupRestoreFailed}
          />
        )}
        <div hidden={group !== 'Shortcuts'}>
          <section className="settings-section" aria-labelledby="behaviour-title">
            <h2 id="behaviour-title">Behaviour</h2>
            <label className="field">
              <span className="field-label">Interface scale</span>
              <select
                aria-label="Interface scale"
                value={settings.interfaceScale}
                onChange={(event) => void saveLegacy({ interfaceScale: Number(event.target.value) })}
              >
                <option value="0.9">90%</option>
                <option value="1">100%</option>
                <option value="1.1">110%</option>
                <option value="1.2">120%</option>
              </select>
            </label>
            <label className="settings-switch">
              <span>
                <strong>Open recent project</strong>
                <small>Resume the latest project when Imnota opens.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.openRecentOnLaunch}
                onChange={(event) => void saveLegacy({ openRecentOnLaunch: event.target.checked })}
              />
            </label>
            <label className="settings-switch">
              <span>
                <strong>Confirm before deletion</strong>
                <small>Ask before moving a project to the system trash.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.confirmBeforeDeletion}
                onChange={(event) => void saveLegacy({ confirmBeforeDeletion: event.target.checked })}
              />
            </label>
            <label className="settings-switch">
              <span>
                <strong>Combined Add item button</strong>
                <small>
                  Restore a single Add item menu instead of making Add screenshot the primary rail action.
                </small>
              </span>
              <input
                type="checkbox"
                checked={!preferences.workbench.screenshotFirstAdd}
                disabled={savingPreferences || !onWorkbenchChange}
                onChange={(event) => void onWorkbenchChange?.({ screenshotFirstAdd: !event.target.checked })}
              />
            </label>
          </section>
        </div>
        <div hidden={group !== 'Workspace'}>
          <section className="settings-section" aria-labelledby="workspace-settings-title">
            <h2 id="workspace-settings-title">Workspace</h2>
            <div className="workspace-path">
              <FolderOpen size={17} aria-hidden="true" />
              <span>{settings.workspacePath || 'No workspace selected'}</span>
            </div>
            <div className="settings-actions">
              <Button
                variant="soft"
                onClick={async () => {
                  setLegacyError('');
                  try {
                    const next = await window.imnota.chooseWorkspace();
                    if (next) {
                      set({ settings: next });
                      await onWorkspaceChanged?.();
                    }
                  } catch {
                    setLegacyError(
                      'The workspace folder could not be changed. Your current workspace remains active.',
                    );
                  }
                }}
              >
                <FolderOpen size={15} aria-hidden="true" />
                Change folder
              </Button>
              {settings.workspacePath && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void window.imnota
                      .openPath(settings.workspacePath!)
                      .catch(() => setLegacyError('The workspace folder could not be opened.'))
                  }
                >
                  Open folder
                </Button>
              )}
            </div>
          </section>
          <section className="settings-section" aria-labelledby="privacy-title">
            <h2 id="privacy-title">Privacy</h2>
            <div className="privacy-panel">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>Local-first</strong>
                <p>No account, cloud storage, telemetry, or runtime AI service is required.</p>
              </div>
            </div>
          </section>
        </div>
        {group === 'Sharing' && (
          <>
            {nativeCopyAvailable && (
              <section className="settings-section" aria-labelledby="native-copy-title">
                <h2 id="native-copy-title">Native copy functions</h2>
                <label className="field">
                  <span className="field-label">Primary copy action</span>
                  <select
                    aria-label="Native copy functions"
                    value={preferences.nativeCopy.defaultFunction}
                    disabled={savingPreferences || !onNativeCopyChange}
                    onChange={(event) => {
                      const defaultFunction = event.target
                        .value as PreferenceSettings['nativeCopy']['defaultFunction'];
                      void Promise.resolve()
                        .then(() => onNativeCopyChange?.({ defaultFunction }))
                        .catch(() => undefined);
                    }}
                  >
                    <option value="files">Copy files — Markdown and PNG files</option>
                    <option value="files-rich">Files + rich copy — files, text, and image</option>
                    <option value="rich">Rich copy — text and image</option>
                  </select>
                  <small>
                    Sets the main copy button throughout Imnota. The receiving app still chooses which
                    clipboard formats it accepts.
                  </small>
                </label>
              </section>
            )}
            <SharingSettings />
          </>
        )}
      </div>
    </section>
  );
}
