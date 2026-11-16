import type { NativeFaultReceiver } from '../../shared/native-faults';

/**
 * Smoke-only fault verification stays out of the startup bundle. Only a window whose preload
 * exposed the verified fault receiver loads the probe, before the root renders, so every call
 * below behaves exactly as the probe's own exports from the first render on.
 */
type Probe = typeof import('./native-fault-probe');
type Adapter = Parameters<Probe['registerNativeFaultAdapter']>[0];

let probe: Probe | undefined;

export const nativeFaultReceiverPresent = Boolean(
  (window as Window & { imnotaNativeFault?: NativeFaultReceiver }).imnotaNativeFault,
);

/** Resolves once the probe is loaded, immediately when no fault receiver is present. */
export async function loadNativeFaultProbe(): Promise<void> {
  if (nativeFaultReceiverPresent && !probe) probe = await import('./native-fault-probe');
}

export function registerNativeFaultAdapter(value: Adapter): void {
  probe?.registerNativeFaultAdapter(value);
}

export function reportNativeFaultTransition(): void {
  probe?.reportNativeFaultTransition();
}

export function observeNativeFaultSave(save: () => Promise<boolean>): Promise<boolean> {
  return probe ? probe.observeNativeFaultSave(save) : save();
}

export function NativeFaultProbe({ scope }: { scope: 'app' | 'panel' }) {
  const Loaded = probe?.NativeFaultProbe;
  return Loaded ? <Loaded scope={scope} /> : null;
}
