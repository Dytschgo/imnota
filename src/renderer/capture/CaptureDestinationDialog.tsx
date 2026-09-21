import { FolderOpen } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import type { CaptureDestination, CaptureDestinationChoice } from './capture-destination';
import './capture-display-dialog.css';

export function CaptureDestinationDialog({
  choices,
  onSelect,
  onCancel,
}: {
  choices: readonly CaptureDestinationChoice[];
  onSelect(destination: CaptureDestination): void;
  onCancel(): void;
}) {
  return (
    <Modal
      title="Choose a collection"
      description="The screenshot is still in memory. Choose a current collection to keep it, or cancel to discard it."
      onClose={onCancel}
      closeTestId="capture-destination-cancel"
    >
      <div className="capture-display-list" data-testid="capture-destination-dialog">
        {choices.map((choice, index) => (
          <button
            key={`${choice.projectPath}:${choice.collectionId}`}
            type="button"
            className="capture-display-option"
            data-autofocus={index === 0 ? true : undefined}
            aria-label={`Save to ${choice.collectionName} in ${choice.projectName}`}
            onClick={() => onSelect(choice)}
          >
            <span className="capture-display-icon" aria-hidden="true">
              <FolderOpen size={22} />
            </span>
            <span className="capture-display-copy">
              <strong>{choice.collectionName}</strong>
              <span>{choice.projectName}</span>
            </span>
          </button>
        ))}
        <div className="modal-actions capture-display-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
