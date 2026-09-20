import type { ShortcutBindings } from './shortcuts.js';
import { DEFAULT_BACKUP_PREFERENCES, type BackupPreferences } from './backups.js';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AccentPreset = 'graphite' | 'indigo' | 'emerald' | 'amber';
export type GlassLevel = 'off' | 'subtle' | 'balanced' | 'strong';

export const CHARACTER_BACKDROP_PRESETS = ['graphite', 'indigo', 'emerald', 'amber'] as const;
export const GENERIC_BACKDROP_PRESETS = ['mist-light', 'sand-light', 'slate-dark', 'dusk-dark'] as const;
export const BACKDROP_PRESETS = [...CHARACTER_BACKDROP_PRESETS, ...GENERIC_BACKDROP_PRESETS] as const;
export type BackdropPreset = (typeof BACKDROP_PRESETS)[number];
export const BACKGROUND_IMAGE_MAX_BYTES = 5_500_000;
// Base64 expands binary data by roughly a third. The additional allowance covers the data URL header.
export const BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH = Math.ceil(BACKGROUND_IMAGE_MAX_BYTES / 3) * 4 + 128;
export const BACKGROUND_IMAGE_MAX_DIMENSION = 3_840;
export const BACKGROUND_IMAGE_MAX_PIXELS = 12_000_000;

export function backdropPresetValue(preset: BackdropPreset): `preset:${BackdropPreset}` {
  return `preset:${preset}`;
}

export function isBackdropPreset(value: string): value is `preset:${BackdropPreset}` {
  return BACKDROP_PRESETS.some((preset) => value === backdropPresetValue(preset));
}

export function isAllowedBackgroundImage(value: string): boolean {
  return (
    value === '' ||
    isBackdropPreset(value) ||
    (value.length <= BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH &&
      /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value))
  );
}

export interface AppearancePreferences {
  mode: AppearanceMode;
  accent: AccentPreset;
  glassLevel: GlassLevel;
  allowPerformanceFallback: boolean;
  backgroundImage: string;
  backgroundOpacity: number;
  /**
   * A legacy shared backdrop remains the source of truth while this is true.
   * Theme-specific values let a dark image and a light image coexist without
   * changing existing saved preferences.
   */
  useSameBackdropForBoth: boolean;
  /** Marks that empty theme fields are intentional, rather than absent legacy data. */
  themeBackdropsInitialized: boolean;
  lightBackgroundImage: string;
  darkBackgroundImage: string;
  lightBackgroundOpacity: number;
  darkBackgroundOpacity: number;
  desktopGlass?: boolean;
}

export interface ShortcutPreferences {
  bindings: ShortcutBindings;
}

/** Kept opt-in until native Windows and macOS capture verification is complete. */
export interface CapturePreferences {
  experimentalRegionCapture: boolean;
}

export interface OnboardingPreferences {
  completed: boolean;
  completedVersion: number;
}

/** Screenshot-first add is the default. Combined Add item restores the previous single menu. */
export interface WorkbenchPreferences {
  screenshotFirstAdd: boolean;
}

/** Application-level acknowledgement; never stored with a project. */
export interface UpdatePreferences {
  whatsNewAcknowledgedVersion?: string;
}

/** Opt-in local MCP access for coding agents. Default off; never a public listener. */
export interface AgentAccessPreferences {
  enabled: boolean;
  /** When true, prompt Markdown tells any agent to use the Imnota skill. Default on. */
  includeSkillInstruction: boolean;
}

export const IMNOTA_SKILL_LIBRARY_URL = 'https://github.com/Dytschgo/dytschgo-skills';
export const IMNOTA_SKILL_INSTALL_COMMAND =
  'npx skills add https://github.com/Dytschgo/dytschgo-skills --skill imnota';

/** Short block copied into prompt bundles so any agent can load the Imnota skill. */
export function imnotaSkillInstructionMarkdown(): string {
  return [
    '## How to use this brief',
    '',
    'This is an Imnota prompt bundle: annotated screenshots, notes, and drawings for an AI coding agent.',
    'Load the **Imnota** skill (`imnota`) if it is not already installed. It works in Claude Code, Cursor, Codex, Grok, and other skill-capable agents.',
    '',
    '```bash',
    IMNOTA_SKILL_INSTALL_COMMAND,
    '```',
    '',
    'If Imnota MCP tools are available, call `get_latest_bundle` instead of re-interpreting attached images.',
    'If MCP is not available, use this Markdown and the matching PNG files. Picture numbers, Notes, and Marks name the exact elements to change.',
    '',
  ].join('\n');
}

export const LOCAL_AGENT_ACCESS_HOST = '127.0.0.1';
export const LOCAL_AGENT_ACCESS_PORT = 17384;
export const LOCAL_AGENT_ACCESS_PATH = '/mcp';

