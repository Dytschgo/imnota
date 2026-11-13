import { useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../components/ui';
import {
  agentAccessSetupPrompt,
  localAgentAccessHttpSnippet,
  localAgentAccessStdioSnippet,
  localAgentAccessUrl,
  type PreferenceSettings,
} from './preferences';
import './agent-access-settings.css';

export function AgentAccessSettings({
  value,
  disabled,
  onChange,
}: {
  value: PreferenceSettings['agentAccess'];
  disabled: boolean;
  onChange(value: PreferenceSettings['agentAccess']): void | Promise<void>;
}) {
  const [copied, setCopied] = useState('');
  const [copying, setCopying] = useState('');
  const [copyError, setCopyError] = useState('');
  const [attempted, setAttempted] = useState('');
  const copyBusy = useRef(false);
  const copySnippet = async (label: string, snippet: string) => {
    if (copyBusy.current) return;
    copyBusy.current = true;
    setCopied('');
    setCopyError('');
    setCopying(label);
    setAttempted(label);
    try {
      await window.imnota.copyText(snippet);
      setCopied(label);
    } catch {
      setCopyError('Could not copy. Try again, or select and copy the text below.');
    } finally {
      copyBusy.current = false;
      setCopying('');
    }
  };
  const copyFeedback = (label: string) =>
    attempted === label && (
      <div className="agent-access-copy-feedback">
        <p role="status">
          {copying
            ? 'Copying…'
            : copied
              ? `${copied === 'prompt' ? 'Setup prompt' : copied === 'http' ? 'HTTP configuration' : 'Stdio configuration'} copied to clipboard.`
              : ''}
        </p>
        {copyError && (
          <p role="alert" className="imnota-preference-error">
            {copyError}
          </p>
        )}
      </div>
    );
  return (
    <section className="settings-section" aria-labelledby="agent-access-title">
      <h2 id="agent-access-title">
        MCP access <span className="feature-status beta">Beta</span>
      </h2>
      <label className="settings-switch">
        <span>
          <strong>Allow local agent access</strong>
          <small>
            Lets a coding agent read prepared prompt bundles from this workspace over MCP. Off by default. The
            listener binds only to {localAgentAccessUrl()} or a spawned <kbd>--mcp</kbd> stdio process. Imnota
            does not write any editor or agent configuration.
          </small>
        </span>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          data-testid="agent-access-toggle"
          onChange={(event) => void onChange({ enabled: event.target.checked })}
        />
      </label>
      <div className="agent-access-flow">
        <svg viewBox="0 0 300 64" aria-hidden="true" focusable="false">
          <rect x="2" y="8" width="62" height="48" rx="8" />
          <path d="M18 21h28M18 32h28M18 43h18" />
          <path className="agent-access-flow-route" d="M76 32h146m-9-8 9 8-9 8" />
          <rect x="234" y="8" width="62" height="48" rx="8" />
          <path d="m256 23-9 9 9 9m17-18 9 9-9 9" />
        </svg>
        <div>
          <strong>Prepared bundles &rarr; your agent</strong>
          <p>Enable access, copy the setup prompt, then paste it into your agent.</p>
          <p>
            Your agent reads saved exports. Prepare a new bundle after editing to share the latest changes.
          </p>
        </div>
      </div>
      <div className="settings-snippet">
        <div className="settings-snippet-heading">
          <strong>Setup prompt for any agent</strong>
          <Button
            variant="ghost"
            disabled={Boolean(copying)}
            busy={copying === 'prompt'}
            onClick={() => void copySnippet('prompt', agentAccessSetupPrompt())}
          >
            <Copy size={14} aria-hidden="true" />
            {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
        {copyFeedback('prompt')}
        <p className="settings-snippet-note">
          Paste this into whichever agent you use. It contains the transport, the tool list, and the
          instruction to write its own MCP configuration.
        </p>
        <pre data-testid="agent-access-prompt">{agentAccessSetupPrompt()}</pre>
      </div>
      <details className="settings-disclosure">
        <summary>Configuration reference</summary>
        <p className="settings-snippet-note">
          Generic <code>mcpServers</code> entries, if you prefer to edit the configuration yourself.
        </p>
        <div className="settings-snippet">
          <div className="settings-snippet-heading">
            <strong>HTTP</strong>
            <Button
              variant="ghost"
              disabled={Boolean(copying)}
              busy={copying === 'http'}
              onClick={() => void copySnippet('http', localAgentAccessHttpSnippet())}
            >
              <Copy size={14} aria-hidden="true" />
              {copied === 'http' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copyFeedback('http')}
          <pre>{localAgentAccessHttpSnippet()}</pre>
        </div>
        <div className="settings-snippet">
          <div className="settings-snippet-heading">
            <strong>Stdio</strong>
            <Button
              variant="ghost"
              disabled={Boolean(copying)}
              busy={copying === 'stdio'}
              onClick={() => void copySnippet('stdio', localAgentAccessStdioSnippet())}
            >
              <Copy size={14} aria-hidden="true" />
              {copied === 'stdio' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copyFeedback('stdio')}
          <pre>{localAgentAccessStdioSnippet()}</pre>
        </div>
        <p className="settings-snippet-note">
          Optional skill and rule files are in the documentation. Imnota never writes agent configuration for
          you.
        </p>
      </details>
    </section>
  );
}
