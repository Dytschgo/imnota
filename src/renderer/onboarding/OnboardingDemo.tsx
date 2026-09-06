import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Highlighter,
  MousePointer2,
  RectangleHorizontal,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Annotation, AnnotationKind, ImagePayload } from '../../shared/types';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
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
  onMarkCompleted: (
    preferences: OnboardingPreferences,
    reason: OnboardingCompletionReason,
  ) => void | Promise<void>;
  onCreateFirstProject: () => void | Promise<void>;
  onDismiss?: () => void;
  onCopyBundle?: (bundle: OnboardingBundle) => void | Promise<void>;
  onboardingVersion?: number;
}

const TOOLS: Array<{ tool: 'select' | AnnotationKind; label: string; icon: typeof MousePointer2 }> = [
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'text', label: 'Text', icon: Type },
  { tool: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal },
  { tool: 'highlight', label: 'Highlight', icon: Highlighter },
];

async function writeBundleToBrowserClipboard(bundle: OnboardingBundle) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
    throw new Error('Combined clipboard access is unavailable in this renderer.');
  const response = await fetch(bundle.imageDataUrl);
  const image = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': image,
      'text/markdown': new Blob([bundle.markdown], { type: 'text/markdown' }),
      'text/plain': new Blob([bundle.markdown], { type: 'text/plain' }),
    }),
  ]);
}

export function OnboardingDemo({
  onMarkCompleted,
  onCreateFirstProject,
  onDismiss,
  onCopyBundle,
  onboardingVersion = ONBOARDING_VERSION,
}: OnboardingDemoProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [image, setImage] = useState<ImagePayload | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | AnnotationKind | 'eraser'>('select');
  const [bundle, setBundle] = useState<OnboardingBundle | null>(null);
  const [copied, setCopied] = useState(false);
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
  const markdown = useMemo(() => buildSamplePromptMarkdown(annotations), [annotations]);

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
      setBundle({
        filename: 'component-search.png',
        markdownFilename: 'component-search.md',
        imageDataUrl,
        markdown,
      });
      setStep(2);
    } catch {
      setError('The annotated sample could not be prepared. Try the step again.');
    } finally {
      setBusy(false);
    }
  };

  const copyBundle = async () => {
    if (!bundle || busy) return;
    setBusy(true);
    setError('');
    try {
      await (onCopyBundle ? onCopyBundle(bundle) : writeBundleToBrowserClipboard(bundle));
      setCopied(true);
    } catch {
      setError(
        'The clipboard is unavailable right now. Try copying again, or continue to create your project.',
      );
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
                <h2>{copied ? 'The handoff is ready' : 'Copy the matching bundle'}</h2>
                <p>
                  The PNG carries the visual marks. The Markdown carries the picture reference, priority,
                  description, and text notes. Clipboard access is optional in this practice guide.
                </p>
                <pre>{bundle.markdown}</pre>
                {!copied ? (
                  <button
                    type="button"
                    className="imnota-onboarding-primary"
                    onClick={() => void copyBundle()}
                    disabled={busy}
                  >
                    <Clipboard size={15} aria-hidden="true" />
                    {busy ? 'Copying…' : 'Copy PNG + Markdown'}
                  </button>
                ) : (
                  <div className="imnota-copy-success" role="status">
                    <Check size={15} aria-hidden="true" />
                    PNG and Markdown copied together
                  </div>
                )}
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
