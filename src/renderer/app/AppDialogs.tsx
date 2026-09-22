import { Plus, Trash2 } from 'lucide-react';
import type { ShortcutPreferences } from '../../shared/preferences';
import type { ProjectIconKey } from '../../shared/project-icons';
import { version as appVersion } from '../../../package.json';
import { Logo } from '../components/Logo';
import { PROJECT_ICON_OPTIONS } from '../components/ProjectIcon';
import { Button, Modal, TextArea, TextInput } from '../components/ui';
import { ShortcutSettings } from '../settings';
import { WORKFLOW_TEMPLATES, type WorkflowTemplateId } from '../../shared/workflow-templates';

export type AppDialog = 'new-project' | 'edit-project' | 'shortcuts' | 'about' | 'delete-project' | null;

export interface NewProjectDraft {
  name: string;
  description: string;
  icon?: ProjectEditDraft['icon'];
  templateId?: WorkflowTemplateId;
}

export interface ProjectEditDraft extends NewProjectDraft {
  icon: ProjectIconKey;
}

export interface AppDialogsProps {
  dialog: AppDialog;
  newProject: NewProjectDraft;
  editProject?: ProjectEditDraft;
  /** Name of the project awaiting deletion confirmation. */
  deleteProjectName?: string;
  shortcuts: ShortcutPreferences;
  currentVersion?: string;
  busy?: boolean;
  onNewProjectChange(value: NewProjectDraft): void;
  onEditProjectChange?(value: ProjectEditDraft): void;
  onSaveProjectEdits?(): void | Promise<void>;
  onCreateProject(): void | Promise<void>;
  onDeleteProject(): void | Promise<void>;
  onShortcutChange(value: ShortcutPreferences): void | Promise<void>;
  onClose(): void;
}

export function AppDialogs({
  dialog,
  newProject,
  editProject,
  deleteProjectName,
  shortcuts,
  currentVersion,
  busy = false,
  onNewProjectChange,
  onEditProjectChange,
  onSaveProjectEdits,
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
          <fieldset className="project-icon-picker">
            <legend>Project icon</legend>
            <div>
              {PROJECT_ICON_OPTIONS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Use ${key} icon`}
                  aria-pressed={(newProject.icon ?? 'layers') === key}
                  onClick={() => onNewProjectChange({ ...newProject, icon: key })}
                >
                  <Icon size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="template-picker">
            <legend className="template-picker-heading">Start from template</legend>
            <p className="muted">Optional editable Markdown blocks are added to the first collection.</p>
            <div className="template-picker-options">
              <label className={`template-picker-option${!newProject.templateId ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="workflow-template"
                  value="blank"
                  checked={!newProject.templateId}
                  onChange={() => onNewProjectChange({ ...newProject, templateId: undefined })}
                />
                <span className="template-picker-option-copy">
                  <strong>Blank project</strong>
                  <span>Start with an empty collection.</span>
                </span>
              </label>
              {WORKFLOW_TEMPLATES.map((template) => (
                <label
                  className={`template-picker-option${newProject.templateId === template.id ? ' selected' : ''}`}
                  key={template.id}
                >
                  <input
                    type="radio"
                    name="workflow-template"
                    value={template.id}
                    checked={newProject.templateId === template.id}
                    onChange={() => onNewProjectChange({ ...newProject, templateId: template.id })}
                  />
                  <span className="template-picker-option-copy">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
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
  if (dialog === 'edit-project' && editProject && onEditProjectChange && onSaveProjectEdits)
    return (
      <Modal title="Edit project" description="Update the local project details." onClose={onClose}>
        <form
          className="modal-form"
          data-testid="project-edit-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveProjectEdits();
          }}
        >
          <TextInput
            data-autofocus
            data-testid="project-name-input"
            label="Project name"
            value={editProject.name}
            onChange={(event) => onEditProjectChange({ ...editProject, name: event.target.value })}
          />
          <TextArea
            data-testid="project-description-input"
            label="Description"
            rows={3}
            value={editProject.description}
            onChange={(event) => onEditProjectChange({ ...editProject, description: event.target.value })}
          />
          <fieldset className="project-icon-picker">
            <legend>Project icon</legend>
            <div>
              {PROJECT_ICON_OPTIONS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Use ${key} icon`}
                  aria-pressed={editProject.icon === key}
                  onClick={() => onEditProjectChange({ ...editProject, icon: key })}
                >
                  <Icon size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!editProject.name.trim()}>
              Save changes
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
          <nav className="about-links" aria-label="Imnota links">
            <a href="https://imnota.xyz/" target="_blank" rel="noopener noreferrer">
              Website
            </a>
            <a href="https://github.com/Dytschgo/imnota" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="https://x.com/Dytschgo" target="_blank" rel="noopener noreferrer">
              X · @Dytschgo
            </a>
          </nav>
          <span className="muted">
            Version {currentVersion ?? appVersion} · MIT License · Built by Dytschgo
          </span>
        </div>
      </Modal>
    );
  if (dialog === 'delete-project')
    return (
      <Modal
        title={deleteProjectName ? `Delete ${deleteProjectName}?` : 'Delete this project?'}
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
