import { ExternalLink, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { UpdateChannel } from '../../shared/types';
import {
  findWhatsNewRelease,
  releaseChannelForVersion,
  type WhatsNewFeature,
  type WhatsNewRelease,
} from '../../shared/whats-new';
import { Button, Modal } from './ui';

export type WhatsNewAction = WhatsNewFeature['action'];

function FeatureCard({
  feature,
  onAction,
}: {
  feature: WhatsNewFeature;
  onAction?(action: WhatsNewAction): void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className="whats-new-card">
      {feature.imageSrc && !imageFailed && (
        <img src={feature.imageSrc} alt="" onError={() => setImageFailed(true)} />
      )}
      <h3>{feature.title}</h3>
      <p>{feature.description}</p>
      {feature.action && (
        <Button variant="soft" onClick={() => onAction?.(feature.action)}>
          Try it now
        </Button>
      )}
    </article>
  );
}

function FeatureCards({
  release,
  onAction,
}: {
  release: WhatsNewRelease;
  onAction?(action: WhatsNewAction): void;
}) {
  return (
    <div className="whats-new-cards">
      {release.features.map((feature) => (
        <FeatureCard key={feature.id} feature={feature} onAction={onAction} />
      ))}
    </div>
  );
}

export function WhatsNewDialog({
  release,
  onClose,
  onLater,
  onAction,
}: {
  release: WhatsNewRelease;
  onClose(): void;
  onLater(): void;
  onAction(action: WhatsNewAction): void;
}) {
  return (
    <Modal title={release.title} description={release.summary} onClose={onClose}>
      <div className="whats-new-dialog" data-testid="whats-new-dialog">
        {release.preview && <p className="whats-new-preview">Nightly preview · feedback welcome</p>}
        <FeatureCards release={release} onAction={onAction} />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onLater}>
            Later
          </Button>
          <Button variant="primary" data-autofocus onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function WhatsNewSettings({
  version,
  channel,
  releaseUrl,
  onReplay,
  onAction,
}: {
  version?: string;
  channel: UpdateChannel;
  releaseUrl?: string;
  onReplay(): void;
  onAction(action: WhatsNewAction): void;
}) {
  const release = findWhatsNewRelease(version);
  const installedChannel = releaseChannelForVersion(version) ?? channel;
  return (
    <section className="settings-section whats-new-settings" aria-labelledby="whats-new-title">
      <div className="whats-new-heading">
        <div>
          <h2 id="whats-new-title">What’s new</h2>
          <p>
            {version ? `Imnota ${version}` : 'Installed version unavailable'}
            {installedChannel === 'nightly' ? ' · Nightly preview' : ' · Stable'}
          </p>
        </div>
        <Sparkles size={18} aria-hidden="true" />
      </div>
      {release ? (
        <>
          <p className="whats-new-summary">{release.summary}</p>
          <FeatureCards release={release} onAction={onAction} />
        </>
      ) : (
        <p className="helper">
          Release guidance for this version is not bundled yet. Your update settings still work.
        </p>
      )}
      <div className="whats-new-actions">
        <Button variant="soft" onClick={onReplay} disabled={!release}>
          Replay what’s new
        </Button>
        {releaseUrl && (
          <a href={releaseUrl} target="_blank" rel="noreferrer">
            Release details <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}
