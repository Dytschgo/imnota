import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, Square, Trash2 } from 'lucide-react';
import type { HostedShareRecord, HostedShareRecoveryWarning } from '../../shared/workflow-bridge';
import type { HostedShareArtifacts } from './prompt-export-controller-core';
import { Button, Modal, TextInput } from '../components/ui';
import './hosted-share.css';

function requestId() {
  return crypto.randomUUID();
}
function formatExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function isExpired(record: HostedShareRecord) {
  return Date.parse(record.expiresAt) <= Date.now();
}

export function HostedShareDialog({
  artifacts,
  onClose,
  onError,
}: {
  artifacts: HostedShareArtifacts;
  onClose(): void;
  onError(message: string): void;
}) {
  const imageCount = artifacts.imageBundleNumbers.length;
  const quotaProblem =
    imageCount > 20
      ? `This export has ${imageCount} PNGs; hosted sharing accepts up to 20. Exclude or split collection content, then prepare a fresh export.`
      : undefined;
  const [token, setToken] = useState('');
  const [approved, setApproved] = useState(false);
  const [includeArchive, setIncludeArchive] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState(1);
  const [senderName, setSenderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [record, setRecord] = useState<HostedShareRecord>();
  const [request, setRequest] = useState<string>();
  const [history, setHistory] = useState<readonly HostedShareRecord[]>([]);
  const [recoveryErrors, setRecoveryErrors] = useState<readonly string[]>([]);
  const [recoveryWarnings, setRecoveryWarnings] = useState<readonly HostedShareRecoveryWarning[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<HostedShareRecord>();
  const mounted = useRef(true);
  const historyRequest = useRef(0);
  const refreshHistory = useCallback(async ({ reportError = true } = {}) => {
    const request = ++historyRequest.current;
    let result: Awaited<ReturnType<typeof window.imnota.listHostedShares>>;
    try {
      result = await window.imnota.listHostedShares();
    } catch {
      if (mounted.current && request === historyRequest.current && reportError) {
        setError('Could not refresh hosted share history. Try again.');
      }
      return false;
    }
    if (!mounted.current || request !== historyRequest.current) return false;
    if (result.ok) {
      setHistory(result.value.records);
      setRecoveryErrors(result.value.recoveryErrors);
      setRecoveryWarnings(result.value.recoveryWarnings ?? []);
      return true;
    }
    if (reportError) setError(result.error.message);
    return false;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    return () => {
      mounted.current = false;
    };
  }, [refreshHistory]);
  const upload = async () => {
    if (quotaProblem) {
      setError(quotaProblem);
      return;
    }
    const id = request ?? requestId();
    setRequest(id);
    setBusy(true);
    setError(undefined);
    const result = await window.imnota.createHostedShare({
      requestId: id,
      pairingToken: token.trim(),
      sessionId: artifacts.sessionId,
      bundleNumbers: artifacts.bundleNumbers,
      includeArchive,
      expiresInDays,
      senderName: senderName.trim() || undefined,
    });
    if (!mounted.current) return;
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      if (result.error.details?.requestMayHaveCommitted === false) setRequest(undefined);
      return;
    }
    setRecord(result.value);
    setHistory((items) => [result.value, ...items.filter((item) => item.id !== result.value.id)]);
    setError(undefined);
    setBusy(false);
    void refreshHistory({ reportError: false });
  };
  const retryRecovery = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await refreshHistory();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const dismissRecovery = async () => {
    if (busy) return;
    setBusy(true);
    historyRequest.current += 1;
    try {
      for (const warning of recoveryWarnings) {
        const result = await window.imnota.dismissHostedShareRecoveryWarning({ id: warning.id });
        if (!result.ok) {
          if (mounted.current) setError('Could not dismiss this warning. Try again.');
          return;
        }
      }
      if (mounted.current) {
        setRecoveryWarnings([]);
        setRecoveryErrors([]);
        setError(undefined);
      }
    } catch {
      if (mounted.current) setError('Could not dismiss this warning. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (request) await window.imnota.cancelHostedShare({ requestId: request });
  };
  const revoke = async () => {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    setRevokeTarget(undefined);
    setBusy(true);
    setError(undefined);
    const result = await window.imnota.revokeHostedShare({ id });
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (record?.id === result.value.id) setRecord(result.value);
    historyRequest.current += 1;
    setHistory((items) => items.map((item) => (item.id === result.value.id ? result.value : item)));
  };
  const recordExpired = record ? isExpired(record) : false;
  const recordUnavailable = Boolean(record?.revokedAt) || recordExpired;
  return (
    <Modal
      title="Share your bundle"
      onClose={busy ? () => undefined : onClose}
      closeTestId="hosted-share-close"
    >
      <section className="hosted-share" aria-busy={busy}>
        {!record ? (
          <>
            <h3 className="hosted-share-step">1. Check your bundle</h3>
            <div className="hosted-share-manifest">
              <strong>{artifacts.title}</strong>
              <span>
                Markdown · {imageCount} PNG
                {imageCount === 1 ? '' : 's'}
              </span>
              <details className="hosted-share-file-details">
                <summary>Included files</summary>
                <ul>
                  <li>prompt.md</li>
                  {artifacts.imageBundleNumbers.map((number) => (
                    <li key={number}>prompt-{String(number).padStart(3, '0')}.png</li>
                  ))}
                </ul>
              </details>
            </div>
            <TextInput
              label="Your name (optional)"
              value={senderName}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setSenderName(event.target.value)}
              placeholder="e.g. Dylan"
            />
            <h3 className="hosted-share-step">2. Choose who can open it</h3>
            {quotaProblem && (
              <p className="hosted-share-error" role="alert">
                <AlertTriangle size={15} />
                {quotaProblem}
              </p>
            )}
            <label className="hosted-share-check">
              <input
                type="checkbox"
                disabled={Boolean(quotaProblem)}
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />{' '}
              Anyone with the link can view and download this bundle until it expires or I revoke it.
            </label>
            <div className="hosted-share-options">
              <label>
                <span>Expires after</span>
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </label>
              <label className="hosted-share-check">
                <input
                  type="checkbox"
                  checked={includeArchive}
                  onChange={(event) => setIncludeArchive(event.target.checked)}
                />{' '}
                Include downloadable ZIP
              </label>
            </div>
            <details className="hosted-share-info">
              <summary>
                <Info size={14} aria-hidden="true" /> About sharing
              </summary>
              <p>
                Only this bundle is uploaded. Copies already saved by someone else stay with them. The site
                records views and downloads; the hosting provider may keep access logs.
              </p>
            </details>
            <details className="hosted-share-info">
              <summary>Use a pairing code instead</summary>
              <Button
                variant="soft"
                disabled={Boolean(quotaProblem)}
                onClick={() =>
                  void window.imnota
                    .openHostedSharePairing()
                    .then((result) => !result.ok && onError(result.error.message))
                }
              >
                <ExternalLink size={14} /> Get a pairing code
              </Button>
              <TextInput
                label="Pairing code"
                disabled={Boolean(quotaProblem)}
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste your code"
              />
            </details>
            {busy && (
              <p className="hosted-share-progress" role="status">
                Creating your link…
              </p>
            )}
            <footer className="hosted-share-actions">
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Back
              </Button>
              {busy ? (
                <Button variant="soft" onClick={() => void cancel()}>
                  <Square size={13} /> Cancel upload
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="hosted-share-create"
                  disabled={Boolean(quotaProblem) || !approved}
                  onClick={() => void upload()}
                >
                  Create link
                </Button>
              )}
            </footer>
          </>
        ) : (
          <div className={`hosted-share-success${recordUnavailable ? ' is-unavailable' : ''}`}>
            {recordUnavailable ? (
              <AlertTriangle size={22} aria-hidden="true" />
            ) : (
              <Check size={22} aria-hidden="true" />
            )}
            <h3>
              {record.revokedAt ? 'Link revoked' : recordExpired ? 'Link expired' : 'Your link is ready'}
            </h3>
            <p>
              {record.revokedAt
                ? 'The published link can no longer be opened.'
                : recordExpired
                  ? `The published link expired ${formatExpiry(record.expiresAt)} and can no longer be opened.`
                  : `Anyone with the link can open it until ${formatExpiry(record.expiresAt)}.`}
            </p>
            <TextInput label="Share link" readOnly value={record.url} />
            <div className="hosted-share-actions">
              {!recordUnavailable && (
                <>
                  <Button variant="soft" onClick={() => void window.imnota.copyText(record.url)}>
                    <Copy size={14} /> Copy link
                  </Button>
                  <a className="btn btn-primary" href={record.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Open link
                  </a>
                </>
              )}
              <Button
                variant="danger"
                busy={busy}
                disabled={recordUnavailable}
                onClick={() => setRevokeTarget(record)}
              >
                <Trash2 size={14} />{' '}
                {record.revokedAt ? 'Revoked' : recordExpired ? 'Expired' : 'Revoke link'}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p className="hosted-share-error" role="alert">
            <AlertTriangle size={15} />
            {error}
          </p>
        )}
        {recoveryErrors.length > 0 && (
          <div className="hosted-share-recovery-errors" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <div>
              <strong>An earlier share needs attention</strong>
              {recoveryErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
              <div className="hosted-share-actions">
                <Button variant="ghost" disabled={busy} onClick={() => void retryRecovery()}>
                  Retry recovery
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void dismissRecovery()}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}
        {history.length > 0 && (
          <details className="hosted-share-history">
            <summary>Your shared links ({history.length})</summary>
            {history.map((item) => {
              const expired = isExpired(item);
              const unavailable = Boolean(item.revokedAt) || expired;
              return (
                <div key={item.id} className="hosted-share-history-row">
                  <p>
                    {item.title} ·{' '}
                    {item.revokedAt
                      ? 'revoked'
                      : expired
                        ? 'expired'
                        : `expires ${formatExpiry(item.expiresAt)}`}
                  </p>
                  {!unavailable && (
                    <>
                      <Button variant="ghost" onClick={() => void window.imnota.copyText(item.url)}>
                        Copy
                      </Button>
                      <a className="btn btn-ghost" href={item.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    disabled={unavailable || busy}
                    onClick={() => setRevokeTarget(item)}
                  >
                    {item.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Revoke'}
                  </Button>
                </div>
              );
            })}
          </details>
        )}
        <a
          className="hosted-share-owner-link"
          href="https://app.imnota.xyz/owner"
          target="_blank"
          rel="noreferrer"
        >
          Site owner dashboard <ExternalLink size={12} aria-hidden="true" />
        </a>
        {revokeTarget && (
          <Modal
            title="Revoke this hosted link?"
            description="Anyone using this link will lose access immediately. This cannot be undone."
            onClose={() => setRevokeTarget(undefined)}
          >
            <div className="modal-form">
              <p>{revokeTarget.title}</p>
              <div className="modal-actions">
                <Button onClick={() => setRevokeTarget(undefined)}>Keep link</Button>
                <Button variant="danger" onClick={() => void revoke()}>
                  Revoke link
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </section>
    </Modal>
  );
}
