import { z } from 'zod';
import { sharingSenderNameSchema } from './schema.js';
import type { WorkspaceSettings } from './types.js';

export const DEFAULT_WORKSPACE_SETTINGS: Readonly<WorkspaceSettings> = {
  workspacePath: null,
  interfaceScale: 1,
  openRecentOnLaunch: true,
  confirmBeforeDeletion: true,
  updateChannel: 'stable',
  sharingSenderName: '',
};

/** Top-level `settings.json` keys owned by the preference envelope, not by application settings. */
const ENVELOPE_KEYS = new Set(['preferences', 'preferenceProfile', 'theme']);

export interface WorkspaceSettingsResult {
  settings: WorkspaceSettings;
  /**
   * Top-level keys this build does not define, written by a newer or older build.
   * They are never interpreted here and are written back unchanged.
   */
  retained: Record<string, unknown>;
}

/**
 * Validate persisted application settings one field at a time. An invalid or missing value
 * falls back to its default without discarding the valid ones, and this never throws:
 * `workspacePath` is the root of every project path authorisation, so it must be an
 * absolute path string or `null`, never whatever the file happened to contain.
 */
export function resolveWorkspaceSettings(
  persisted: unknown,
  options: { isAbsolutePath(value: string): boolean },
): WorkspaceSettingsResult {
  const source: Record<string, unknown> =
    persisted && typeof persisted === 'object' && !Array.isArray(persisted)
      ? (persisted as Record<string, unknown>)
      : {};
  const field = <Key extends keyof WorkspaceSettings>(
    key: Key,
    schema: z.ZodType<WorkspaceSettings[Key]>,
  ): WorkspaceSettings[Key] => {
    if (!Object.hasOwn(source, key)) return DEFAULT_WORKSPACE_SETTINGS[key];
    const parsed = schema.safeParse(source[key]);
    return parsed.success ? parsed.data : DEFAULT_WORKSPACE_SETTINGS[key];
  };
  // Every field is listed, so each key this build owns is an own property of `settings`.
  const settings: Required<WorkspaceSettings> = {
    workspacePath: field(
      'workspacePath',
      z
        .string()
        .min(1)
        .max(32_767)
        .refine((value) => !value.includes('\0') && options.isAbsolutePath(value))
        .nullable(),
    ),
    interfaceScale: field('interfaceScale', z.number().min(0.75).max(2)),
    openRecentOnLaunch: field('openRecentOnLaunch', z.boolean()),
    confirmBeforeDeletion: field('confirmBeforeDeletion', z.boolean()),
    updateChannel: field('updateChannel', z.enum(['stable', 'nightly'])),
    sharingSenderName: field('sharingSenderName', sharingSenderNameSchema) ?? '',
  };
  return {
    settings,
    // `Object.fromEntries` defines own properties, so a stored `__proto__` key stays data.
    retained: Object.fromEntries(
      Object.entries(source).filter(([key]) => !Object.hasOwn(settings, key) && !ENVELOPE_KEYS.has(key)),
    ),
  };
}
