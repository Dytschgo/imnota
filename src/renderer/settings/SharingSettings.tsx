import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Link2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { HostedShareRecord, HostedShareRecoveryWarning } from '../../shared/workflow-bridge';
import { Button, Modal } from '../components/ui';
import { useSharingSenderName } from './sharing-preferences';
import './sharing-settings.css';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function statusFor(record: HostedShareRecord): 'active' | 'expired' | 'revoked' {
  if (record.revokedAt) return 'revoked';
  return Date.parse(record.expiresAt) <= Date.now() ? 'expired' : 'active';
}

export function SharingSettings() {
  const name = useSharingSenderName();
  const [records, setRecords] = useState<readonly HostedShareRecord[]>([]);
  const [recoveryWarnings, setRecoveryWarnings] = useState<readonly HostedShareRecoveryWarning[]>([]);
  const [legacyRecoveryErrors, setLegacyRecoveryErrors] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [busyWarning, setBusyWarning] = useState<string>();
  const [copiedId, setCopiedId] = useState<string>();
  const [revokeTarget, setRevokeTarget] = useState<HostedShareRecord>();
  const [revoking, setRevoking] = useState(false);
  const mounted = useRef(true);
  const historyRequest = useRef(0);
  const revokeRequest = useRef(0);
  const copiedTimer = useRef<number>();
  const mutationBusy = Boolean(busyWarning) || revoking;
  const mutationBusyRef = useRef(mutationBusy);
  mutationBusyRef.current = mutationBusy;

  const refresh = useCallback(async () => {
    if (mutationBusyRef.current) return;
    const request = ++historyRequest.current;
    setLoading(true);
    setHistoryError('');
    let result: Awaited<ReturnType<typeof window.imnota.listHostedShares>>;
    try {
      result = await window.imnota.listHostedShares();
    } catch {
      if (mounted.current && request === historyRequest.current)
        setHistoryError('Shared links could not be loaded from this device.');
      if (mounted.current && request === historyRequest.current) setLoading(false);
      return;
    }
    if (!mounted.current || request !== historyRequest.current) return;
    setLoading(false);
    if (!result.ok) {
      setHistoryError(result.error.message);
      return;
    }
    setRecords(result.value.records);
    setRecoveryWarnings(result.value.recoveryWarnings ?? []);
    setLegacyRecoveryErrors(
      result.value.recoveryWarnings === undefined ? result.value.recoveryErrors : [],
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      historyRequest.current += 1;
      revokeRequest.current += 1;
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
    };
  }, [refresh]);

  const copyLink = async (record: HostedShareRecord) => {
    setHistoryError('');
    try {
      await window.imnota.copyText(record.url);
      if (!mounted.current) return;
      setCopiedId(record.id);
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        if (mounted.current) setCopiedId(undefined);
      }, 1800);
    } catch {
      if (mounted.current) setHistoryError('The link could not be copied. Try again.');
    }
  };

  const dismissWarning = async (warning: HostedShareRecoveryWarning) => {
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusyWarning(warning.id);
    setHistoryError('');
    try {
      const result = await window.imnota.dismissHostedShareRecoveryWarning({ id: warning.id });
      if (!mounted.current) return;
      if (!result.ok) {
        setHistoryError(result.error.message || 'The warning could not be dismissed.');
        return;
      }
      historyRequest.current += 1;
      setLoading(false);
      setRecoveryWarnings((items) => items.filter((item) => item.id !== warning.id));
    } catch {
      if (mounted.current) setHistoryError('The warning could not be dismissed. Try again.');
    } finally {
      mutationBusyRef.current = false;
      if (mounted.current) setBusyWarning(undefined);
    }
  };

  const revoke = async () => {
    if (!revokeTarget || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    const request = ++revokeRequest.current;
    const target = revokeTarget;
    setRevoking(true);
    setHistoryError('');
    let result: Awaited<ReturnType<typeof window.imnota.revokeHostedShare>>;
    try {
      result = await window.imnota.revokeHostedShare({ id: target.id });
    } catch {
      if (mounted.current && request === revokeRequest.current)
        setHistoryError('The link could not be revoked. Try again.');
      if (mounted.current && request === revokeRequest.current) setRevoking(false);
      mutationBusyRef.current = false;
      return;
    }
    if (!mounted.current || request !== revokeRequest.current) return;
    setRevoking(false);
    mutationBusyRef.current = false;
    if (!result.ok) {
      setHistoryError(result.error.message);
      return;
    }
    historyRequest.current += 1;
    setLoading(false);
    setRecords((items) =>
      items.map((item) => (item.id === result.value.id ? result.value : item)),
    );
    setRevokeTarget(undefined);
  };

  return (
    <section className="sharing-settings" data-testid="sharing-settings" aria-labelledby="sharing-title">
      <header className="imnota-preference-heading">
        <div>
          <h2 id="sharing-title">Your name</h2>
          <p>Show this optional name on new hosted share pages. Existing links keep their original name.</p>
        </div>
      </header>
      <form
        className="sharing-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void name.saveSenderName();
        }}
      >
        <label htmlFor="sharing-sender-name">
          <strong>Sender name</strong>
          <span>Optional · 80 characters maximum</span>
        </label>
        <div className="sharing-name-control">
          <input
            id="sharing-sender-name"
            data-testid="sharing-sender-name"
            type="text"
            autoComplete="name"
            value={name.senderName}
            disabled={name.saving}
            aria-invalid={Boolean(name.error) || undefined}
            aria-describedby={name.error ? 'sharing-name-error' : undefined}
            onChange={(event) => name.setSenderName(event.target.value)}
            onBlur={() => void name.saveSenderName()}
          />
          <Button type="submit" variant="soft" busy={name.saving}>
            Save name
          </Button>
        </div>
      </form>
      {name.error && (
        <p id="sharing-name-error" className="imnota-preference-error" role="alert">
          {name.error}
        </p>
      )}

      <section className="sharing-ledger" aria-labelledby="sharing-links-title">
        <header>
          <div>
            <h2 id="sharing-links-title">Your shared links</h2>
            <p>Copy, open, or revoke links saved on this device.</p>
          </div>
          <Button variant="ghost" disabled={loading || mutationBusy} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
        </header>

        {(recoveryWarnings.length > 0 || legacyRecoveryErrors.length > 0) && (
          <div className="sharing-recovery" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>An earlier share needs attention</strong>
              {recoveryWarnings.map((warning) => (
                <div className="sharing-warning" key={warning.id}>
                  <span>{warning.message}</span>
                  <Button
                    variant="ghost"
                    busy={busyWarning === warning.id}
                    disabled={mutationBusy}
                    onClick={() => void dismissWarning(warning)}
                  >
                    Dismiss
                  </Button>
                </div>
              ))}
              {legacyRecoveryErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
              <Button variant="ghost" disabled={loading || mutationBusy} onClick={() => void refresh()}>
                Retry recovery
              </Button>
            </div>
          </div>
        )}

        {historyError && (
          <div className="sharing-history-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{historyError}</span>
            <Button variant="ghost" disabled={loading || mutationBusy} onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        )}

        {loading && records.length === 0 ? (
          <div className="sharing-placeholder" role="status">
            <RefreshCw className="spin" size={16} aria-hidden="true" /> Loading shared links…
          </div>
        ) : records.length === 0 && !historyError ? (
          <div className="sharing-empty">
            <Link2 size={18} aria-hidden="true" />
            <div>
              <strong>No links saved on this device</strong>
              <p>Create a hosted link from a prepared prompt bundle and it will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="sharing-list">
            {records.map((record) => {
              const status = statusFor(record);
              const available = status === 'active';
              return (
                <article className="sharing-row" key={record.id}>
                  <div className="sharing-row-copy">
                    <div>
                      <strong>{record.title}</strong>
                      <span className={`sharing-status sharing-status-${status}`}>{status}</span>
                    </div>
                    <p>
                      Created {formatDate(record.createdAt)} ·{' '}
                      {status === 'revoked'
                        ? `revoked ${formatDate(record.revokedAt!)}`
                        : status === 'expired'
                          ? `expired ${formatDate(record.expiresAt)}`
                          : `expires ${formatDate(record.expiresAt)}`}
                    </p>
                  </div>
                  {available && (
                    <div className="sharing-row-actions">
                      <Button
                        variant="ghost"
                        disabled={mutationBusy}
                        onClick={() => void copyLink(record)}
                      >
                        {copiedId === record.id ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <Copy size={14} aria-hidden="true" />
                        )}
                        {copiedId === record.id ? 'Copied' : 'Copy'}
                      </Button>
                      <a className="btn btn-ghost" href={record.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} aria-hidden="true" /> Open
                      </a>
                      <Button
                        variant="ghost"
                        disabled={mutationBusy}
                        onClick={() => setRevokeTarget(record)}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Revoke
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {revokeTarget && (
        <Modal
          title="Revoke this hosted link?"
          description="Anyone using this link will lose access immediately. This cannot be undone."
          onClose={revoking ? () => undefined : () => setRevokeTarget(undefined)}
        >
          <div className="modal-form">
            <p>{revokeTarget.title}</p>
            <div className="modal-actions">
              <Button disabled={revoking} onClick={() => setRevokeTarget(undefined)}>
                Keep link
              </Button>
              <Button variant="danger" busy={revoking} onClick={() => void revoke()}>
                Revoke link
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
