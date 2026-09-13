import {
  Archive,
  CheckCircle2,
  Clock3,
  Download,
  FolderClock,
  FolderOpen,
  History,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackupInspection,
  BackupListResult,
  BackupPreferences,
  BackupRestoreResult,
  BackupSnapshotReason,
} from '../../shared/backups';
import type { ProjectListItem } from '../../shared/types';
import { Button } from '../components/ui';
import './settings.css';

export interface BackupSettingsProps {
  value: BackupPreferences;
  projects: ProjectListItem[];
  disabled?: boolean;
  onChange(value: BackupPreferences): void | Promise<void>;
  onBeforeAction?(): boolean | Promise<boolean>;
  onRestored?(result: BackupRestoreResult): void | Promise<void>;
  onRestoreFailed?(): void;
}

const REASON_LABELS: Record<BackupSnapshotReason, string> = {
  manual: 'Manual',
  migration: 'Before migration',
  'destructive-operation': 'Before project deletion',
  'safety-restore': 'Restore safety copy',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function actionMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function BackupSettings({
  value,
  projects,
  disabled = false,
  onChange,
  onBeforeAction = () => true,
  onRestored,
  onRestoreFailed,
}: BackupSettingsProps) {
  const [history, setHistory] = useState<BackupListResult | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState(projects[0]?.projectPath ?? '');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirmInPlace, setConfirmInPlace] = useState(false);
  const [committedRestore, setCommittedRestore] = useState<BackupRestoreResult | null>(null);
  const historyGeneration = useRef(0);
  const inspectionGeneration = useRef(0);
  const selectedSnapshot = useRef('');

  const loadHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    ++inspectionGeneration.current;
    selectedSnapshot.current = '';
    setSelectedSnapshotId('');
    setInspection(null);
    setConfirmInPlace(false);
    setLoading(true);
    setError('');
    try {
      const next = await window.imnota.getBackupHistory();
      if (generation === historyGeneration.current) setHistory(next);
    } catch (reason) {
      if (generation === historyGeneration.current)
        setError(actionMessage(reason, 'Local history could not be loaded.'));
    } finally {
      if (generation === historyGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!selectedProjectPath && projects[0]) setSelectedProjectPath(projects[0].projectPath);
  }, [projects, selectedProjectPath]);

  const selected = history?.snapshots.find((item) => item.snapshotId === selectedSnapshotId);
  const inPlaceProject = useMemo(
    () => projects.find((project) => project.id === selected?.sourceProjectId),
    [projects, selected?.sourceProjectId],
  );

  async function update(next: BackupPreferences) {
    setError('');
    try {
      await onChange(next);
    } catch (reason) {
      setError(actionMessage(reason, 'Backup settings could not be saved.'));
    }
  }

  async function run(name: string, operation: () => Promise<void>) {
    setBusy(name);
    setError('');
    setStatus('');
    try {
      if (!(await onBeforeAction())) return;
      await operation();
    } catch (reason) {
      setError(actionMessage(reason, 'The backup operation failed.'));
    } finally {
      setBusy('');
    }
  }

  async function selectSnapshot(id: string) {
    const generation = ++inspectionGeneration.current;
    selectedSnapshot.current = id;
    setSelectedSnapshotId(id);
    setConfirmInPlace(false);
    setInspection(null);
    setError('');
    setBusy('inspect');
    try {
      const next = await window.imnota.inspectBackupSnapshot({ snapshotId: id });
      if (generation === inspectionGeneration.current && selectedSnapshot.current === id) setInspection(next);
    } catch (reason) {
      if (generation === inspectionGeneration.current && selectedSnapshot.current === id)
        setError(actionMessage(reason, 'This snapshot could not be inspected.'));
    } finally {
      if (generation === inspectionGeneration.current) setBusy('');
    }
  }

  async function handleRestoreResult(result: BackupRestoreResult) {
    if (result.snapshot) setCommittedRestore(null);
    else setCommittedRestore(result);
    await onRestored?.(result);
  }

  return (
    <section className="imnota-backup-settings" aria-labelledby="backup-settings-title">
      <div className="imnota-preference-heading">
        <div>
          <h2 id="backup-settings-title">Local history</h2>
          <p>
            Keep validated project snapshots outside active projects. Exports and recovery caches are not
            duplicated.
          </p>
        </div>
        <Button
          variant="soft"
          disabled={disabled || loading || Boolean(busy)}
          onClick={() => void loadHistory()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <label className="settings-switch">
        <span>
          <strong>Automatic local history</strong>
          <small>Create snapshots before migrations and whole-project deletion.</small>
        </span>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled || Boolean(busy)}
          onChange={(event) => void update({ ...value, enabled: event.target.checked })}
        />
      </label>

      <div className="imnota-backup-retention">
        <label>
          <span>Keep newest</span>
          <select
            aria-label="Backup retention count"
            value={value.retentionCount}
            disabled={disabled || Boolean(busy)}
            onChange={(event) => void update({ ...value, retentionCount: Number(event.target.value) })}
          >
            {[5, 10, 20, 50, 100].map((count) => (
              <option value={count} key={count}>
                {count} snapshots per project
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Maximum age</span>
          <select
            aria-label="Backup retention age"
            value={value.retentionAgeDays}
            disabled={disabled || Boolean(busy)}
            onChange={(event) => void update({ ...value, retentionAgeDays: Number(event.target.value) })}
          >
            {[7, 30, 90, 180, 365].map((days) => (
              <option value={days} key={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="imnota-backup-location">
        <div className="workspace-path">
          <FolderClock size={17} aria-hidden="true" />
          <span>{history?.location ?? 'Resolving local history location…'}</span>
        </div>
        <div className="settings-actions">
          <Button
            variant="soft"
            disabled={disabled || Boolean(busy)}
            onClick={() =>
              void run('location', async () => {
                const location = await window.imnota.chooseBackupLocation();
                if (!location) return;
                await onChange({ ...value, location });
                await loadHistory();
                setStatus('Local history location updated. Existing snapshots were not moved.');
              })
            }
          >
            <FolderOpen size={14} aria-hidden="true" />
            Change location
          </Button>
          {history?.location && (
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() =>
                void window.imnota
                  .openPath(history.location)
                  .catch((reason) =>
                    setError(actionMessage(reason, 'The backup folder could not be opened.')),
                  )
              }
            >
              Open folder
            </Button>
          )}
        </div>
      </div>

      <div className="imnota-backup-manual">
        <label className="field">
          <span className="field-label">Project to snapshot</span>
          <select
            aria-label="Project to snapshot"
            value={selectedProjectPath}
            disabled={!projects.length || disabled || Boolean(busy)}
            onChange={(event) => setSelectedProjectPath(event.target.value)}
          >
            {!projects.length && <option value="">No projects in this workspace</option>}
            {projects.map((project) => (
              <option value={project.projectPath} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          disabled={!selectedProjectPath || disabled || Boolean(busy)}
          onClick={() =>
            void run('create', async () => {
              const created = await window.imnota.createBackupSnapshot({ projectPath: selectedProjectPath });
              await loadHistory();
              setStatus(
                created.warnings?.length
                  ? `Snapshot created for ${created.sourceProjectName}. ${created.warnings.join(' ')}`
                  : `Snapshot created for ${created.sourceProjectName}.`,
              );
              await selectSnapshot(created.snapshotId);
            })
          }
        >
          <History size={15} aria-hidden="true" />
          {busy === 'create' ? 'Creating…' : 'Create snapshot'}
        </Button>
      </div>

      {error && (
        <p className="imnota-preference-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="imnota-backup-status" role="status">
          <CheckCircle2 size={14} aria-hidden="true" /> {status}
        </p>
      )}
      {history?.invalid.length ? (
        <div className="imnota-backup-warning" role="alert">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            {history.invalid.length} incomplete or corrupt snapshot{history.invalid.length === 1 ? '' : 's'}{' '}
            were skipped. No project files were changed.
          </span>
        </div>
      ) : null}
      {history?.recoveryMessages?.map((recoveryMessage) => (
        <div className="imnota-backup-warning" role="status" key={recoveryMessage}>
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{recoveryMessage}</span>
        </div>
      ))}
      {committedRestore && (
        <div className="imnota-restore-open-error" role="alert">
          <ShieldAlert size={16} aria-hidden="true" />
          <div>
            <strong>Restore completed, but the project did not reopen.</strong>
            <p>{committedRestore.openError}</p>
            <p>Retry opening this project. Do not run Restore again.</p>
            <span className="imnota-restore-path">Restored project: {committedRestore.projectPath}</span>
            {committedRestore.rollbackPath && (
              <span className="imnota-restore-path">
                Full pre-restore project: {committedRestore.rollbackPath}
              </span>
            )}
            {committedRestore.warnings?.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <Button
              variant="soft"
              disabled={Boolean(busy)}
              onClick={() =>
                void run('retry-open', async () => {
                  const snapshot = await window.imnota.loadProject(committedRestore.projectPath);
                  const reopened = { ...committedRestore, snapshot, openError: undefined };
                  setCommittedRestore(null);
                  setStatus('The restored project reopened successfully.');
                  await handleRestoreResult(reopened);
                })
              }
            >
              <FolderOpen size={14} aria-hidden="true" />
              {busy === 'retry-open' ? 'Opening…' : 'Retry opening project'}
            </Button>
          </div>
        </div>
      )}

      <div className="imnota-history-layout">
        <div className="imnota-history-list" aria-label="Project snapshots" aria-busy={loading}>
          {loading ? (
            <p className="imnota-history-empty">Loading local history…</p>
          ) : history?.snapshots.length ? (
            history.snapshots.map((snapshot) => (
              <button
                type="button"
                key={snapshot.snapshotId}
                className="imnota-history-row"
                aria-pressed={selectedSnapshotId === snapshot.snapshotId}
                disabled={Boolean(busy && busy !== 'inspect')}
                onClick={() => void selectSnapshot(snapshot.snapshotId)}
              >
                <Archive size={16} aria-hidden="true" />
                <span>
                  <strong>{snapshot.sourceProjectName}</strong>
                  <small>
                    {REASON_LABELS[snapshot.reason]} · {new Date(snapshot.createdAt).toLocaleString()}
                  </small>
                </span>
                <small>{formatBytes(snapshot.totalSize)}</small>
              </button>
            ))
          ) : (
            <div className="imnota-history-empty">
              <Clock3 size={20} aria-hidden="true" />
              <strong>No snapshots yet</strong>
              <span>Create one manually, or enable automatic local history.</span>
            </div>
          )}
        </div>

        <div className="imnota-history-detail" aria-live="polite">
          {!selectedSnapshotId ? (
            <p>Select a snapshot to validate and review its restore options.</p>
          ) : busy === 'inspect' ? (
            <p>Validating every file…</p>
          ) : inspection ? (
            <>
              <div className="imnota-history-detail-heading">
                <div>
                  <strong>{inspection.summary.sourceProjectName}</strong>
                  <span>Schema {inspection.summary.schemaVersion}</span>
                </div>
                <span>{inspection.summary.fileCount} validated files</span>
              </div>
              <dl>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(inspection.summary.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{REASON_LABELS[inspection.summary.reason]}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(inspection.summary.totalSize)}</dd>
                </div>
              </dl>
              <div className="imnota-history-actions">
                <Button
                  variant="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('restore-new', async () => {
                      const result = await window.imnota.restoreBackupSnapshot({
                        snapshotId: inspection.summary.snapshotId,
                        mode: 'new',
                      });
                      setStatus(
                        result.snapshot
                          ? 'Snapshot restored as a new project. The source project was untouched.'
                          : 'Snapshot restored as a new project, but it must be reopened.',
                      );
                      await handleRestoreResult(result);
                    })
                  }
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Restore as new project
                </Button>
                <Button
                  variant="soft"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('export', async () => {
                      const result = await window.imnota.exportBackupSnapshot({
                        snapshotId: inspection.summary.snapshotId,
                      });
                      if (!result.cancelled) setStatus('Backup archive exported.');
                    })
                  }
                >
                  <Download size={14} aria-hidden="true" /> Export archive
                </Button>
              </div>
              {inPlaceProject && !confirmInPlace && (
                <button
                  type="button"
                  className="imnota-restore-in-place-link"
                  onClick={() => setConfirmInPlace(true)}
                >
                  Restore in place…
                </button>
              )}
              {confirmInPlace && inPlaceProject && (
                <div className="imnota-restore-confirm" role="alert">
                  <ShieldAlert size={16} aria-hidden="true" />
                  <div>
                    <strong>Replace the current files in {inPlaceProject.name}?</strong>
                    <p>A safety snapshot is created first. Imnota will ask once more in a native dialog.</p>
                    <div>
                      <Button variant="ghost" onClick={() => setConfirmInPlace(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run('restore-in-place', async () => {
                            let result: BackupRestoreResult;
                            try {
                              result = await window.imnota.restoreBackupSnapshot({
                                snapshotId: inspection.summary.snapshotId,
                                mode: 'in-place',
                                projectPath: inPlaceProject.projectPath,
                                confirmation: 'RESTORE',
                              });
                            } catch (reason) {
                              // Native restore closes its old watch before staging. Even a
                              // failed attempt needs a fresh renderer-owned watch grant.
                              onRestoreFailed?.();
                              throw reason;
                            }
                            setConfirmInPlace(false);
                            setStatus(
                              result.snapshot
                                ? 'Project restored in place. A safety snapshot is available in history.'
                                : 'Project restored in place, but it must be reopened.',
                            );
                            await handleRestoreResult(result);
                          })
                        }
                      >
                        Restore in place
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p>This snapshot could not be validated. Restore and export remain unavailable.</p>
          )}
        </div>
      </div>
    </section>
  );
}
