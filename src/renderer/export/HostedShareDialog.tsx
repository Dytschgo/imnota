import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, ShieldCheck, Square, Trash2 } from 'lucide-react';
import type { HostedShareRecord } from '../../shared/workflow-bridge';
import type { HostedShareArtifacts } from './prompt-export-controller-core';
import { Button, Modal, TextInput } from '../components/ui';
import './hosted-share.css';

function requestId() {
  return crypto.randomUUID();
}
function formatExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
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
  const quotaProblem =
    artifacts.imageCount > 20
      ? `This export has ${artifacts.imageCount} PNGs; hosted sharing accepts up to 20. Exclude or split collection content, then prepare a fresh export.`
      : undefined;
  const [token, setToken] = useState('');
  const [approved, setApproved] = useState(false);
  const [includeArchive, setIncludeArchive] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [record, setRecord] = useState<HostedShareRecord>();
  const [request, setRequest] = useState<string>();
  const [history, setHistory] = useState<readonly HostedShareRecord[]>([]);
  useEffect(() => {
    void window.imnota.listHostedShares().then((result) => result.ok && setHistory(result.value));
  }, []);
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
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRecord(result.value);
    setHistory((items) => [result.value, ...items.filter((item) => item.id !== result.value.id)]);
  };
  const cancel = async () => {
    if (request) await window.imnota.cancelHostedShare({ requestId: request });
  };
  const revoke = async () => {
    if (!record) return;
    setBusy(true);
    const result = await window.imnota.revokeHostedShare({ id: record.id });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRecord(result.value);
    setHistory((items) => items.map((item) => (item.id === result.value.id ? result.value : item)));
  };
  return (
    <Modal
      title="Publish a hosted prompt"
      description="A read-only HTTPS copy is created only after you approve the finalized artifacts below."
      onClose={busy ? () => undefined : onClose}
      closeTestId="hosted-share-close"
    >
      <section className="hosted-share" aria-busy={busy}>
        {!record ? (
          <>
            <div className="hosted-share-privacy">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>Review before upload</strong>
                <p>
                  Imnota will upload only the listed generated Markdown and rendered PNG artifacts. Review
                  their contents before publishing the link.
                </p>
              </div>
            </div>
            <div className="hosted-share-manifest">
              <strong>{artifacts.title}</strong>
              <span>
                1 Markdown file · {artifacts.imageCount} rendered PNG
                {artifacts.imageCount === 1 ? '' : 's'}
              </span>
              <ul>
                <li>prompt.md</li>
                {artifacts.bundleNumbers.map((number) => (
                  <li key={number}>prompt-{String(number).padStart(3, '0')}.png or text-only</li>
                ))}
              </ul>
            </div>
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
              I understand that anyone with the link can read these files until it expires or I revoke it.
            </label>
            <div className="hosted-share-options">
              <label>
                <span>Expires after</span>
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                >
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
            <div className="hosted-share-pair">
              <div>
                <strong>1. Pair this upload</strong>
                <p>
                  Open app.imnota.xyz in your browser, then paste its one-use code here. The code expires in
                  about 10 minutes.
                </p>
              </div>
              <Button
                variant="soft"
                disabled={Boolean(quotaProblem)}
                onClick={() =>
                  void window.imnota
                    .openHostedSharePairing()
                    .then((result) => !result.ok && onError(result.error.message))
                }
              >
                <ExternalLink size={14} /> Open pairing page
              </Button>
            </div>
            <TextInput
              label="2. One-use pairing code"
              disabled={Boolean(quotaProblem)}
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste code from app.imnota.xyz/new"
            />
            {error && (
              <p className="hosted-share-error" role="alert">
                <AlertTriangle size={15} />
                {error}
              </p>
            )}
            <footer className="hosted-share-actions">
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
              {busy ? (
                <Button variant="soft" onClick={() => void cancel()}>
                  <Square size={13} /> Cancel upload
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={Boolean(quotaProblem) || !approved || !token.trim()}
                  onClick={() => void upload()}
                >
                  Publish HTTPS link
                </Button>
              )}
            </footer>
          </>
        ) : (
          <div className="hosted-share-success">
            <Check size={22} aria-hidden="true" />
            <h3>Hosted prompt is ready</h3>
            <p>
              It expires {formatExpiry(record.expiresAt)}. Anyone with this link can view the approved
              artifacts until then.
            </p>
            <TextInput label="Share link" readOnly value={record.url} />
            <div className="hosted-share-actions">
              <Button variant="soft" onClick={() => void window.imnota.copyText(record.url)}>
                <Copy size={14} /> Copy link
              </Button>
              <a className="btn btn-primary" href={record.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Open link
              </a>
              <Button
                variant="danger"
                busy={busy}
                disabled={Boolean(record.revokedAt)}
                onClick={() => void revoke()}
              >
                <Trash2 size={14} /> {record.revokedAt ? 'Revoked' : 'Revoke link'}
              </Button>
            </div>
          </div>
        )}
        {history.length > 0 && (
          <details className="hosted-share-history">
            <summary>Local share history ({history.length})</summary>
            {history.slice(0, 5).map((item) => (
              <p key={item.id}>
                {item.title} · {item.revokedAt ? 'revoked' : `expires ${formatExpiry(item.expiresAt)}`}
              </p>
            ))}
          </details>
        )}
      </section>
    </Modal>
  );
}
