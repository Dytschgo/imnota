import { useState } from 'react';
import type { AgentHandoffReview, PromptBundleControllerActionResult } from './prompt-export-controller-core';
import { Button, Modal, TextArea } from '../components/ui';
import { workflowMessage } from '../app/workflow';

export function AgentHandoffDialog({
  handoff,
  onClose,
  onOpenSavedFiles,
}: {
  handoff: AgentHandoffReview;
  onClose(): void;
  onOpenSavedFiles(): Promise<PromptBundleControllerActionResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function act(action: 'copy' | 'open') {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'copy') {
        const result = await window.imnota.copyPromptExportMarkdown(handoff.instruction);
        if (!result.ok) throw new Error(result.error.message);
        setMessage('Agent instruction copied. Paste it into your configured agent.');
      } else {
        const result = await onOpenSavedFiles();
        if (!result.ok) throw new Error(result.error.message);
        setMessage('Saved files opened.');
      }
    } catch (reason) {
      setError(workflowMessage(reason, 'The action failed. Retry or open the saved files.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Send saved bundle to agent"
      description="This handoff identifies an exact saved export. Later collection edits are not included."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-form" style={{ overflowWrap: 'anywhere' }}>
        <p>
          <strong>{handoff.collectionName}</strong> · Bundle {handoff.bundleNumber}
        </p>
        <p>
          {handoff.pictureNumbers.length ? `Pictures ${handoff.pictureNumbers.join(', ')}` : 'No pictures'} ·{' '}
          {handoff.textCount} {handoff.textCount === 1 ? 'text block' : 'text blocks'}
        </p>
        <p>Saved export: {handoff.setName}</p>
        <p role="status">
          {handoff.freshness === 'current'
            ? 'Matched the saved collection when checked.'
            : handoff.freshness === 'changed'
              ? 'The collection has changed since this export. This handoff still uses the saved evidence.'
              : 'Current edits could not be compared. This handoff uses the saved evidence.'}
        </p>
        {!handoff.agentAccessEnabled && (
          <p role="status">
            Local agent access is off. Enable it in Settings → Features. Use Copy prompt to configure your
            agent, then reopen this handoff. No settings have been changed.
          </p>
        )}
        <TextArea label="Agent instruction" value={handoff.instruction} readOnly rows={7} />
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <Button disabled={busy} onClick={onClose}>
            Done
          </Button>
          <Button disabled={busy} onClick={() => void act('open')}>
            Open saved files
          </Button>
          <Button
            variant="primary"
            disabled={busy || !handoff.agentAccessEnabled}
            onClick={() => void act('copy')}
          >
            Copy agent instruction
          </Button>
        </div>
      </div>
    </Modal>
  );
}
