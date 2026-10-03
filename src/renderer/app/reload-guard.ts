/**
 * Reload protection for recovery screens.
 *
 * The app registers how to save pending work and how to let the guarded `beforeunload` handler
 * through. Error fallbacks reload through `reloadWindow` so a crash never skips that save.
 */
export interface ReloadProtection {
  /** Save every pending edit. Resolves false when something could not be saved. */
  flush(): Promise<boolean>;
  /** Let the next unload through without another save attempt. */
  allowUnload(): void;
}

let protection: ReloadProtection | null = null;

/**
 * The registration deliberately outlives the component that made it: after a render crash the app
 * tree is unmounted, but its unsaved drafts still live in the registered closure.
 */
export function setReloadProtection(next: ReloadProtection | null): void {
  protection = next;
}

/**
 * Save pending work, then reload. Returns false (without reloading) when the save failed and the
 * caller did not choose to discard the unsaved work.
 */
export async function reloadWindow(
  options: { discardUnsaved?: boolean } = {},
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  const current = protection;
  if (current && !options.discardUnsaved) {
    let saved = false;
    try {
      saved = await current.flush();
    } catch {
      saved = false;
    }
    if (!saved) return false;
  }
  current?.allowUnload();
  reload();
  return true;
}
