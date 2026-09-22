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

/** Region capture is available by default on new Windows/macOS profiles; saved values remain per-profile. */
export interface CapturePreferences {
  experimentalRegionCapture: boolean;
}

export function defaultExperimentalRegionCapture(platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin';
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
}

export const LOCAL_AGENT_ACCESS_HOST = '127.0.0.1';
export const LOCAL_AGENT_ACCESS_PORT = 17384;
export const LOCAL_AGENT_ACCESS_PATH = '/mcp';

export function localAgentAccessUrl(port = LOCAL_AGENT_ACCESS_PORT): string {
  return `http://${LOCAL_AGENT_ACCESS_HOST}:${port}${LOCAL_AGENT_ACCESS_PATH}`;
}

export const AGENT_ACCESS_STDIO_COMMAND_PLACEHOLDER = '<path-to-Imnota-executable>';

/** Generic `mcpServers` entry for the loopback HTTP transport; most agents accept this shape. */
export function localAgentAccessHttpSnippet(url = localAgentAccessUrl()): string {
  return `${JSON.stringify({ mcpServers: { imnota: { type: 'http', url } } }, null, 2)}\n`;
}

export function localAgentAccessStdioSnippet(command = AGENT_ACCESS_STDIO_COMMAND_PLACEHOLDER): string {
  return `${JSON.stringify({ mcpServers: { imnota: { command, args: ['--mcp'] } } }, null, 2)}\n`;
}

/**
 * One prompt for any coding agent: it carries everything the agent needs to register the
 * Imnota MCP server in its own configuration, so Imnota never has to name or write editor files.
 */
export function agentAccessSetupPrompt(url = localAgentAccessUrl()): string {
  return [
    'Register the Imnota MCP server in your own MCP configuration and connect to it.',
    '',
    'Server name: imnota',
    `Transport (preferred): Streamable HTTP at ${url}. Loopback only, no authentication, no CORS.`,
    `Transport (alternative, if you cannot use HTTP): stdio. Run the Imnota executable with the argument --mcp (for example "${AGENT_ACCESS_STDIO_COMMAND_PLACEHOLDER}" --mcp).`,
    '',
    'Do the setup yourself using the config file and format this agent normally uses. If your format is a JSON "mcpServers" map, the entries are:',
    `  HTTP:  { "imnota": { "type": "http", "url": "${url}" } }`,
    `  stdio: { "imnota": { "command": "${AGENT_ACCESS_STDIO_COMMAND_PLACEHOLDER}", "args": ["--mcp"] } }`,
    'Tell me which file you changed. Do not ask me to paste configuration.',
    '',
    'Requirements: Imnota must be running with "Allow local agent access" enabled in Settings → Features; otherwise the connection is refused. Nothing is uploaded and no hosted model is called.',
    '',
    'Tools the server exposes (all read-only):',
    '- list_projects: active projects in the selected workspace (path, name, updated time).',
    '- list_collection_items: ordered items of a collection (id, kind, title, includeInExport, priority).',
    '- get_latest_bundle: the latest prepared export as Markdown text plus PNG paths. Returns "bundle not prepared" when Copy Bundle has not been run; it never generates an export.',
    '- get_item: one item as Markdown plus its image path for screenshots and drawings.',
    '- search_saved_text: search saved descriptions, annotation text, Markdown blocks and drawing text.',
    '',
    'When I ask about screenshots, feedback or bundles from Imnota, call these tools instead of guessing from chat images or asking me to paste again.',
    '',
  ].join('\n');
}

export type NativeCopyFunction = 'files' | 'files-rich' | 'rich';

export interface NativeCopyPreferences {
  defaultFunction: NativeCopyFunction;
}

export interface ExportPreset {
  id: string;
  name: string;
  defaultFunction: NativeCopyFunction;
  includeRecognisedText: boolean;
}

/** Application export Markdown options. Not stored on project.json. */
export interface PromptExportPreferences {
  includeRecognisedText: boolean;
}

export interface PreferenceSettings {
  appearance: AppearancePreferences;
  backups: BackupPreferences;
  shortcuts: ShortcutPreferences;
  capture: CapturePreferences;
  onboarding: OnboardingPreferences;
  workbench: WorkbenchPreferences;
  nativeCopy: NativeCopyPreferences;
  promptExport: PromptExportPreferences;
  exportPresets: ExportPreset[];
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
export const DEFAULT_AGENT_ACCESS: AgentAccessPreferences = { enabled: false };
export const DEFAULT_PROMPT_EXPORT_PREFERENCES: PromptExportPreferences = { includeRecognisedText: false };

export const DEFAULT_PREFERENCE_SETTINGS: PreferenceSettings = {
  appearance: DEFAULT_APPEARANCE,
  backups: DEFAULT_BACKUP_PREFERENCES,
  shortcuts: { bindings: {} },
  capture: { experimentalRegionCapture: false },
  onboarding: DEFAULT_ONBOARDING,
  workbench: DEFAULT_WORKBENCH,
  nativeCopy: DEFAULT_NATIVE_COPY_PREFERENCES,
  promptExport: DEFAULT_PROMPT_EXPORT_PREFERENCES,
  exportPresets: [],
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
