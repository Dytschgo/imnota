import { useEffect, useState, type ComponentProps } from 'react';
import { lazyWithPreload } from '../lazyWithPreload';

/**
 * Settings, onboarding, What's New and the dialogs are not needed to show the first window, so
 * they load as separate chunks. Each keeps its own export name and props, and all of them are
 * preloaded once the app is idle after boot so that opening one later does not wait for a chunk.
 */

type SettingsViewProps = ComponentProps<typeof import('../settings/SettingsView').SettingsView>;
type OnboardingDemoProps = ComponentProps<typeof import('../onboarding/OnboardingDemo').OnboardingDemo>;
type WhatsNewDialogProps = ComponentProps<typeof import('../components/WhatsNew').WhatsNewDialog>;
type AppDialogsProps = ComponentProps<typeof import('./AppDialogs').AppDialogs>;
type SearchDialogProps = ComponentProps<typeof import('../search/SearchDialog').SearchDialog>;
type CaptureDestinationDialogProps = ComponentProps<
  typeof import('../capture/CaptureDestinationDialog').CaptureDestinationDialog
>;
type PromptBundleDialogHostProps = ComponentProps<
  typeof import('../export/PromptBundleDialogHost').PromptBundleDialogHost
>;

/** Holds the settings page area while its chunk loads, so the shell does not shift. */
const settingsFallback = <section className="settings-view" aria-busy="true" />;

export const SettingsView = lazyWithPreload<SettingsViewProps>(
  () => import('../settings/SettingsView').then((module) => module.SettingsView),
  settingsFallback,
);
export const OnboardingDemo = lazyWithPreload<OnboardingDemoProps>(() =>
  import('../onboarding/OnboardingDemo').then((module) => module.OnboardingDemo),
);
export const WhatsNewDialog = lazyWithPreload<WhatsNewDialogProps>(() =>
  import('../components/WhatsNew').then((module) => module.WhatsNewDialog),
);
export const CaptureDestinationDialog = lazyWithPreload<CaptureDestinationDialogProps>(() =>
  import('../capture/CaptureDestinationDialog').then((module) => module.CaptureDestinationDialog),
);
const LazyAppDialogs = lazyWithPreload<AppDialogsProps>(() =>
  import('./AppDialogs').then((module) => module.AppDialogs),
);
const LazySearchDialog = lazyWithPreload<SearchDialogProps>(() =>
  import('../search/SearchDialog').then((module) => module.SearchDialog),
);
const LazyPromptBundleDialogHost = lazyWithPreload<PromptBundleDialogHostProps>(() =>
  import('../export/PromptBundleDialogHost').then((module) => module.PromptBundleDialogHost),
);

/** The app dialogs render nothing without a dialog, so they load only once one opens. */
export function AppDialogs(props: AppDialogsProps) {
  return props.dialog ? <LazyAppDialogs {...props} /> : null;
}

/** Mounts once it first opens, then stays mounted exactly like the eager component did. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function SearchDialog(props: SearchDialogProps) {
  return useOpenedOnce(props.open) ? <LazySearchDialog {...props} /> : null;
}

export function PromptBundleDialogHost(props: PromptBundleDialogHostProps) {
  return useOpenedOnce(props.controller.isOpen) ? <LazyPromptBundleDialogHost {...props} /> : null;
}

const DEFERRED_SURFACES = [
  SettingsView,
  OnboardingDemo,
  WhatsNewDialog,
  CaptureDestinationDialog,
  LazyAppDialogs,
  LazySearchDialog,
  LazyPromptBundleDialogHost,
];

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
