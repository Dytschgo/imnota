import { useEffect, useState, type ComponentProps } from 'react';
import { Modal } from '../components/ui';
import { lazyWithPreload } from '../lazyWithPreload';

/**
 * Settings, onboarding and the Share bundles dialogs are not needed to show the first window, so
 * they load as separate chunks. Each keeps its own export name and props, and all of them are
 * preloaded once the app is idle after boot so that opening one later does not wait for a chunk.
 *
 * A dialog must behave as a modal from the frame it opens in, or keystrokes reach the background
 * (tool shortcuts, the focused row) and focus restoration captures the wrong element. So:
 * - Search, the app dialogs, the capture destination picker and What's New stay eager. Search
 *   (Ctrl+F) and New project (Ctrl+N) take typed input immediately, capture is opened by a
 *   global hotkey, and What's New opens at boot, before the idle preload. Together they are
 *   about 17 kB, less than a shell that buffers typing would cost to get right.
 * - Onboarding (opened at boot on a fresh profile) and Share bundles (opened from its toolbar
 *   button) render an eager modal shell while their chunk loads: the same dialog container,
 *   focus trap and Escape handling, marked `aria-busy`. Neither takes typed input before its
 *   content loads, and the shell's focus restoration captures the opener when it opens.
 * - Settings is a page, not a modal, and keeps its page-area placeholder.
 */

type SettingsViewProps = ComponentProps<typeof import('../settings/SettingsView').SettingsView>;
type OnboardingDemoProps = ComponentProps<typeof import('../onboarding/OnboardingDemo').OnboardingDemo>;
type PromptBundleDialogHostProps = ComponentProps<
  typeof import('../export/PromptBundleDialogHost').PromptBundleDialogHost
>;

/** Stands in for a modal whose chunk is still loading, so it is modal from the first frame. */
export function PendingDialog({ title, onCancel }: { title: string; onCancel(): void }) {
  return (
    <Modal title={title} onClose={onCancel} busy>
      <p className="modal-loading" role="status">
        Loading…
      </p>
    </Modal>
  );
}

/** Holds the settings page area while its chunk loads, so the shell does not shift. */
const settingsFallback = <section className="settings-view" aria-busy="true" />;

export const SettingsView = lazyWithPreload<SettingsViewProps>(
  () => import('../settings/SettingsView').then((module) => module.SettingsView),
  settingsFallback,
);
// Cancelling before the guide has loaded closes it for now without recording it as seen.
export const OnboardingDemo = lazyWithPreload<OnboardingDemoProps>(
  () => import('../onboarding/OnboardingDemo').then((module) => module.OnboardingDemo),
  (props) => <PendingDialog title="Try the complete handoff" onCancel={() => props.onDismiss?.()} />,
);
const LazyPromptBundleDialogHost = lazyWithPreload<PromptBundleDialogHostProps>(
  () => import('../export/PromptBundleDialogHost').then((module) => module.PromptBundleDialogHost),
  (props) =>
    props.controller.isOpen ? (
      <PendingDialog title="Share bundles" onCancel={() => props.controller.close()} />
    ) : null,
);

/** Mounts once it first opens, then stays mounted exactly like the eager component did. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function PromptBundleDialogHost(props: PromptBundleDialogHostProps) {
  return useOpenedOnce(props.controller.isOpen) ? <LazyPromptBundleDialogHost {...props} /> : null;
}

const DEFERRED_SURFACES = [SettingsView, OnboardingDemo, LazyPromptBundleDialogHost];

/** Preloads every deferred surface once `ready` is true and the renderer is idle. */
export function useDeferredSurfacePreload(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const preload = () => {
      // A failed preload is retried by the first render that needs the surface.
      for (const surface of DEFERRED_SURFACES) surface.preload().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 500);
    return () => window.clearTimeout(timer);
  }, [ready]);
}
