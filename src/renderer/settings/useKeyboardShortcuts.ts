import { useEffect, useMemo } from 'react';
import {
  SHORTCUT_ACTIONS,
  detectShortcutPlatform,
  findShortcutConflicts,
  resolveShortcutBindings,
  shortcutMatchesEvent,
  shouldIgnoreShortcutEvent,
  type ShortcutActionId,
  type ShortcutBindings,
  type ShortcutPlatform,
} from '../../shared/shortcuts';

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface UseKeyboardShortcutsOptions {
  bindings: ShortcutBindings;
  handlers: Partial<Record<ShortcutActionId, ShortcutHandler>>;
  platform?: ShortcutPlatform;
  enabled?: boolean;
  target?: Window | null;
}

export function useKeyboardShortcuts({
  bindings,
  handlers,
  platform = detectShortcutPlatform(),
  enabled = true,
  target = typeof window === 'undefined' ? null : window,
}: UseKeyboardShortcutsOptions): void {
  const resolved = useMemo(() => resolveShortcutBindings(bindings, platform), [bindings, platform]);
  const conflictingActions = useMemo(
    () => new Set(findShortcutConflicts(resolved).flatMap((conflict) => conflict.actionIds)),
    [resolved],
  );

  useEffect(() => {
    if (!enabled || !target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event)) return;
      const action = SHORTCUT_ACTIONS.find(
        ({ id }) =>
          !conflictingActions.has(id) &&
          Boolean(handlers[id]) &&
          shortcutMatchesEvent(event, resolved[id], platform),
      );
      if (!action) return;
      event.preventDefault();
      handlers[action.id]?.(event);
    };
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
  }, [conflictingActions, enabled, handlers, platform, resolved, target]);
}
