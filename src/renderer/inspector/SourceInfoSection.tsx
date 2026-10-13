import { X } from 'lucide-react';
import type { ScreenshotRecord } from '../../shared/types';
import type { ScreenshotSource } from '../../shared/source-context';
import { Button, TextInput } from '../components/ui';

export interface SourceInfoSectionProps {
  source: ScreenshotSource | undefined;
  /** Whether new captures and exports use source info (Settings → Features). */
  enabled: boolean;
  onUpdateShot(patch: Partial<ScreenshotRecord>): void;
}

type EditableField = 'app' | 'windowTitle' | 'url';

/** Recorded source of a screenshot: editable, removable, never sent anywhere by Imnota. */
export function SourceInfoSection({ source, enabled, onUpdateShot }: SourceInfoSectionProps) {
  const update = (field: EditableField, value: string) => {
    if (!source) return;
    const next: ScreenshotSource = { ...source };
    if (value) next[field] = value;
    else delete next[field];
    onUpdateShot({ source: next });
  };
  const time = source ? new Date(source.capturedAt) : null;
  return (
    <section className="inspector-section source-section" aria-labelledby="source-heading">
      <span className="section-label" id="source-heading">
        Source
      </span>
      {!source ? (
        <p className="section-intro">
          {enabled
            ? 'No source info was recorded for this screenshot.'
            : 'Source info is off. Turn it on in Settings → Features to record it for new screenshots.'}
        </p>
      ) : (
        <>
          <p className="section-intro">
            {source.via === 'capture' ? 'Captured' : 'Imported'}{' '}
            {time && !Number.isNaN(time.getTime()) ? time.toLocaleString() : source.capturedAt}
            {source.display ? ` · ${source.display}` : ''}.{' '}
            {enabled ? 'Written into exported Markdown.' : 'Not exported while source info is off.'}
          </p>
          <TextInput
            label="App"
            value={source.app ?? ''}
            maxLength={300}
            onChange={(event) => update('app', event.target.value)}
          />
          <TextInput
            label="Window title"
            value={source.windowTitle ?? ''}
            maxLength={300}
            onChange={(event) => update('windowTitle', event.target.value)}
          />
          <TextInput
            label="URL"
            type="url"
            placeholder="https://"
            value={source.url ?? ''}
            maxLength={2000}
            onChange={(event) => update('url', event.target.value)}
          />
          <Button variant="ghost" onClick={() => onUpdateShot({ source: undefined })}>
            <X size={15} aria-hidden="true" />
            Remove source info
          </Button>
        </>
      )}
    </section>
  );
}
