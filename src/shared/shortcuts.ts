export type ShortcutPlatform = 'mac' | 'windows' | 'linux';

export const SHORTCUT_ACTIONS = [
  { id: 'project.new', group: 'Projects', label: 'New project' },
  { id: 'project.open', group: 'Projects', label: 'Open project' },
  { id: 'project.search', group: 'Projects', label: 'Search projects' },
  { id: 'navigation.projects', group: 'Navigation', label: 'Show projects' },
  { id: 'navigation.recent', group: 'Navigation', label: 'Show recent collections' },
  { id: 'navigation.favourites', group: 'Navigation', label: 'Show favourite projects' },
  { id: 'edit.save', group: 'Editing', label: 'Save current work' },
  { id: 'edit.undo', group: 'Editing', label: 'Undo' },
  { id: 'edit.redo', group: 'Editing', label: 'Redo' },
  { id: 'edit.copyAnnotation', group: 'Editing', label: 'Copy selected annotation' },
  { id: 'edit.paste', group: 'Editing', label: 'Paste screenshot or annotation' },
  { id: 'edit.deleteAnnotation', group: 'Editing', label: 'Delete selected annotation' },
  { id: 'tool.select', group: 'Annotation tools', label: 'Select / Move' },
  { id: 'tool.text', group: 'Annotation tools', label: 'Text' },
  { id: 'tool.arrow', group: 'Annotation tools', label: 'Arrow' },
  { id: 'tool.rectangle', group: 'Annotation tools', label: 'Rectangle' },
  { id: 'tool.highlight', group: 'Annotation tools', label: 'Highlight' },
  { id: 'tool.step', group: 'Annotation tools', label: 'Note / Step' },
  { id: 'screenshot.previous', group: 'Screenshots', label: 'Previous screenshot' },
  { id: 'screenshot.next', group: 'Screenshots', label: 'Next screenshot' },
  { id: 'screenshot.toggleExport', group: 'Screenshots', label: 'Include or exclude screenshot' },
  { id: 'prompt.copy', group: 'Prompt bundles', label: 'Copy current prompt bundle' },
  { id: 'panel.toggleCollections', group: 'Panels and canvas', label: 'Toggle collection rail' },
  { id: 'panel.toggleInspector', group: 'Panels and canvas', label: 'Toggle inspector' },
  { id: 'canvas.fit', group: 'Panels and canvas', label: 'Fit screenshot' },
  { id: 'canvas.actualSize', group: 'Panels and canvas', label: 'Actual size' },
  { id: 'collection.new', group: 'Collections', label: 'New collection' },
  { id: 'collection.overallContext', group: 'Collections', label: 'Edit overall context' },
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]['id'];
export type ShortcutBindings = Partial<Record<ShortcutActionId, string | null>>;
export type ResolvedShortcutBindings = Record<ShortcutActionId, string | null>;

export interface ShortcutConflict {
  binding: string;
  actionIds: ShortcutActionId[];
}

export interface ShortcutValidationIssue {
  kind: 'invalid' | 'reserved' | 'conflict';
  message: string;
  conflictingActionId?: ShortcutActionId;
}

const MODIFIER_ORDER = ['Meta', 'Ctrl', 'Alt', 'Shift'] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number] | 'Mod'> = {
  alt: 'Alt',
  cmd: 'Meta',
  command: 'Meta',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  meta: 'Meta',
  mod: 'Mod',
  option: 'Alt',
  shift: 'Shift',
  win: 'Meta',
  windows: 'Meta',
};

const KEY_ALIASES: Record<string, string> = {
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  down: 'ArrowDown',
  end: 'End',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  home: 'Home',
  left: 'ArrowLeft',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  return: 'Enter',
  right: 'ArrowRight',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  up: 'ArrowUp',
};

const DEFAULT_COMMON: ResolvedShortcutBindings = {
  'project.new': 'Ctrl+N',
  'project.open': 'Ctrl+O',
  'project.search': 'Ctrl+F',
  'navigation.projects': 'Ctrl+1',
  'navigation.recent': 'Ctrl+2',
  'navigation.favourites': 'Ctrl+3',
  'edit.save': 'Ctrl+S',
  'edit.undo': 'Ctrl+Z',
  'edit.redo': 'Ctrl+Shift+Z',
  'edit.copyAnnotation': 'Ctrl+C',
  'edit.paste': 'Ctrl+V',
  'edit.deleteAnnotation': 'Delete',
  'tool.select': 'V',
  'tool.text': 'T',
  'tool.arrow': 'A',
  'tool.rectangle': 'R',
  'tool.highlight': 'H',
  'tool.step': 'N',
  'screenshot.previous': 'Alt+ArrowUp',
  'screenshot.next': 'Alt+ArrowDown',
  'screenshot.toggleExport': 'Alt+E',
  'prompt.copy': 'Ctrl+Shift+C',
  'panel.toggleCollections': 'Ctrl+Shift+1',
  'panel.toggleInspector': 'Ctrl+Shift+2',
  'canvas.fit': '0',
  'canvas.actualSize': '1',
  'collection.new': 'Ctrl+Alt+N',
  'collection.overallContext': 'Ctrl+Alt+C',
};

const RESERVED_BY_PLATFORM: Record<ShortcutPlatform, ReadonlySet<string>> = {
  mac: new Set(['Meta+Q', 'Meta+W', 'Meta+H', 'Meta+M', 'Meta+Space', 'Meta+Tab', 'Meta+Alt+Escape']),
  windows: new Set(['Alt+F4', 'Ctrl+Alt+Delete', 'Ctrl+Shift+Escape', 'Meta+D', 'Meta+L', 'Meta+Tab']),
  linux: new Set(['Alt+F4', 'Ctrl+Alt+Delete', 'Ctrl+Alt+F1', 'Meta+D', 'Meta+L', 'Meta+Tab']),
};

