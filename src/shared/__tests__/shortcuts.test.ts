import { describe, expect, it } from 'vitest';
import {
  findShortcutConflicts,
  formatShortcut,
  getDefaultShortcuts,
  isReservedShortcut,
  keyboardEventToShortcut,
  normalizeShortcut,
  resolveShortcutBindings,
  shortcutMatchesEvent,
  shouldIgnoreShortcutEvent,
  validateShortcut,
} from '../shortcuts';

describe('shortcut normalization', () => {
  it('normalizes aliases and platform modifiers', () => {
    expect(normalizeShortcut('cmd + shift + c', 'mac')).toBe('Meta+Shift+C');
    expect(normalizeShortcut('mod+shift+c', 'windows')).toBe('Ctrl+Shift+C');
    expect(normalizeShortcut('option + down', 'mac')).toBe('Alt+ArrowDown');
    expect(normalizeShortcut('Ctrl+A+B', 'windows')).toBeNull();
  });

  it('creates platform-aware defaults and resets overrides', () => {
    expect(getDefaultShortcuts('mac')['prompt.copy']).toBe('Meta+Shift+C');
    expect(getDefaultShortcuts('windows')['prompt.copy']).toBe('Ctrl+Shift+C');
    expect(resolveShortcutBindings({ 'tool.text': 'x', 'tool.arrow': null }, 'windows')).toMatchObject({
      'tool.text': 'X',
      'tool.arrow': null,
      'canvas.fit': '0',
      'edit.save': 'Ctrl+S',
    });
  });

  it('detects conflicts and explains reserved combinations', () => {
    const bindings = getDefaultShortcuts('windows');
    bindings['tool.arrow'] = 'T';
    expect(findShortcutConflicts(bindings)).toEqual([
      { binding: 'T', actionIds: ['tool.text', 'tool.arrow'] },
    ]);
    expect(validateShortcut('tool.arrow', 'T', bindings, 'windows')).toMatchObject({ kind: 'conflict' });
    expect(isReservedShortcut('Alt+F4', 'windows')).toBe(true);
    expect(validateShortcut('tool.arrow', 'Alt+F4', bindings, 'windows')).toMatchObject({ kind: 'reserved' });
  });

  it('formats compact macOS labels', () => {
    expect(formatShortcut('Meta+Shift+C', 'mac')).toBe('⌘⇧C');
    expect(formatShortcut('Ctrl+Shift+C', 'windows')).toBe('Ctrl + Shift + C');
  });
});

describe('shortcut runtime matching', () => {
  it('matches normalized keyboard events', () => {
    const event = { key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
    expect(keyboardEventToShortcut(event, 'windows')).toBe('Ctrl+Shift+C');
    expect(shortcutMatchesEvent(event, 'Ctrl+Shift+C', 'windows')).toBe(true);
  });

  it('ignores typing, dialogs, composition, repeats, and reserved bindings', () => {
    const input = document.createElement('input');
    const typingEvent = new KeyboardEvent('keydown', { key: 't' });
    input.dispatchEvent(typingEvent);
    Object.defineProperty(typingEvent, 'target', { value: input });
    expect(shouldIgnoreShortcutEvent(typingEvent)).toBe(true);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    const dialogEvent = new KeyboardEvent('keydown', { key: 't' });
    Object.defineProperty(dialogEvent, 'target', { value: button });
    expect(shouldIgnoreShortcutEvent(dialogEvent)).toBe(true);

    expect(
      shortcutMatchesEvent(
        { key: 'F4', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false },
        'Alt+F4',
        'windows',
      ),
    ).toBe(false);
  });
});
