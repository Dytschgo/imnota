import { workflowMessage } from '../app/workflow';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
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
import type { ShortcutPlatform } from '../../shared/shortcuts';
import type {
  ClipboardFormatsReport,
  OnboardingHandoffAction,
  OnboardingHandoffGrant,
  OnboardingHandoffOpenTarget,
  WindowsCopyVariantId,
} from '../../shared/workflow-bridge';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { describeCopyDelivery } from '../export/clipboard-delivery';
import { copyVariantLabels } from '../export/copy-variant-labels';
import type { PromptDeliveryOutcome } from '../export/PromptBundleCard';
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
  platform?: ShortcutPlatform;
  defaultCopyVariant?: WindowsCopyVariantId;
  onDefaultCopyVariantChange?(variant: WindowsCopyVariantId): Promise<void>;
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

const STEPS = ['Add screenshot', 'Annotate', 'Copy prompt'];

const COPY_OUTCOME_LABELS: Record<PromptDeliveryOutcome, string> = {
  combined: 'Markdown + image prepared',
  markdown: 'Markdown copied',
  image: 'Image copied',
  paths: 'File paths copied',
  terminal: 'Copied for terminal',
  files: 'Files ready',
  opened: 'Files opened',
};

const OPEN_STATUS_LABELS: Record<OnboardingHandoffOpenTarget, string> = {
  files: 'Generated files opened.',
  folder: 'Export folder opened.',
};

