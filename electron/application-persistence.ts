import {
  afterFileCommit,
  atomicWrite,
  type AtomicWriteVerification,
  type CaptureWrittenFileIdentity,
} from './files.js';
import { preferenceSettingsEnvelope } from '../src/shared/preference-settings.js';
import type { WorkspaceSettings } from '../src/shared/types.js';
import type { PreferenceSettings, PreferenceSettingsResult } from '../src/shared/preferences.js';
import type { PersistenceDiagnostics } from './persistence-diagnostics.js';

export async function trashApplicationFile(
  filePath: string,
  host: {
    diagnostics: PersistenceDiagnostics;
    trash(path: string): Promise<void>;
    recordSelfDelete(path: string): void;
  },
): Promise<void> {
  await host.diagnostics.filesystem('trash', filePath, async () => {
    await host.trash(filePath);
    // The watch can flush while the diagnostic completion record is syncing.
    // Publish only a completed trash, before diagnostics can delay its marker.
    host.recordSelfDelete(filePath);
  });
}

/** Shared by main and integration tests: publication precedes diagnostic completion or rejection. */
export async function writeApplicationFile(
  filePath: string,
  content: string | Uint8Array,
  host: {
    diagnostics: PersistenceDiagnostics;
    recordSelfWrite(path: string, content: string | Uint8Array): void;
    invalidate(path: string): void;
    verification?: AtomicWriteVerification;
  },
  captureIdentity?: CaptureWrittenFileIdentity,
): Promise<void> {
  await host.diagnostics.filesystem('write', filePath, () =>
    afterFileCommit(
      () => atomicWrite(filePath, content, captureIdentity, host.verification),
      () => {
        host.recordSelfWrite(filePath, content);
        host.invalidate(filePath);
      },
    ),
  );
}

export async function persistSettings(
  nextSettings: WorkspaceSettings,
  nextPreferences: PreferenceSettings,
  host: {
    filePath: string;
    retained: Record<string, unknown>;
    profile: PreferenceSettingsResult['profile'];
    write(path: string, content: string): Promise<void>;
    publish(settings: WorkspaceSettings, preferences: PreferenceSettings): void;
    savePreference(enabled: boolean, persist: () => Promise<void>): Promise<void>;
    syncShortcut(): void;
  },
): Promise<void> {
  const persisted = preferenceSettingsEnvelope(
    { ...host.retained, ...nextSettings },
    nextPreferences,
    host.profile,
  );
  await afterFileCommit(
    () =>
      host.savePreference(nextPreferences.agentAccess.enabled, () =>
        afterFileCommit(
          () => host.write(host.filePath, JSON.stringify(persisted, null, 2)),
          () => host.publish({ ...nextSettings }, nextPreferences),
        ),
      ),
    host.syncShortcut,
  );
}
