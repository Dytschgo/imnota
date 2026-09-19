import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  FileImage,
  FileText,
  FolderOpen,
  Highlighter,
  MousePointer2,
  RectangleHorizontal,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Annotation, AnnotationKind, ImagePayload } from '../../shared/types';
import type {
  ClipboardFormatsReport,
  OnboardingHandoffAction,
  OnboardingHandoffGrant,
  OnboardingHandoffOpenTarget,
  WindowsCopyVariantId,
} from '../../shared/workflow-bridge';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { describeCopyMessage } from '../export/clipboard-delivery';
import { renderAnnotatedImage } from '../export-image';
import { completedOnboarding, ONBOARDING_VERSION, type OnboardingPreferences } from '../settings/preferences';
import {
  buildSamplePromptMarkdown,
  composeSamplePromptPng,
  createGuidedAnnotations,
  createSampleSearchScreenshot,
} from './sampleScreenshot';
import './onboarding.css';

export type OnboardingCompletionReason = 'dismissed' | 'finished';

export interface OnboardingBundle {
  filename: 'component-search.png';
  markdownFilename: 'component-search.md';
  imageDataUrl: string;
  markdown: string;
}

export interface OnboardingDemoProps {
  fileClipboardAvailable?: boolean;
  onMarkCompleted: (
    preferences: OnboardingPreferences,
    reason: OnboardingCompletionReason,
  ) => void | Promise<void>;
  onCreateFirstProject: () => void | Promise<void>;
  onDismiss?: () => void;
  onPrepareHandoff?: (bundle: OnboardingBundle) => Promise<OnboardingHandoffGrant>;
  onCopyHandoff?: (
    grant: OnboardingHandoffGrant,
    action: OnboardingHandoffAction,
  ) => Promise<ClipboardFormatsReport | void>;
  onOpenHandoff?: (grant: OnboardingHandoffGrant, target: OnboardingHandoffOpenTarget) => Promise<void>;
  onboardingVersion?: number;
}

const TOOLS: Array<{ tool: 'select' | AnnotationKind; label: string; icon: typeof MousePointer2 }> = [
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'text', label: 'Text', icon: Type },
  { tool: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal },
  { tool: 'highlight', label: 'Highlight', icon: Highlighter },
];

