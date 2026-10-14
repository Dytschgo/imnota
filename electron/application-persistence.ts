import { afterFileCommit, atomicWrite, type AtomicWriteVerification } from './files.js';
import { preferenceSettingsEnvelope } from '../src/shared/preference-settings.js';
import type { WorkspaceSettings } from '../src/shared/types.js';
import type { PreferenceSettings, PreferenceSettingsResult } from '../src/shared/preferences.js';
import type { PersistenceDiagnostics } from './persistence-diagnostics.js';

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
): Promise<void> {
  await host.diagnostics.filesystem('write', filePath, () =>
    afterFileCommit(
      () => atomicWrite(filePath, content, host.verification),
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
