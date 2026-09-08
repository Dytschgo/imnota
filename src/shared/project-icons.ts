export const PROJECT_ICON_KEYS = [
  'layers',
  'briefcase',
  'code-2',
  'folder',
  'lightbulb',
  'rocket',
  'sparkles',
  'target',
] as const;

export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number];

export function isProjectIconKey(value: unknown): value is ProjectIconKey {
  return typeof value === 'string' && (PROJECT_ICON_KEYS as readonly string[]).includes(value);
}

