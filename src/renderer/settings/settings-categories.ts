// Kept outside SettingsView so the app shell can name categories without loading Settings.
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
