import { isCommittedWriteWarning } from '../../shared/write-outcome';
import { refreshCommittedSettings } from './sharing-preferences';
import {
  ArrowLeft,
  FolderOpen,
  Grid2X2,
  History,
  Info,
  Keyboard,
  Monitor,
  Sparkles,
  Users,
} from 'lucide-react';
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
import { AgentAccessSettings } from './AgentAccessSettings';
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
  'Features',
  'Workspace',
  'Sharing',
  'Backups & history',
  'Updates & about',
  'What’s new',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

const CATEGORY_ICONS = {
  Appearance: Monitor,
  Shortcuts: Keyboard,
  Features: Grid2X2,
  Workspace: FolderOpen,
  Sharing: Users,
  'Backups & history': History,
  'Updates & about': Info,
  'What’s new': Sparkles,
} as const;

export interface SettingsViewProps {
  activeCategory?: SettingsCategory;
  onCategoryChange?(category: SettingsCategory): void;
  onExitSettings?(): void;
  preferences?: PreferenceSettings;
  effectiveAppearance?: EffectiveAppearance;
  savingPreferences?: boolean;
  preferenceError?: string;
  onAppearanceChange?(value: PreferenceSettings['appearance']): void | Promise<void>;
  onShortcutChange?(value: PreferenceSettings['shortcuts']): void | Promise<void>;
  globalCaptureShortcutRegistered?: boolean;
  onPromptExportChange?(value: PreferenceSettings['promptExport']): void | Promise<void>;
  onCaptureChange?(value: PreferenceSettings['capture']): void | Promise<void>;
  projects?: ProjectListItem[];
  onBackupChange?(value: BackupPreferences): void | Promise<void>;
  onBeforeBackupAction?(): boolean | Promise<boolean>;
  onBackupRestored?(result: BackupRestoreResult): void | Promise<void>;
  onBackupRestoreFailed?(): void;
  onAgentAccessChange?(value: PreferenceSettings['agentAccess']): void | Promise<void>;
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
  onExitSettings = () => undefined,
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
  globalCaptureShortcutRegistered = false,
  onPromptExportChange,
  onCaptureChange,
  projects = [],
  onBackupChange = async () => undefined,
  onBeforeBackupAction = () => true,
  onBackupRestored,
  onBackupRestoreFailed,
  onAgentAccessChange = async () => undefined,
  onReplayOnboarding = () => undefined,
  onDownload,
  onInstall,
  updateStatus,
  onReplayWhatsNew = () => undefined,
  onWhatsNewAction = () => undefined,
  onWorkspaceChanged,
}: SettingsViewProps) {
  const { settings, set } = useAppStore();
  const [workspaceSettingError, setWorkspaceSettingError] = useState('');
  const [uncontrolledCategory, setUncontrolledCategory] = useState<SettingsCategory>('Appearance');
  const group = activeCategory ?? uncontrolledCategory;
  const shortcutPlatform = detectShortcutPlatform();
  const shortcutBindings = resolveShortcutBindings(preferences.shortcuts.bindings, shortcutPlatform);
  const captureShortcut = shortcutBindings['capture.region'];
  const repeatLastShortcut = shortcutBindings['capture.repeatLastRegion'];
  const captureShortcutNote = captureShortcut
    ? describeCommonShortcut(captureShortcut, shortcutPlatform)
    : null;
  const PageIcon = CATEGORY_ICONS[group];
  const selectCategory = (category: SettingsCategory) => {
    if (activeCategory === undefined) setUncontrolledCategory(category);
    onCategoryChange?.(category);
  };
  const saveWorkspaceSetting = async (patch: Partial<typeof settings>) => {
    setWorkspaceSettingError('');
    try {
      set({ settings: await saveWorkspaceSettingsPatch(patch) });
    } catch (reason) {
      setWorkspaceSettingError(
        isCommittedWriteWarning(reason)
          ? (reason as Error).message
          : 'This preference could not be saved. Your previous setting is still active.',
      );
    }
  };
  return (
    <section className="settings-view" data-testid="settings-view" data-settings-category={group}>
      <nav className="settings-navigation" aria-label="Settings categories">
        <div className="settings-navigation-title">
          <h1>Settings</h1>
          <button
            type="button"
            className="settings-exit"
            aria-label="Back to workspace"
            title="Back to workspace"
            onClick={onExitSettings}
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
        </div>
        {SETTINGS_CATEGORIES.map((name) => {
          const Icon = CATEGORY_ICONS[name];
          return (
            <button
              key={name}
              type="button"
              aria-current={group === name ? 'page' : undefined}
              onClick={() => selectCategory(name)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{name}</span>
            </button>
          );
        })}
      </nav>
      <header className="settings-page-heading">
        <div>
          <div className="settings-page-title">
            <h2>{group}</h2>
            <PageIcon size={17} aria-hidden="true" />
          </div>
          {group === 'Features' && <p>Enable or disable features for this device.</p>}
          {group === 'Appearance' && (
            <p>Choose how Imnota looks on this device. Exports keep their neutral white background.</p>
          )}
          {group === 'Workspace' && (
            <p>Control where Imnota keeps its local files and view local diagnostics.</p>
          )}
          {group === 'Sharing' && (
            <p>
              Manage your display name and shared links. Shared links are created only when you choose to
              share.
            </p>
          )}
          {group === 'Backups & history' && (
            // The Local history card below explains what a snapshot contains; this line says why to be here.
            <p>Snapshot projects on this device and restore an earlier version when you need it.</p>
          )}
          {group === 'Updates & about' && <p>Keep Imnota up to date and find helpful resources.</p>}
          {group === 'What’s new' && <p>Explore the highlights bundled with your installed build.</p>}
          {group === 'Shortcuts' && <p>Change keyboard actions while keeping mouse controls available.</p>}
        </div>
      </header>
      {(preferenceError || workspaceSettingError) && (
        <p className="settings-error" role="alert">
          {preferenceError || workspaceSettingError}
        </p>
      )}
      <div className="settings-grid">
        <div hidden={group !== 'Appearance'}>
          <AppearanceSettings
            value={preferences.appearance}
            onChange={onAppearanceChange ?? (async () => undefined)}
            effectiveAppearance={effectiveAppearance}
            disabled={savingPreferences}
            showHeading={false}
          />
        </div>
        <div hidden={group !== 'Shortcuts'}>
          <ShortcutSettings
            value={preferences.shortcuts}
            onChange={onShortcutChange}
            disabled={savingPreferences}
          />
        </div>
        <div hidden={group !== 'Updates & about'}>
          <UpdateControl onInstall={onInstall} onDownload={onDownload} />
          <OnboardingSettings
            value={preferences.onboarding}
            onReplay={onReplayOnboarding}
            disabled={savingPreferences}
          />
        </div>
        <div hidden={group !== 'What’s new'}>
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
                onChange={(event) =>
                  void saveWorkspaceSetting({ interfaceScale: Number(event.target.value) })
                }
              >
                <option value="0.9">90%</option>
                <option value="1">100%</option>
                <option value="1.1">110%</option>
                <option value="1.2">120%</option>
              </select>
            </label>
            <label className="settings-switch">
              <span>
                <strong>Confirm before deletion</strong>
                <small>Ask before moving a project to the system trash.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.confirmBeforeDeletion}
                onChange={(event) =>
                  void saveWorkspaceSetting({ confirmBeforeDeletion: event.target.checked })
                }
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
                  setWorkspaceSettingError('');
                  try {
                    const next = await window.imnota.chooseWorkspace();
                    if (next) {
                      set({ settings: next });
                      await onWorkspaceChanged?.();
                    }
                  } catch (reason) {
                    if (isCommittedWriteWarning(reason)) {
                      await refreshCommittedSettings();
                      try {
                        await onWorkspaceChanged?.();
                      } catch {
                        /* Preserve the original warning. */
                      }
                    }
                    setWorkspaceSettingError(
                      isCommittedWriteWarning(reason)
                        ? (reason as Error).message
                        : 'The workspace folder could not be changed. Your current workspace remains active.',
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
                      .catch(() => setWorkspaceSettingError('The workspace folder could not be opened.'))
                  }
                >
                  Open folder
                </Button>
              )}
            </div>
          </section>
          <section className="settings-section" aria-labelledby="diagnostics-title">
            <h2 id="diagnostics-title">Local diagnostics</h2>
            <p>
              Imnota keeps bounded local traces of saves, deletion requests, recovery, and missing files. They
              contain operation references and error codes, not screenshot contents, text, or file paths.
              Nothing is uploaded automatically.
            </p>
            <Button
              variant="soft"
              onClick={async () => {
                setWorkspaceSettingError('');
                try {
                  await window.imnota.openDiagnosticsFolder();
                } catch {
                  setWorkspaceSettingError(
                    'Local diagnostics are unavailable. Check free disk space and access to the application data folder.',
                  );
                }
              }}
            >
              Open diagnostics folder
            </Button>
          </section>
        </div>
        <div hidden={group !== 'Features'}>
          <section className="settings-section" aria-labelledby="capture-title">
            <h2 id="capture-title">Screen capture</h2>
            <label className="settings-field">
              <span>Quick capture cards</span>
              <select
                aria-label="Quick capture cards"
                value={preferences.capture.quickAccessCorner ?? 'off'}
                disabled={savingPreferences || !onCaptureChange || shortcutPlatform === 'linux'}
                onChange={(event) =>
                  void onCaptureChange?.({
                    ...preferences.capture,
                    quickAccessCorner: event.target.value as 'off' | 'left' | 'right',
                  })
                }
              >
                <option value="off">Off — add captures immediately</option>
                <option value="left">Bottom left</option>
                <option value="right">Bottom right</option>
              </select>
            </label>
            <p>
              Keep up to three captures for copying, annotation or adding later. Hiding the cards keeps them
              in memory until you Add, Discard or quit.
            </p>
            <Button onClick={() => void window.imnota.showQuickCaptures()}>Show pending captures</Button>
            <p>
              Captures stay on this device. Area selection spans all connected displays on Windows and macOS;
              on Linux, use Import or Paste.
            </p>
            <small data-testid="capture-shortcut-summary" className="feature-detail">
              {captureShortcut ? (
                <>
                  Shortcut: <kbd>{formatShortcut(captureShortcut, shortcutPlatform)}</kbd> captures a screen
                  area{' '}
                  {globalCaptureShortcutRegistered
                    ? 'even when Imnota is in the background'
                    : 'while Imnota is focused. The background shortcut is not active'}
                  {repeatLastShortcut ? (
                    <>
                      ; <kbd>{formatShortcut(repeatLastShortcut, shortcutPlatform)}</kbd> recaptures the last
                      area from this session
                    </>
                  ) : null}
                  . Change these under Shortcuts.
                </>
              ) : (
                <>Shortcut: not set. Take screenshot in the Add menu still works.</>
              )}
              {captureShortcutNote ? ` ${captureShortcutNote}` : ''}
            </small>
          </section>
          <section className="settings-section" aria-labelledby="prompt-markdown-title">
            <h2 id="prompt-markdown-title">
              Prompt Markdown <span className="feature-status beta">Beta</span>
            </h2>
            <label className="settings-switch">
              <span>
                <strong>Include recognised text in Markdown</strong>
                <small>
                  Copy Bundle can append on-device OCR under Visible text. Screenshots with blur or pixelate
                  marks omit this section. Recognition never leaves this device. Off by default.
                </small>
              </span>
              <input
                type="checkbox"
                aria-label="Include recognised text in Markdown"
                checked={preferences.promptExport.includeRecognisedText}
                disabled={savingPreferences || !onPromptExportChange}
                onChange={(event) => {
                  const includeRecognisedText = event.target.checked;
                  void Promise.resolve()
                    .then(() =>
                      onPromptExportChange?.({ ...preferences.promptExport, includeRecognisedText }),
                    )
                    .catch(() => undefined);
                }}
              />
            </label>
            <label className="settings-switch">
              <span>
                <strong>Record source info</strong>
                <small>
                  Saves the app, window title and time with each new capture or import, and writes them under
                  the picture in Copy Bundle Markdown. Window titles can contain private details; edit or
                  remove them per screenshot in the inspector. Stored only in your project; Imnota sends it
                  nowhere. A browser URL is never read automatically; type one in the inspector if you want it
                  exported. Off by default.
                </small>
              </span>
              <input
                type="checkbox"
                aria-label="Record source info"
                checked={preferences.promptExport.includeSourceContext}
                disabled={savingPreferences || !onPromptExportChange}
                onChange={(event) => {
                  const includeSourceContext = event.target.checked;
                  void Promise.resolve()
                    .then(() => onPromptExportChange?.({ ...preferences.promptExport, includeSourceContext }))
                    .catch(() => undefined);
                }}
              />
            </label>
          </section>
          <AgentAccessSettings
            value={preferences.agentAccess}
            disabled={savingPreferences}
            onChange={onAgentAccessChange}
          />
        </div>
        {group === 'Sharing' && <SharingSettings />}
      </div>
    </section>
  );
}