export function OnboardingDemo({
  fileClipboardAvailable = false,
  platform = 'windows',
  defaultCopyVariant = 'files',
  onDefaultCopyVariantChange,
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
  const [tool, setTool] = useState<'select' | AnnotationKind>('select');
  const [bundle, setBundle] = useState<OnboardingBundle | null>(null);
  const [handoff, setHandoff] = useState<OnboardingHandoffGrant | null>(null);
  const [copyOutcome, setCopyOutcome] = useState<PromptDeliveryOutcome>();
  const [copyWarning, setCopyWarning] = useState('');
  const [openStatus, setOpenStatus] = useState('');
  const [copyAttempted, setCopyAttempted] = useState(false);
  const copySequence = useRef(0);
  const [copyOperation, setCopyOperation] = useState<{
    id: number;
    action: WindowsCopyVariantId;
    state: 'pending' | 'succeeded' | 'failed';
  }>();
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
  const primaryCopyVariant = fileClipboardAvailable ? defaultCopyVariant : 'rich';
  const variantLabels = copyVariantLabels(platform);
  // Fallbacks stay out of the way until a copy has actually been tried.
  const showFallbacks = Boolean(handoff && copyAttempted);

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
      setCopyOutcome(undefined);
      setCopyWarning('');
      setOpenStatus('');
      setCopyAttempted(false);
      setStep(2);
    } catch {
      setError('The annotated sample could not be prepared. Try the step again.');
    } finally {
      setBusy(false);
    }
  };

  const copyBundle = async (variant: WindowsCopyVariantId) => {
    if (!bundle || busy) return;
    const id = ++copySequence.current;
    setCopyOperation({ id, action: variant, state: 'pending' });
    setCopyOutcome(undefined);
    setCopyWarning('');
    setBusy(true);
    setError('');
    setCopyAttempted(true);
    try {
      if (!handoff || !onCopyHandoff) throw new Error('The native handoff is unavailable.');
      const placed = await onCopyHandoff(handoff, variant);
      const delivery = describeCopyDelivery(variant, placed || undefined, true);
      setCopyOutcome(delivery.outcome);
      setCopyWarning(delivery.warning ?? '');
      setOpenStatus('');
      setCopyOperation({ id, action: variant, state: 'succeeded' });
    } catch {
      setCopyOperation({ id, action: variant, state: 'failed' });
      setError(
        'The clipboard is unavailable right now. Try copying again, or continue to create your project.',
      );
    } finally {
      setBusy(false);
    }
  };

  const runFallback = async (action: OnboardingHandoffAction | OnboardingHandoffOpenTarget) => {
    if (!handoff || busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'files' || action === 'folder') {
        if (!onOpenHandoff) throw new Error('Opening generated files is unavailable.');
        await onOpenHandoff(handoff, action);
        setCopyOutcome(undefined);
        setCopyWarning('');
        setOpenStatus(OPEN_STATUS_LABELS[action]);
      } else if (action === 'markdown' || action === 'image' || action === 'paths') {
        if (!onCopyHandoff) throw new Error('Clipboard access is unavailable.');
        await onCopyHandoff(handoff, action);
        setCopyOutcome(action);
        setCopyWarning('');
        setOpenStatus('');
      } else {
        throw new Error('Clipboard access is unavailable.');
      }
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
        data-copy-attempt={copyOperation?.id ?? 0}
        data-copy-action={copyOperation?.action}
        data-copy-state={copyOperation?.state ?? 'idle'}
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
            <nav className="imnota-onboarding-progress" aria-label="Onboarding progress">
              {STEPS.map((label, index) => (
                <div
                  key={label}
                  data-current={step === index || undefined}
                  data-complete={step > index || undefined}
                >
                  <span>{step > index ? <Check size={11} aria-hidden="true" /> : index + 1}</span>
                  {label}
                </div>
              ))}
            </nav>
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

        <div className="imnota-onboarding-body">
          {step === 0 && (
            <div className="imnota-onboarding-intro">
              <figure className="imnota-sample-window" aria-hidden="true">
                {sampleImage ? (
                  <img src={sampleImage.dataUrl} alt="" />
                ) : (
                  <small>Canvas preview unavailable</small>
                )}
              </figure>
              <div className="imnota-onboarding-instruction">
                <h2>Start with a screenshot</h2>
                <p>
                  In a project you paste, drop, or import screenshots. This guide uses a local sample instead,
                  so nothing is added to your workspace.
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
                  Pick a tool and draw on the screenshot, or add the guided note to see a complete example.
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
                  Double-click the screenshot for text. Drag empty space to pan.
                </small>
                <label className="imnota-onboarding-explanation">
                  Explanation for the agent
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
              <figure className="imnota-bundle-preview">
                <img src={bundle.imageDataUrl} alt="Annotated component search sample" />
                <figcaption>
                  <strong>{bundle.filename}</strong>
                  <span>PNG with your marks</span>
                </figcaption>
              </figure>
              <div className="imnota-onboarding-instruction">
                <h2>
                  {copyOutcome === 'combined' || copyOutcome === 'files'
                    ? 'The handoff is ready'
                    : 'Copy the bundle'}
                </h2>
                <p>
                  The PNG carries your marks; the Markdown carries the notes. Imnota reports which formats the
                  clipboard actually kept.
                </p>
                <div className="imnota-markdown-preview">
                  <div>
                    <FileText size={13} aria-hidden="true" />
                    {bundle.markdownFilename}
                  </div>
                  <pre>{bundle.markdown}</pre>
                </div>
                <div className="imnota-copy-split" role="group" aria-label="Copy format">
                  <button
                    type="button"
                    className="imnota-onboarding-primary"
                    aria-label={variantLabels[primaryCopyVariant].label}
                    title={variantLabels[primaryCopyVariant].detail}
                    onClick={() => void copyBundle(primaryCopyVariant)}
                    disabled={busy}
                  >
                    <Clipboard size={15} aria-hidden="true" />
                    <span>{variantLabels[primaryCopyVariant].label}</span>
                  </button>
                  {fileClipboardAvailable && (
                    <CopyFormatMenu
                      value={defaultCopyVariant}
                      labels={variantLabels}
                      disabled={busy || !onDefaultCopyVariantChange}
                      onChange={async (variant) => {
                        setError('');
                        try {
                          await onDefaultCopyVariantChange?.(variant);
                        } catch (reason) {
                          setError(
                            workflowMessage(
                              reason,
                              'The primary copy action save could not be confirmed. Review the current choice before trying again.',
                            ),
                          );
                        }
                      }}
                    />
                  )}
                  <small>{variantLabels[primaryCopyVariant].detail}</small>
                </div>
                {(copyOutcome || openStatus) && (
                  <div className="imnota-copy-success" role="status">
                    <Check size={15} aria-hidden="true" />
                    {copyOutcome ? COPY_OUTCOME_LABELS[copyOutcome] : openStatus}
                  </div>
                )}
                {copyWarning && (
                  <p
                    className="imnota-copy-warning"
                    data-testid="onboarding-copy-warning"
                    role={copyOutcome ? undefined : 'status'}
                  >
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>{copyWarning}</span>
                  </p>
                )}
                {showFallbacks && (
                  <div
                    className={`imnota-onboarding-fallbacks${copyWarning ? ' is-needed' : ''}`}
                    aria-label="Bundle fallback actions"
                  >
                    <span>Other ways to hand off</span>
                    <div>
                      <button type="button" onClick={() => void runFallback('markdown')} disabled={busy}>
                        <FileText size={13} aria-hidden="true" /> Copy Markdown only
                      </button>
                      <button type="button" onClick={() => void runFallback('image')} disabled={busy}>
                        <FileImage size={13} aria-hidden="true" /> Copy image only
                      </button>
                      <button type="button" onClick={() => void runFallback('files')} disabled={busy}>
                        Open files
                      </button>
                      <button type="button" onClick={() => void runFallback('paths')} disabled={busy}>
                        Copy file paths
                      </button>
                      <button type="button" onClick={() => void runFallback('folder')} disabled={busy}>
                        <FolderOpen size={13} aria-hidden="true" /> Open export folder
                      </button>
                    </div>
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
                setCopyOutcome(undefined);
                setCopyWarning('');
                setOpenStatus('');
                setCopyAttempted(false);
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

const COPY_VARIANTS: readonly WindowsCopyVariantId[] = ['files', 'files-rich', 'rich'];

/** The copy-format chooser, styled like the app's own menus instead of an OS select popup. */
function CopyFormatMenu({
  value,
  labels,
  disabled,
  onChange,
}: {
  value: WindowsCopyVariantId;
  labels: Record<WindowsCopyVariantId, { label: string; detail: string }>;
  disabled: boolean;
  onChange(variant: WindowsCopyVariantId): void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div className="imnota-copy-format" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="imnota-copy-format-trigger"
        aria-label="Native copy function"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="imnota-copy-format-menu"
          role="menu"
          aria-label="Native copy function"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close(true);
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            items[(index + step + items.length) % items.length]?.focus();
          }}
        >
          {COPY_VARIANTS.map((variant) => (
            <button
              key={variant}
              type="button"
              role="menuitemradio"
              aria-checked={value === variant}
              data-variant={variant}
              onClick={() => {
                close(true);
                if (variant !== value) void onChange(variant);
              }}
            >
              <span className="imnota-copy-format-check" aria-hidden="true">
                {value === variant && <Check size={14} />}
              </span>
              <span>
                <strong>{labels[variant].label}</strong>
                <small>{labels[variant].detail}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