export function localAgentAccessUrl(port = LOCAL_AGENT_ACCESS_PORT): string {
  return `http://${LOCAL_AGENT_ACCESS_HOST}:${port}${LOCAL_AGENT_ACCESS_PATH}`;
}

export function claudeCodeAgentAccessSnippet(url = localAgentAccessUrl()): string {
  return `${JSON.stringify({ mcpServers: { imnota: { type: 'http', url } } }, null, 2)}\n`;
}

export function cursorAgentAccessSnippet(url = localAgentAccessUrl()): string {
  return `${JSON.stringify({ mcpServers: { imnota: { url } } }, null, 2)}\n`;
}

export function localAgentAccessStdioSnippet(command = '<path-to-Imnota-executable>'): string {
  return `${JSON.stringify({ mcpServers: { imnota: { command, args: ['--mcp'] } } }, null, 2)}\n`;
}

export type NativeCopyFunction = 'files' | 'files-rich' | 'rich';

export interface NativeCopyPreferences {
  defaultFunction: NativeCopyFunction;
}

export interface PreferenceSettings {
  appearance: AppearancePreferences;
  backups: BackupPreferences;
  shortcuts: ShortcutPreferences;
  capture: CapturePreferences;
  onboarding: OnboardingPreferences;
  workbench: WorkbenchPreferences;
  nativeCopy: NativeCopyPreferences;
  updates: UpdatePreferences;
  agentAccess: AgentAccessPreferences;
}

export interface SettingsProfileProvenance {
  settingsFileExists: boolean;
  migratedFromLegacyProfile: boolean;
  initializedAsNewProfile?: boolean;
}

export interface PreferenceSettingsResult {
  settings: PreferenceSettings;
  profile: SettingsProfileProvenance;
}

export const ONBOARDING_VERSION = 1;

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  mode: 'system',
  accent: 'indigo',
  glassLevel: 'off',
  allowPerformanceFallback: true,
  backgroundImage: '',
  backgroundOpacity: 0.42,
  useSameBackdropForBoth: true,
  themeBackdropsInitialized: false,
  lightBackgroundImage: '',
  darkBackgroundImage: '',
  lightBackgroundOpacity: 0.42,
  darkBackgroundOpacity: 0.42,
};

export type ResolvedBackdropTheme = Exclude<AppearanceMode, 'system'>;

/** Resolve a backdrop without mutating the shared legacy preference. */
export function appearanceBackdrop(
  appearance: AppearancePreferences,
  theme: ResolvedBackdropTheme,
): { image: string; opacity: number } {
  if (appearance.useSameBackdropForBoth)
    return { image: appearance.backgroundImage, opacity: appearance.backgroundOpacity };
  return theme === 'dark'
    ? { image: appearance.darkBackgroundImage, opacity: appearance.darkBackgroundOpacity }
    : { image: appearance.lightBackgroundImage, opacity: appearance.lightBackgroundOpacity };
}

export const DEFAULT_ONBOARDING: OnboardingPreferences = {
  completed: false,
  completedVersion: 0,
};

export const DEFAULT_WORKBENCH: WorkbenchPreferences = {
  screenshotFirstAdd: true,
};

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {};
export const DEFAULT_NATIVE_COPY_PREFERENCES: NativeCopyPreferences = { defaultFunction: 'files' };
export const DEFAULT_AGENT_ACCESS: AgentAccessPreferences = {
  enabled: false,
  includeSkillInstruction: true,
};

export const DEFAULT_PREFERENCE_SETTINGS: PreferenceSettings = {
  appearance: DEFAULT_APPEARANCE,
  backups: DEFAULT_BACKUP_PREFERENCES,
  shortcuts: { bindings: {} },
  capture: { experimentalRegionCapture: false },
  onboarding: DEFAULT_ONBOARDING,
  workbench: DEFAULT_WORKBENCH,
  nativeCopy: DEFAULT_NATIVE_COPY_PREFERENCES,
  updates: DEFAULT_UPDATE_PREFERENCES,
  agentAccess: DEFAULT_AGENT_ACCESS,
};

export function shouldShowOnboarding(
  onboarding: OnboardingPreferences,
  profile: SettingsProfileProvenance,
  currentVersion = ONBOARDING_VERSION,
): boolean {
  if (onboarding.completed || onboarding.completedVersion >= currentVersion) return false;
  return (
    profile.initializedAsNewProfile === true ||
    (!profile.settingsFileExists && !profile.migratedFromLegacyProfile)
  );
}

export function completedOnboarding(version = ONBOARDING_VERSION): OnboardingPreferences {
  return { completed: true, completedVersion: version };
}