export function OnboardingDemo({
  fileClipboardAvailable = false,
  onMarkCompleted,
  onCreateFirstProject,
  onDismiss,
  onPrepareHandoff,
  onCopyHandoff,
  onOpenHandoff,
  onboardingVersion = ONBOARDING_VERSION,
}: OnboardingDemoProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [image, setImage] = useState<ImagePayload | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | AnnotationKind | 'eraser'>('select');
  const [bundle, setBundle] = useState<OnboardingBundle | null>(null);
  const [handoff, setHandoff] = useState<OnboardingHandoffGrant | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [explanation, setExplanation] = useState(
    'Keep the component search visible while someone reviews several results.',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sampleImage] = useState<ImagePayload | null>(() => {
    try {
      return createSampleSearchScreenshot();
    } catch {
      return null;
    }
  });
  const dialogRef = useRef<HTMLElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const dismissRef = useRef<() => Promise<void>>(async () => {});
  const markdown = useMemo(
    () => buildSamplePromptMarkdown(annotations, explanation),
    [annotations, explanation],
  );

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onMarkCompleted(completedOnboarding(onboardingVersion), 'dismissed');
      onDismiss?.();
    } catch {
      setError('The guide could not be dismissed because its completion state was not saved.');
    } finally {
      setBusy(false);
    }
  };
  dismissRef.current = dismiss;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void dismissRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener('keydown', onKeyDown);
    return () => {
      dialog?.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  const loadSample = () => {
    if (!sampleImage) {
      setError('The sample screenshot could not be created. Canvas rendering is unavailable.');
      return;
    }
    setImage(sampleImage);
    setStep(1);
    setError('');
  };

  const prepareBundle = async () => {
    if (!image || annotations.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const annotatedImageDataUrl = await renderAnnotatedImage(image, annotations);
      const imageDataUrl = await composeSamplePromptPng(annotatedImageDataUrl);
      const preparedBundle: OnboardingBundle = {
        filename: 'component-search.png',
        markdownFilename: 'component-search.md',
        imageDataUrl,
        markdown,
      };
      const preparedHandoff = onPrepareHandoff ? await onPrepareHandoff(preparedBundle) : null;
      setBundle(preparedBundle);
      setHandoff(preparedHandoff);
      setCopyStatus('');
      setStep(2);
    } catch {
      setError('The annotated sample could not be prepared. Try the step again.');
    } finally {
      setBusy(false);
    }
  };

  const copyBundle = async (variant: WindowsCopyVariantId) => {
    if (!bundle || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!handoff || !onCopyHandoff) throw new Error('The native handoff is unavailable.');
      const placed = await onCopyHandoff(handoff, variant);
      if (placed) setCopyStatus(describeCopyMessage(variant, placed));
      else setCopyStatus('The clipboard result was not confirmed. Try another option below.');
    } catch {
      setError(
        'The clipboard is unavailable right now. Try copying again, or continue to create your project.',
      );
    } finally {
      setBusy(false);
    }
  };

  const runFallback = async (
    label: string,
    action: OnboardingHandoffAction | OnboardingHandoffOpenTarget,
  ) => {
    if (!handoff || busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'files' || action === 'folder') {
        if (!onOpenHandoff) throw new Error('Opening generated files is unavailable.');
        await onOpenHandoff(handoff, action);
      } else {
        if (!onCopyHandoff) throw new Error('Clipboard access is unavailable.');
        await onCopyHandoff(handoff, action);
      }
      setCopyStatus(label);
    } catch {
      setError('That handoff action could not be completed. Try another option below.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onMarkCompleted(completedOnboarding(onboardingVersion), 'finished');
      await onCreateFirstProject();
    } catch {
      setError('The guide finished, but Imnota could not start project creation. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="imnota-onboarding-backdrop">
      <section
        data-testid="onboarding-dialog"
        className="imnota-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="imnota-onboarding-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="imnota-onboarding-header">
          <div>
            <h1 id="imnota-onboarding-title">Try the complete handoff</h1>
            <p>One local sample. Three steps. Nothing is added to your workspace.</p>
          </div>
          <button
            type="button"
            className="imnota-onboarding-dismiss"
            onClick={() => void dismiss()}
            disabled={busy}
          >
            <X size={15} aria-hidden="true" />
            Skip guide
          </button>
        </header>

        <nav className="imnota-onboarding-progress" aria-label="Onboarding progress">
          {['Add screenshot', 'Annotate', 'Copy prompt'].map((label, index) => (
            <div
              key={label}
              data-current={step === index || undefined}
              data-complete={step > index || undefined}
            >
              <span>{step > index ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
              {label}
            </div>
          ))}
        </nav>

        <div className="imnota-onboarding-body">
          {step === 0 && (
            <div className="imnota-onboarding-intro">
              <div className="imnota-sample-window" aria-hidden="true">
                <div>
                  <i />
                  <i />
                  <i />
                </div>
                <span>component-search.png</span>
                {sampleImage ? (
                  <img src={sampleImage.dataUrl} alt="" />
                ) : (
                  <small>Canvas preview unavailable</small>
                )}
              </div>
              <div className="imnota-onboarding-instruction">
                <h2>Start with a screenshot</h2>
                <p>
                  In a project you can paste, drop, or import screenshots. This guide creates a generic search
                  interface locally so you can practice without choosing a file.
                </p>
                <button
                  data-testid="onboarding-use-sample"
                  type="button"
                  className="imnota-onboarding-primary"
                  onClick={loadSample}
                  disabled={!sampleImage}
                >
                  Use sample screenshot
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {step === 1 && image && (
            <div className="imnota-annotation-step">
              <aside className="imnota-onboarding-instruction">
                <h2>Mark what should change</h2>
                <p>
                  Pick a tool and draw on the search UI, or add the guided note to see a complete example.
                </p>
                <div className="imnota-demo-tools" role="toolbar" aria-label="Sample annotation tools">
                  {TOOLS.map(({ tool: option, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={option}
                      aria-label={label}
                      aria-pressed={tool === option}
                      title={label}
                      onClick={() => setTool(option)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  data-testid="onboarding-guided-note"
                  type="button"
                  className="imnota-onboarding-secondary"
                  onClick={() => {
                    setAnnotations((current) => [...current, ...createGuidedAnnotations(current.length)]);
                    setTool('select');
                  }}
                >
                  Add guided note
                </button>
                <small className="imnota-onboarding-tip">
                  Double-click the screenshot to add editable text. Drag empty canvas space to pan, or drag a
                  marker over an area.
                </small>
                <label className="imnota-onboarding-explanation">
                  Markdown explanation
                  <textarea
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                    rows={3}
                    maxLength={600}
                  />
                </label>
              </aside>
              <div className="imnota-demo-canvas">
                <AnnotationCanvas
                  image={image}
                  annotations={annotations}
                  selectedId={selectedId}
                  tool={tool}
                  onChange={setAnnotations}
                  onSelect={setSelectedId}
                  stageRef={stageRef}
                  onTool={setTool}
                />
              </div>
            </div>
          )}

          {step === 2 && bundle && (
            <div className="imnota-copy-step">
              <div className="imnota-bundle-preview">
                <img src={bundle.imageDataUrl} alt="Annotated component search sample" />
                <div>
                  <strong>{bundle.filename}</strong>
                  <span>PNG with visible annotations</span>
                </div>
              </div>
              <div className="imnota-onboarding-instruction">
                <h2>{copyStatus ? 'The handoff is ready' : 'Copy the matching bundle'}</h2>
                <p>
                  The PNG carries the visual marks. The Markdown carries the picture reference, priority,
                  description, and text notes. Clipboard access is optional in this practice guide.
                </p>
                <pre>{bundle.markdown}</pre>
                <div
                  className={`imnota-copy-variants${fileClipboardAvailable ? '' : ' is-rich-only'}`}
                  role="group"
                  aria-label="Copy format"
                >
                  <button
                    type="button"
                    className="imnota-onboarding-primary"
                    aria-label="Rich copy"
                    title="Markdown text, HTML, and PNG formats"
                    onClick={() => void copyBundle('rich')}
                    disabled={busy}
                  >
                    <Clipboard size={15} aria-hidden="true" />
                    <span>Rich copy</span>
                    <small>Text + image</small>
                  </button>
                  {fileClipboardAvailable && (
                    <>
                      <button
                        type="button"
                        className="imnota-onboarding-secondary"
                        aria-label="Copy files"
                        title="Markdown and PNG as file attachments"
                        onClick={() => void copyBundle('files')}
                        disabled={busy}
                      >
                        <span>Copy files</span>
                        <small>MD + PNG files</small>
                      </button>
                      <button
                        type="button"
                        className="imnota-onboarding-secondary"
                        aria-label="Files + rich copy"
                        title="File attachments plus Markdown, HTML, and PNG formats"
                        onClick={() => void copyBundle('files-rich')}
                        disabled={busy}
                      >
                        <span>Files + rich copy</span>
                        <small>Both</small>
                      </button>
                    </>
                  )}
                </div>
                {copyStatus && (
                  <div className="imnota-copy-success" role="status">
                    <Check size={15} aria-hidden="true" />
                    {copyStatus}
                  </div>
                )}
                {handoff && (
                  <div className="imnota-onboarding-fallbacks" aria-label="Bundle fallback actions">
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => void runFallback('Markdown copied.', 'markdown')}
                      disabled={busy}
                    >
                      <FileText size={14} aria-hidden="true" /> Copy Markdown
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => void runFallback('Image copied.', 'image')}
                      disabled={busy}
                    >
                      <FileImage size={14} aria-hidden="true" /> Copy image
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => void runFallback('Generated files opened.', 'files')}
                      disabled={busy}
                    >
                      Open files
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => void runFallback('File paths copied.', 'paths')}
                      disabled={busy}
                    >
                      Copy file paths
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => void runFallback('Export folder opened.', 'folder')}
                      disabled={busy}
                    >
                      <FolderOpen size={14} aria-hidden="true" /> Open export folder
                    </button>
                  </div>
                )}
                <details className="imnota-onboarding-checklist">
                  <summary>Final workflow checklist</summary>
                  <ul>
                    <li>Capture, paste, or import screenshots.</li>
                    <li>Annotate the region and add an explanation.</li>
                    <li>Arrange screenshots in a collection.</li>
                    <li>Copy or open the Markdown and PNG bundle.</li>
                    <li>Use search to find earlier work.</li>
                    <li>Restore local history when you need it.</li>
                  </ul>
                </details>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="imnota-onboarding-error" role="alert">
            {error}
          </p>
        )}

        {step > 0 && (
          <footer className="imnota-onboarding-footer">
            <button
              type="button"
              className="imnota-onboarding-back"
              onClick={() => {
                setError('');
                setStep(step === 2 ? 1 : 0);
              }}
              disabled={busy}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back
            </button>
            {step === 1 ? (
              <button
                data-testid="onboarding-continue"
                type="button"
                className="imnota-onboarding-primary"
                disabled={annotations.length === 0 || busy}
                onClick={() => void prepareBundle()}
              >
                {busy ? 'Preparing…' : 'Continue to copy'}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ) : (
              <button
                data-testid="onboarding-create-project"
                type="button"
                className="imnota-onboarding-primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                Create your first project
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
