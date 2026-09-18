import { Monitor } from 'lucide-react';
import type { CaptureDisplayOption } from '../../shared/capture';
import { Button, Modal } from '../components/ui';
import './capture-display-dialog.css';

function displayTitle(display: CaptureDisplayOption): string {
  return display.primary ? 'Primary display' : display.position;
}

function scalePercent(scaleFactor: number): string {
  return `${Math.round(scaleFactor * 100)}% scale`;
}

export function CaptureDisplayDialog({
  displays,
  onSelect,
  onCancel,
}: {
  displays: readonly CaptureDisplayOption[];
  onSelect(displayId: number): void;
  onCancel(): void;
}) {
  return (
    <Modal
      title="Choose a display"
      description="Choose which display supplies the screenshot. Capture pixels stay local and in memory until you save a region."
      onClose={onCancel}
      closeTestId="capture-display-cancel"
    >
      <div className="capture-display-list" data-testid="capture-display-dialog">
        {displays.map((display, index) => {
          const title = displayTitle(display);
          const details = `${display.bounds.width} × ${display.bounds.height} points · ${scalePercent(display.scaleFactor)}`;
          const position = `Desktop position ${display.bounds.x}, ${display.bounds.y}`;
          return (
            <button
              key={display.id}
              type="button"
              className="capture-display-option"
              data-autofocus={index === 0 ? true : undefined}
              data-display-id={display.id}
              aria-label={`Capture ${title}. ${details}. ${position}.`}
              onClick={() => onSelect(display.id)}
            >
              <span className="capture-display-icon" aria-hidden="true">
                <Monitor size={22} />
              </span>
              <span className="capture-display-copy">
                <strong>{title}</strong>
                <span>{details}</span>
                <small>{position}</small>
              </span>
            </button>
          );
        })}
        <div className="modal-actions capture-display-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