const RESERVED_ALL = new Set(['F5', 'F12']);

function canonicalKey(rawKey: string): string | null {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^arrow(up|down|left|right)$/i.test(trimmed))
    return `Arrow${trimmed.slice(5, 6).toUpperCase()}${trimmed.slice(6).toLowerCase()}`;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  if (/^[a-z][a-z0-9]*$/i.test(trimmed)) return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
  return null;
}

export function detectShortcutPlatform(platformValue?: string): ShortcutPlatform {
  const value = (platformValue ?? (typeof navigator === 'undefined' ? '' : navigator.platform)).toLowerCase();
  if (value.includes('mac')) return 'mac';
  if (value.includes('win')) return 'windows';
  return 'linux';
}

export function normalizeShortcut(input: string, platform: ShortcutPlatform): string | null {
  const tokens = input
    .replace(/\s*\+\s*/g, '+')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key: string | null = null;
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Ctrl') : modifier);
      continue;
    }
    if (key) return null;
    key = canonicalKey(token);
    if (!key) return null;
  }
  if (!key) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

type ShortcutKeyboardEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

export function keyboardEventToShortcut(
  event: ShortcutKeyboardEvent,
  platform: ShortcutPlatform,
): string | null {
  if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return null;
  // Shift changes top-row digit `key` values to symbols on common layouts. The physical Digit code keeps
  // configured digit shortcuts stable, while letters intentionally continue to follow layout-aware `key`.
  const digitFromCode = event.code?.match(/^Digit([0-9])$/)?.[1];
  const key = digitFromCode ?? (event.key === ' ' ? 'Space' : event.key);
  const parts = [
    event.metaKey ? 'Meta' : '',
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ].filter(Boolean);
  return normalizeShortcut(parts.join('+'), platform);
}

export function getDefaultShortcuts(platform: ShortcutPlatform): ResolvedShortcutBindings {
  const modifier = platform === 'mac' ? 'Meta' : 'Ctrl';
  return Object.fromEntries(
    Object.entries(DEFAULT_COMMON).map(([actionId, binding]) => [
      actionId,
      platform === 'mac' && actionId === 'edit.deleteAnnotation'
        ? 'Backspace'
        : (binding?.replace(/^Ctrl(?=\+)/, modifier) ?? null),
    ]),
  ) as ResolvedShortcutBindings;
}

export function resolveShortcutBindings(
  overrides: ShortcutBindings,
  platform: ShortcutPlatform,
): ResolvedShortcutBindings {
  const resolved = getDefaultShortcuts(platform);
  for (const action of SHORTCUT_ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, action.id)) continue;
    const override = overrides[action.id];
    resolved[action.id] = override === null ? null : normalizeShortcut(override ?? '', platform);
  }
  return resolved;
}

export function findShortcutConflicts(bindings: ResolvedShortcutBindings): ShortcutConflict[] {
  const byBinding = new Map<string, ShortcutActionId[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = bindings[action.id];
    if (!binding) continue;
    byBinding.set(binding, [...(byBinding.get(binding) ?? []), action.id]);
  }
  return [...byBinding.entries()]
    .filter(([, actionIds]) => actionIds.length > 1)
    .map(([binding, actionIds]) => ({ binding, actionIds }));
}

export function isReservedShortcut(binding: string, platform: ShortcutPlatform): boolean {
  const normalized = normalizeShortcut(binding, platform);
  return (
    normalized !== null && (RESERVED_ALL.has(normalized) || RESERVED_BY_PLATFORM[platform].has(normalized))
  );
}

export function validateShortcut(
  actionId: ShortcutActionId,
  candidate: string,
  bindings: ResolvedShortcutBindings,
  platform: ShortcutPlatform,
): ShortcutValidationIssue | null {
  const normalized = normalizeShortcut(candidate, platform);
  if (!normalized)
    return { kind: 'invalid', message: 'Use one key with optional Command, Ctrl, Alt, or Shift modifiers.' };
  if (isReservedShortcut(normalized, platform))
    return {
      kind: 'reserved',
      message: `${formatShortcut(normalized, platform)} is reserved by the system or app.`,
    };
  const conflict = SHORTCUT_ACTIONS.find(
    (action) => action.id !== actionId && bindings[action.id] === normalized,
  );
  if (conflict)
    return {
      kind: 'conflict',
      message: `${formatShortcut(normalized, platform)} is already assigned to ${conflict.label}.`,
      conflictingActionId: conflict.id,
    };
  return null;
}

export function formatShortcut(binding: string | null, platform: ShortcutPlatform): string {
  if (!binding) return 'Not set';
  if (platform !== 'mac') return binding.replaceAll('+', ' + ');
  return binding
    .split('+')
    .map((part) => ({ Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Space: 'Space' })[part] ?? part)
    .join('');
}

export function shortcutMatchesEvent(
  event: ShortcutKeyboardEvent,
  binding: string | null,
  platform: ShortcutPlatform,
): boolean {
  if (!binding || isReservedShortcut(binding, platform)) return false;
  return keyboardEventToShortcut(event, platform) === normalizeShortcut(binding, platform);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="dialog"]',
    ),
  );
}

export function shouldIgnoreShortcutEvent(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented || event.isComposing || event.repeat || isEditableShortcutTarget(event.target)
  );
}
