import { useSyncExternalStore } from 'react';
import {
  faultCommandSchema,
  FAULT_QUEUED_NAME,
  type FaultObservation,
  type NativeFaultReceiver,
} from '../../shared/native-faults';

type State = Omit<FaultObservation, 'nonce' | 'caseId' | 'requestId' | 'event'>;
interface Adapter {
  read(): State;
  queueMetadata(name: typeof FAULT_QUEUED_NAME): void;
  stageDrafts(): void;
}
const receiver = (window as Window & { imnotaNativeFault?: NativeFaultReceiver }).imnotaNativeFault;
let adapter: Adapter | undefined;
let lastCommand: import('../../shared/native-faults').FaultCommand | undefined;
export function reportNativeFaultTransition(): void {
  if (!receiver || !adapter || !lastCommand) return;
  receiver.report({
    ...adapter.read(),
    nonce: lastCommand.nonce,
    caseId: lastCommand.caseId,
    requestId: lastCommand.requestId,
    event: 'state:revision',
  });
}
let armedSave: import('../../shared/native-faults').FaultCommand | undefined;

/** Observe the actual user save handler; arming never triggers or substitutes a save. */
export async function observeNativeFaultSave(save: () => Promise<boolean>): Promise<boolean> {
  const armed = armedSave;
  if (!receiver || !adapter || !armed) return save();
  armedSave = undefined;
  const report = (event: string) =>
    receiver.report({
      ...adapter!.read(),
      nonce: armed.nonce,
      caseId: armed.caseId,
      requestId: armed.requestId,
      event,
    });
  report('save:started');
  try {
    const saved = await save();
    report(saved ? 'save:completed' : 'save:refused');
    return saved;
  } catch (error) {
    report('save:error');
    throw error;
  }
}

let failure: 'app' | 'panel' | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Kept across root unmount for the same reason as the production reload save closure. */
export function registerNativeFaultAdapter(value: Adapter): void {
  if (receiver) adapter = value;
}
export const nativeFaultReceiverPresent = Boolean(receiver);

if (receiver) {
  receiver.onCommand((raw) => {
    const command = faultCommandSchema.parse(raw);
    if (command.nonce !== receiver.nonce || !adapter) throw new Error('Unowned fault renderer command.');
    lastCommand = command;
    const before = adapter.read();
    if (before.projectPath !== command.projectPath || before.projectId !== command.projectId)
      throw new Error('Fault renderer fixture identity changed.');
    switch (command.action) {
      case 'queue-fixture-metadata':
        adapter.queueMetadata(FAULT_QUEUED_NAME);
        break;
      case 'stage-recovery-drafts':
        adapter.stageDrafts();
        adapter.queueMetadata(FAULT_QUEUED_NAME);
        failure = 'app';
        break;
      case 'render-app-failure':
        failure = 'app';
        break;
      case 'render-panel-failure':
        failure = 'panel';
        break;
      case 'clear-render-failure':
        failure = undefined;
        break;
      case 'arm-save':
        if (armedSave) throw new Error('A native save observation is already armed.');
        armedSave = command;
        break;
      case 'observe':
        break;
      case 'disarm':
        armedSave = undefined;
        failure = undefined;
        break;
    }
    receiver.report({
      ...adapter.read(),
      nonce: command.nonce,
      caseId: command.caseId,
      requestId: command.requestId,
      event: command.action,
    });
    if (command.action === 'disarm') adapter = undefined;
    notify();
  });
  window.addEventListener('pagehide', () => {
    adapter = undefined;
    armedSave = undefined;
    failure = undefined;
    listeners.clear();
  });
}

/** A synchronous React render throw inside the existing boundary, including React's recovery render. */
export function NativeFaultProbe({ scope }: { scope: 'app' | 'panel' }) {
  const value = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => failure,
  );
  if (receiver && value === scope) throw new Error(`Controlled fixture React ${scope} render failure`);
  return null;
}
