import { useState } from 'react';
import { Button, Modal } from '../components/ui';
import './prompt-bundles.css';

type PreviewMode = 'fit' | 'width' | 'actual';

export function PromptBundlePreview({
  preview,
  onClose,
}: {
  preview: { bundleNumber: number; dataUrl: string; width: number; height: number };
  onClose(): void;
}) {
  const [mode, setMode] = useState<PreviewMode>('fit');
  return (
    <Modal
      title={`Bundle ${preview.bundleNumber} preview`}
      description={`${preview.width} × ${preview.height}px`}
      variant="preview"
      onClose={onClose}
      closeTestId="prompt-preview-close"
    >
      <div className="prompt-preview-content">
        <div className="prompt-preview-controls" role="group" aria-label="Preview scale">
          {(
            [
              ['fit', 'Fit image'],
              ['width', 'Fit width'],
              ['actual', 'Actual size'],
            ] as const
          ).map(([value, label]) => (
            <Button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
              {label}
            </Button>
          ))}
        </div>
        <div
          key={mode}
          className={`prompt-large-preview prompt-preview-${mode}`}
          data-testid="prompt-large-preview"
          tabIndex={0}
          role="region"
          aria-label="Bundle image, scroll to inspect"
        >
          <img
            src={preview.dataUrl}
            width={preview.width}
            height={preview.height}
            alt={`Full-resolution Bundle ${preview.bundleNumber}`}
          />
        </div>
      </div>
    </Modal>
  );
}
