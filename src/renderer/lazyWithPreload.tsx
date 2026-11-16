import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';

export interface PreloadableComponent<P extends object> {
  (props: P): ReactNode;
  /** Starts loading the module; resolves once rendering no longer needs to suspend. */
  preload(): Promise<void>;
}

/**
 * A code-split component with its own Suspense boundary. Once `preload` has finished, new
 * instances render directly instead of suspending, so a preloaded surface never shows its
 * fallback. An instance keeps the element type it mounted with, so loading never remounts it.
 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
): PreloadableComponent<P> {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const loadOnce = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        // A failed preload must not stop a later render from trying again.
        pending = undefined;
        throw error;
      },
    ));
  const Lazy = lazy(async () => ({ default: await loadOnce() }));
  function Preloadable(props: P) {
    const [Direct] = useState(() => loaded);
    if (Direct) return <Direct {...props} />;
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  Preloadable.preload = () => loadOnce().then(() => undefined);
  return Preloadable;
}
