import { ArrowLeft, Copy, FolderOpen, Grid2X2, History, Info, Keyboard, Monitor, Users } from 'lucide-react';
import { useState } from 'react';
import type { EffectiveAppearance } from '../app/useAppearance';
import { Button } from '../components/ui';
import { UpdateControl } from '../components/UpdateControl';
import { WhatsNewSettings, type WhatsNewAction } from '../components/WhatsNew';
import { useAppStore } from '../store';
import { AppearanceSettings } from './AppearanceSettings';
import { OnboardingSettings } from './OnboardingSettings';
import type { PreferenceSettings } from './preferences';
import {
  agentAccessSetupPrompt,
  DEFAULT_PREFERENCE_SETTINGS,
  localAgentAccessHttpSnippet,
  localAgentAccessStdioSnippet,
  localAgentAccessUrl,
} from './preferences';
import { ShortcutSettings } from './ShortcutSettings';
import {
  describeCommonShortcut,
  detectShortcutPlatform,
  formatShortcut,
  resolveShortcutBindings,
} from '../../shared/shortcuts';
import { SharingSettings } from './SharingSettings';
import { ExportPresetSettings } from './ExportPresetSettings';
import type { PreferenceSettingsUpdate } from '../../shared/workflow-bridge';
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
  onWorkbenchChange?(value: PreferenceSettings['workbench']): void | Promise<void>;
  nativeCopyAvailable?: boolean;
  globalCaptureShortcutRegistered?: boolean;
  onNativeCopyChange?(value: PreferenceSettings['nativeCopy']): void | Promise<void>;
  onPromptExportChange?(value: PreferenceSettings['promptExport']): void | Promise<void>;
  onExportPresetChange?(value: PreferenceSettingsUpdate): Promise<void>;
  projects?: ProjectListItem[];
  onBackupChange?(value: BackupPreferences): void | Promise<void>;
  onBeforeBackupAction?(): boolean | Promise<boolean>;
  onBackupRestored?(result: BackupRestoreResult): void | Promise<void>;
  onBackupRestoreFailed?(): void;
  onCaptureChange?(value: PreferenceSettings['capture']): void | Promise<void>;
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
  onWorkbenchChange,
  nativeCopyAvailable = false,
  globalCaptureShortcutRegistered = false,
  onNativeCopyChange,
  onPromptExportChange,
  onExportPresetChange,
  projects = [],
  onBackupChange = async () => undefined,
  onBeforeBackupAction = () => true,
  onBackupRestored,
  onBackupRestoreFailed,
  onCaptureChange = async () => undefined,
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
  const [legacyError, setLegacyError] = useState('');
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
  const saveLegacy = async (patch: Partial<typeof settings>) => {
    setLegacyError('');
    try {
      set({ settings: await saveWorkspaceSettingsPatch(patch) });
    } catch {
      setLegacyError('This preference could not be saved. Your previous setting is still active.');
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
              Manage export presets, your display name, and shared links. Shared links are created only when
              you choose to share.
            </p>
          )}
          {group === 'Backups & history' && (
            <p>
              Keep validated project snapshots on this device. Exports and recovery caches are not duplicated.
            </p>
          )}
          {group === 'Updates & about' && (
            <p>Keep Imnota up to date, learn what’s new, and find helpful resources.</p>
          )}
          {group === 'Shortcuts' && <p>Change keyboard actions while keeping mouse controls available.</p>}
        </div>
      </header>
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
                setLegacyError('');
                try {
                  await window.imnota.openDiagnosticsFolder();
                } catch {
                  setLegacyError(
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
          <section className="settings-section" aria-labelledby="features-title">
            <h2 id="features-title">Features</h2>
            <p>Enable or disable features for this device. Beta features start off.</p>
            <label className="settings-switch">
              <span>
                <strong>
                  Screen capture <span className="feature-status stable">Stable</span>
                </strong>
                <small>
                  On by default for new Windows and macOS profiles. Existing profiles keep their saved value.
                  Linux stays Import or Paste. Captures stay local. Windows lets you choose a display when
                  more than one is attached; macOS uses the display under the pointer.
                </small>
              </span>
              <input
                type="checkbox"
                aria-label="Enable screen capture"
                checked={preferences.capture.experimentalRegionCapture}
                disabled={savingPreferences}
                onChange={(event) =>
                  void onCaptureChange({ experimentalRegionCapture: event.target.checked })
                }
              />
            </label>
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
                <>Shortcut: not set. The toolbar camera button and the Add menu still work.</>
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
                    .then(() => onPromptExportChange?.({ includeRecognisedText }))
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
            <ExportPresetSettings
              nativeCopyAvailable={nativeCopyAvailable}
              preferences={preferences}
              disabled={savingPreferences}
              onSave={onExportPresetChange}
            />
            <SharingSettings />
          </>
        )}
      </div>
    </section>
  );
}

