import { useCallback, useInsertionEffect, useRef } from 'react';

type Callback = (...args: never[]) => unknown;

/**
 * Returns a function whose identity never changes and which always calls the latest `callback`.
 * Use it for event handlers passed to memoized children; do not call the result during render.
 * An absent callback stays absent, so children that check for a handler keep working.
 */
export function useStableCallback<T extends Callback>(callback: T): T;
export function useStableCallback<T extends Callback>(callback: T | undefined): T | undefined;
export function useStableCallback<T extends Callback>(callback: T | undefined): T | undefined {
  const latest = useRef(callback);
  // Insertion effects run before any layout effect, so children never observe a stale handler.
  useInsertionEffect(() => {
    latest.current = callback;
  });
  const stable = useCallback(
    (...args: Parameters<T>) =>
      (latest.current as ((...values: Parameters<T>) => ReturnType<T>) | undefined)?.(...args),
    [],
  ) as unknown as T;
  return callback ? stable : undefined;
}
