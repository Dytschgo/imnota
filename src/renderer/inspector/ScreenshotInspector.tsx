import { Copy, PanelRight, Trash2, Undo2 } from 'lucide-react';
import type { Annotation, ScreenshotRecord } from '../../shared/types';
import { ANNOTATION_COLORS } from '../canvas/annotation-layout';
import { Button, EmptyState, TextArea, TextInput } from '../components/ui';

export interface ScreenshotInspectorProps {
  shot: ScreenshotRecord | null;
  selectedAnnotation: Annotation | null;
  onUpdateShot(patch: Partial<ScreenshotRecord>): void;
  onDescriptionChange(value: string): void;
  onUndoDescription(): void;
  canUndoDescription: boolean;
  onChangeAnnotation(patch: Partial<Annotation>): void;
  onDuplicate(): void | Promise<void>;
  onDeleteScreenshot(): void | Promise<void>;
  onDeleteProject(): void;
}

export function ScreenshotInspector({
  shot,
  selectedAnnotation,
  onUpdateShot,
  onDescriptionChange,
  onUndoDescription,
  canUndoDescription,
  onChangeAnnotation,
  onDuplicate,
  onDeleteScreenshot,
  onDeleteProject,
}: ScreenshotInspectorProps) {
  if (!shot)
    return (
      <aside className="inspector" aria-label="Inspector" data-testid="inspector-panel">
        <EmptyState
          icon={<PanelRight size={20} aria-hidden="true" />}
          title="Inspector"
          description="Select a screenshot to edit its description and prompt details."
        />
      </aside>
    );

  return (
    <aside className="inspector" aria-label="Screenshot inspector" data-testid="inspector-panel">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">SCREENSHOT {String(shot.position + 1).padStart(2, '0')}</span>
          <h2>Screenshot context</h2>
        </div>
      </div>
      <div className="inspector-scroll">
        <section className="inspector-section context-section" aria-labelledby="context-heading">
          <span className="section-label" id="context-heading">
            Context
          </span>
          <p className="section-intro">
            Give the agent a clear reading of this evidence before it sees the details.
          </p>
          <TextInput
            label="Title"
            value={shot.title}
            onChange={(event) => onUpdateShot({ title: event.target.value })}
          />
          <div className="description-field">
            <div className="field-heading">
              <span className="field-label">What should change or stay?</span>
              <Button
                variant="ghost"
                aria-label="Undo description"
                disabled={!canUndoDescription}
                onClick={onUndoDescription}
              >
                <Undo2 size={14} aria-hidden="true" />
                Undo
              </Button>
            </div>
            <TextArea
              aria-label="Description"
              rows={6}
              placeholder="What should the agent notice, change, or preserve?"
              value={shot.description}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          </div>
          <label className="field">
            <span className="field-label">Priority for agent</span>
            <select
              aria-label="Priority for agent"
              value={shot.priority}
              onChange={(event) =>
                onUpdateShot({ priority: event.target.value as ScreenshotRecord['priority'] })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          {shot.conflict && (
            <p className="conflict-notice">
              {shot.includeInExport
                ? 'Copy conflict · included manually in prompt bundles'
                : 'Copy conflict · excluded from prompt bundles'}
            </p>
          )}
        </section>
        {selectedAnnotation && (
          <section
            className="annotation-properties inspector-section"
            aria-labelledby="selected-annotation-heading"
          >
            <span className="section-label" id="selected-annotation-heading">
              Selected annotation
            </span>
            <div className="property-line">
              <span>Type</span>
              <strong>{selectedAnnotation.kind.replace('-', ' ')}</strong>
            </div>
            <fieldset className="annotation-color-fieldset">
              <legend>Colour</legend>
              <div
                className="annotation-palette inspector-palette"
                role="group"
                aria-label="Selected annotation color"
              >
                {ANNOTATION_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Set selected annotation color to ${color}`}
                    aria-pressed={
                      (selectedAnnotation.stroke ?? selectedAnnotation.fill)?.toLowerCase() === color
                    }
                    className={
                      (selectedAnnotation.stroke ?? selectedAnnotation.fill)?.toLowerCase() === color
                        ? 'is-active'
                        : ''
                    }
                    style={{ '--swatch': color } as React.CSSProperties}
                    onClick={() =>
                      onChangeAnnotation(
                        selectedAnnotation.kind === 'highlight' ||
                          selectedAnnotation.kind === 'callout' ||
                          selectedAnnotation.kind === 'step'
                          ? { fill: color, stroke: color }
                          : { stroke: color },
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
            <div className="field-grid">
              <TextInput
                label="Stroke width"
                type="number"
                min="1"
                max="20"
                value={selectedAnnotation.strokeWidth ?? 4}
                onChange={(event) => onChangeAnnotation({ strokeWidth: Number(event.target.value) })}
              />
              <TextInput
                label="Opacity"
                type="number"
                min="0.1"
                max="1"
                step="0.1"
                value={selectedAnnotation.opacity ?? 1}
                onChange={(event) => onChangeAnnotation({ opacity: Number(event.target.value) })}
              />
            </div>
            {(selectedAnnotation.kind === 'text' || selectedAnnotation.kind === 'callout') && (
              <TextInput
                label="Text"
                value={selectedAnnotation.text ?? ''}
                onChange={(event) => onChangeAnnotation({ text: event.target.value })}
              />
            )}
            <div className="field-grid">
              <TextInput
                label="Layer order"
                type="number"
                value={selectedAnnotation.zIndex}
                onChange={(event) => onChangeAnnotation({ zIndex: Number(event.target.value) })}
              />
              <TextInput
                label="Rotation"
                type="number"
                disabled={['crop', 'pixelate'].includes(selectedAnnotation.kind)}
                value={selectedAnnotation.rotation ?? 0}
                onChange={(event) => onChangeAnnotation({ rotation: Number(event.target.value) })}
              />
            </div>
            {['text', 'callout'].includes(selectedAnnotation.kind) && (
              <>
                <TextInput
                  label="Font size"
                  type="number"
                  min="8"
                  max="200"
                  value={selectedAnnotation.fontSize ?? 24}
                  onChange={(event) =>
                    onChangeAnnotation({ fontSize: Math.max(8, Math.min(200, Number(event.target.value))) })
                  }
                />
                <TextInput
                  label="Font family"
                  value={selectedAnnotation.fontFamily ?? 'Arial'}
                  onChange={(event) => onChangeAnnotation({ fontFamily: event.target.value })}
                />
                <label className="field">
                  <span className="field-label">Text alignment</span>
                  <select
                    aria-label="Text alignment"
                    value={selectedAnnotation.align ?? 'left'}
                    onChange={(event) =>
                      onChangeAnnotation({ align: event.target.value as Annotation['align'] })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedAnnotation.fontStyle === 'bold'}
                    onChange={(event) =>
                      onChangeAnnotation({ fontStyle: event.target.checked ? 'bold' : 'normal' })
                    }
                  />
                  Bold text
                </label>
              </>
            )}
            {selectedAnnotation.kind === 'step' && (
              <TextInput
                label="Step number"
                type="number"
                min="1"
                value={selectedAnnotation.stepNumber ?? 1}
                onChange={(event) =>
                  onChangeAnnotation({ stepNumber: Math.max(1, Number(event.target.value)) })
                }
              />
            )}
            {selectedAnnotation.kind === 'arrow' && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={selectedAnnotation.arrowhead !== false}
                  onChange={(event) => onChangeAnnotation({ arrowhead: event.target.checked })}
                />
                Show arrowhead
              </label>
            )}
            {selectedAnnotation.kind === 'pixelate' && (
              <TextInput
                label="Pixel block size"
                type="number"
                min="4"
                max="100"
                value={selectedAnnotation.blurIntensity ?? 14}
                onChange={(event) =>
                  onChangeAnnotation({
                    blurIntensity: Math.max(4, Math.min(100, Number(event.target.value))),
                  })
                }
              />
            )}
          </section>
        )}
        <section className="inspector-section export-section" aria-labelledby="export-heading">
          <span className="section-label" id="export-heading">
            Export
          </span>
          <label className="export-state check-row">
            <input
              type="checkbox"
              checked={shot.includeInExport}
              onChange={(event) => onUpdateShot({ includeInExport: event.target.checked })}
            />
            <span>
              <strong>
                {shot.includeInExport ? 'Included in prompt bundle' : 'Excluded from prompt bundle'}
              </strong>
              <small>
                {shot.includeInExport
                  ? 'Its description and visual evidence will be part of the next bundle.'
                  : 'Keep editing it locally; it will not be copied into the next bundle.'}
              </small>
            </span>
          </label>
          <Button variant="ghost" onClick={() => void onDuplicate()}>
            <Copy size={15} aria-hidden="true" />
            Duplicate screenshot
          </Button>
        </section>
        <details className="danger-zone">
          <summary>
            <span>Danger zone</span>
            <small>Delete this evidence or the whole project</small>
          </summary>
          <div className="danger-zone-actions">
            <Button variant="danger" onClick={() => void onDeleteScreenshot()}>
              <Trash2 size={15} aria-hidden="true" />
              Delete screenshot
            </Button>
            <Button variant="danger" onClick={onDeleteProject}>
              <Trash2 size={15} aria-hidden="true" />
              Delete project
            </Button>
          </div>
        </details>
      </div>
    </aside>
  );
}
