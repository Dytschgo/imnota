import { Plus, Trash2 } from 'lucide-react';
import type { ShortcutPreferences } from '../../shared/preferences';
import { version as appVersion } from '../../../package.json';
import { Logo } from '../components/Logo';
import { Button, Modal, TextArea, TextInput } from '../components/ui';
import { ShortcutSettings } from '../settings';

export type AppDialog = 'new-project' | 'shortcuts' | 'about' | 'delete-project' | null;

export interface NewProjectDraft {
  name: string;
  description: string;
}

export interface AppDialogsProps {
  dialog: AppDialog;
  newProject: NewProjectDraft;
  shortcuts: ShortcutPreferences;
  currentVersion?: string;
  busy?: boolean;
  onNewProjectChange(value: NewProjectDraft): void;
  onCreateProject(): void | Promise<void>;
  onDeleteProject(): void | Promise<void>;
  onShortcutChange(value: ShortcutPreferences): void | Promise<void>;
  onClose(): void;
}

export function AppDialogs({
  dialog,
  newProject,
  shortcuts,
  currentVersion,
  busy = false,
  onNewProjectChange,
  onCreateProject,
  onDeleteProject,
  onShortcutChange,
  onClose,
}: AppDialogsProps) {
  if (dialog === 'new-project')
    return (
      <Modal
        title="New project"
        description="Keep the brief and its screenshots together in one local folder."
        onClose={onClose}
      >
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreateProject();
          }}
        >
          <TextInput
            data-autofocus
            data-testid="project-name-input"
            label="Project name"
            placeholder="e.g. Checkout flow review"
            value={newProject.name}
            onChange={(event) => onNewProjectChange({ ...newProject, name: event.target.value })}
          />
          <TextArea
            data-testid="project-description-input"
            label="Description"
            placeholder="What are you trying to explain?"
            rows={3}
            value={newProject.description}
            onChange={(event) => onNewProjectChange({ ...newProject, description: event.target.value })}
          />
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              data-testid="create-project-submit"
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!newProject.name.trim()}
            >
              <Plus size={16} aria-hidden="true" />
              Create project
            </Button>
          </div>
        </form>
      </Modal>
    );
  if (dialog === 'shortcuts')
    return (
      <Modal
        title="Keyboard shortcuts"
        description="Select a binding, then press the replacement keys. Shortcuts pause in text fields and dialogs."
        onClose={onClose}
      >
        <ShortcutSettings value={shortcuts} onChange={onShortcutChange} />
      </Modal>
    );
  if (dialog === 'about')
    return (
      <Modal title="About Imnota" description="Screenshots that AI understands." onClose={onClose}>
        <div className="about-copy">
          <Logo />
          <p>
            Imnota keeps screenshot context local, editable, and ready to share. No account, backend, or cloud
            storage is required.
          </p>
          <span className="muted">
            Version {currentVersion ?? appVersion} · MIT License · Built by Dytschgo
          </span>
        </div>
      </Modal>
    );
  if (dialog === 'delete-project')
    return (
      <Modal
        title="Delete this project?"
        description="This moves the local project folder, screenshots, descriptions, and annotations to the operating-system trash."
        onClose={onClose}
      >
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Keep project
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void onDeleteProject()}>
            <Trash2 size={16} aria-hidden="true" />
            Move to trash
          </Button>
        </div>
      </Modal>
    );
  return null;
}