function AgentAccessSettings({
  value,
  disabled,
  onChange,
}: {
  value: PreferenceSettings['agentAccess'];
  disabled: boolean;
  onChange(value: PreferenceSettings['agentAccess']): void | Promise<void>;
}) {
  const [copied, setCopied] = useState('');
  const copySnippet = async (label: string, snippet: string) => {
    try {
      await window.imnota.copyText(snippet);
      setCopied(label);
    } catch {
      setCopied('');
    }
  };
  return (
    <section className="settings-section" aria-labelledby="agent-access-title">
      <h2 id="agent-access-title">
        MCP access <span className="feature-status beta">Beta</span>
      </h2>
      <label className="settings-switch">
        <span>
          <strong>Allow local agent access</strong>
          <small>
            Lets a coding agent read prepared prompt bundles from this workspace over MCP. Off by default. The
            listener binds only to {localAgentAccessUrl()} or a spawned <kbd>--mcp</kbd> stdio process. Imnota
            does not write any editor or agent configuration.
          </small>
        </span>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          data-testid="agent-access-toggle"
          onChange={(event) => void onChange({ enabled: event.target.checked })}
        />
      </label>
      <div className="settings-snippet">
        <div className="settings-snippet-heading">
          <strong>Setup prompt for any agent</strong>
          <Button variant="ghost" onClick={() => void copySnippet('prompt', agentAccessSetupPrompt())}>
            <Copy size={14} aria-hidden="true" />
            {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
        <p className="settings-snippet-note">
          Paste this into whichever agent you use. It contains the transport, the tool list, and the
          instruction to write its own MCP configuration.
        </p>
        <pre data-testid="agent-access-prompt">{agentAccessSetupPrompt()}</pre>
      </div>
      <details className="settings-disclosure">
        <summary>Configuration reference</summary>
        <p className="settings-snippet-note">
          Generic <code>mcpServers</code> entries, if you prefer to edit the configuration yourself.
        </p>
        <div className="settings-snippet">
          <div className="settings-snippet-heading">
            <strong>HTTP</strong>
            <Button variant="ghost" onClick={() => void copySnippet('http', localAgentAccessHttpSnippet())}>
              <Copy size={14} aria-hidden="true" />
              {copied === 'http' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre>{localAgentAccessHttpSnippet()}</pre>
        </div>
        <div className="settings-snippet">
          <div className="settings-snippet-heading">
            <strong>Stdio</strong>
            <Button variant="ghost" onClick={() => void copySnippet('stdio', localAgentAccessStdioSnippet())}>
              <Copy size={14} aria-hidden="true" />
              {copied === 'stdio' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre>{localAgentAccessStdioSnippet()}</pre>
        </div>
        <p className="settings-snippet-note">
          Optional skill and rule files are in the documentation. Imnota never writes agent configuration for
          you.
        </p>
      </details>
    </section>
  );
}
