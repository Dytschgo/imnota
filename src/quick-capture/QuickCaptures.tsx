import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Annotation, ImagePayload } from '../shared/types';
import type {
  QuickCaptureBridge,
  QuickCaptureCard,
  QuickCaptureDestination,
  QuickCaptureState,
} from '../shared/quick-capture';
import type { WorkflowResult } from '../shared/workflow-bridge';
import { AnnotationCanvas } from '../renderer/components/AnnotationCanvas';
import type { ToolChoice } from '../renderer/components/Toolbar';
import { renderAnnotatedImage } from '../renderer/export-image';
import { Button } from '../renderer/components/ui';

declare global {
  interface Window {
    imnotaQuickCapture: QuickCaptureBridge;
  }
}

function value<T>(result: WorkflowResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function QuickCaptures() {
  const [state, setState] = useState<QuickCaptureState>({ cards: [], destinations: [] });
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{
    card: QuickCaptureCard;
    image: ImagePayload;
    annotations: Annotation[];
  }>();
  const refreshId = useRef(0);
  const mounted = useRef(true);
  const requestedEditor = useRef<string | undefined>(undefined);
  async function refresh() {
    const request = ++refreshId.current;
    try {
      const next = value(await window.imnotaQuickCapture.state());
      if (mounted.current && request === refreshId.current) setState(next);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Captures could not be loaded. Reopen Pending captures from the tray.',
        );
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const stop = window.imnotaQuickCapture.onChange(() => void refresh());
    const stopDrag = window.imnotaQuickCapture.onDragError(setError);
    return () => {
      mounted.current = false;
      stop();
      stopDrag();
    };
  }, []);

  async function annotate(card: QuickCaptureCard) {
    setError('');
    try {
      const loaded = value(await window.imnotaQuickCapture.edit({ id: card.id, revision: card.revision }));
      value(await window.imnotaQuickCapture.resize(true));
      setEditor({ card, ...loaded });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Annotation could not open. The capture is kept.');
    }
  }
  useEffect(() => {
    const id = state.editorCaptureId;
    if (!id || requestedEditor.current === id) return;
    const card = state.cards.find((item) => item.id === id);
    if (!card) return;
    requestedEditor.current = id;
    void annotate(card);
  }, [state.editorCaptureId, state.cards]);

  if (editor)
    return (
      <CaptureEditor
        key={editor.card.id}
        {...editor}
        onClose={async () => {
          value(await window.imnotaQuickCapture.resize(false));
          setEditor(undefined);
          await refresh();
        }}
      />
    );
  return (
    <main className="quick-captures" aria-label="Pending captures">
      <header className="quick-capture-header">
        <strong>Pending captures · {state.cards.length}/3</strong>
        <Button onClick={() => void window.imnotaQuickCapture.hide()}>Hide</Button>
      </header>
      <p className="quick-capture-hint">Focus a card: Enter copies, E annotates, Esc hides.</p>
      {error && <p role="alert">{error}</p>}
      {state.destinationError && (
        <p role="alert">
          {state.destinationError} Copy and Discard remain available.{' '}
          <Button onClick={() => void refresh()}>Retry collections</Button>
        </p>
      )}
      <div className="quick-capture-list">
        {state.cards.map((card) => (
          <CaptureCard
            key={card.id}
            card={card}
            destinations={state.destinations}
            onAnnotate={() => void annotate(card)}
          />
        ))}
      </div>
      {!state.cards.length && <p>No pending captures.</p>}
    </main>
  );
}

function CaptureCard({
  card,
  destinations,
  onAnnotate,
}: {
  card: QuickCaptureCard;
  destinations: QuickCaptureState['destinations'];
  onAnnotate(): void;
}) {
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const identity = { id: card.id, revision: card.revision };
  async function act(action: () => Promise<WorkflowResult<void>>, success: string) {
    if (pending.current) return;
    pending.current = true;
    setError('');
    setMessage('');
    try {
      value(await action());
      setMessage(success);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The action failed. This capture is kept for retry.',
      );
    } finally {
      pending.current = false;
    }
  }
  function copy() {
    void act(() => window.imnotaQuickCapture.copy(identity), 'Image copied.');
  }
  const destinationKey = (item: QuickCaptureDestination) =>
    JSON.stringify([item.projectPath, item.collectionId]);
  const selected = card.destination ?? destinations.find((item) => destinationKey(item) === choice);
  return (
    <section
      className="quick-capture-card"
      data-testid={`quick-capture-${card.id}`}
      tabIndex={0}
      aria-label={`Capture ${card.width} by ${card.height}`}
      aria-keyshortcuts="Enter E Escape"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || card.busy) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          copy();
        }
        if (event.key.toLowerCase() === 'e') {
          event.preventDefault();
          onAnnotate();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          void window.imnotaQuickCapture.hide();
        }
      }}
    >
      <img src={card.previewDataUrl} alt={`Pending screenshot, ${card.width} × ${card.height}`} />
      <div className="quick-capture-actions">
        <Button variant="primary" disabled={card.busy} onClick={copy}>
          Copy image
        </Button>
        <Button disabled={card.busy || Boolean(card.destination)} onClick={onAnnotate}>
          Annotate
        </Button>
        <Button
          disabled={card.busy}
          draggable={!card.busy && card.dragAvailable}
          onFocus={() => {
            if (!card.dragAvailable)
              void act(() => window.imnotaQuickCapture.prepareDrag(identity), 'PNG ready to drag.');
          }}
          onPointerEnter={() => {
            if (!card.dragAvailable)
              void act(() => window.imnotaQuickCapture.prepareDrag(identity), 'PNG ready to drag.');
          }}
          onDragStart={(event) => {
            event.preventDefault();
            window.imnotaQuickCapture.startDrag(identity);
          }}
          title="Drag this PNG into another app. If dragging is unavailable, use Copy image or Add to collection."
        >
          Drag PNG
        </Button>
      </div>
      <label className="quick-capture-destination">
        <span>Add to collection</span>
        <select
          aria-label="Destination collection"
          disabled={card.busy || Boolean(card.destination)}
          value={card.destination ? 'bound' : choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Choose a collection</option>
          {card.destination && (
            <option value="bound">
              {destinations.find(
                (item) =>
                  item.projectPath === card.destination!.projectPath &&
                  item.collectionId === card.destination!.collectionId,
              )?.label ?? 'Original destination (retry)'}
            </option>
          )}
          {destinations.map((item) => (
            <option key={destinationKey(item)} value={destinationKey(item)}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="quick-capture-actions">
        <Button
          disabled={card.busy || !selected || (choice === '' && !card.destination)}
          onClick={() => {
            if (selected)
              void act(
                () =>
                  window.imnotaQuickCapture.add({
                    ...identity,
                    destination: { projectPath: selected.projectPath, collectionId: selected.collectionId },
                  }),
                'Capture added.',
              );
          }}
        >
          {card.destination ? 'Retry Add' : 'Add'}
        </Button>
        <Button
          disabled={card.busy}
          onClick={() => void act(() => window.imnotaQuickCapture.discard(identity), 'Capture discarded.')}
        >
          Discard
        </Button>
      </div>
      {(error || card.message) && <p role="alert">{error || card.message}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function CaptureEditor({
  card,
  image,
  annotations: initial,
  onClose,
}: {
  card: QuickCaptureCard;
  image: ImagePayload;
  annotations: Annotation[];
  onClose(): Promise<void>;
}) {
  const [annotations, setAnnotations] = useState(initial);
  const [tool, setTool] = useState<ToolChoice>('arrow');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stage = useRef<Konva.Stage | null>(null);
  const pending = useRef(false);
  return (
    <main
      className="quick-capture-editor"
      data-quick-capture-editor={card.id}
      aria-label="Annotate pending capture"
    >
      <header className="quick-capture-header">
        <strong>Annotate capture</strong>
        <Button
          disabled={busy}
          onClick={() => {
            void onClose().catch((reason) => setError(String(reason)));
          }}
        >
          Cancel edits
        </Button>
      </header>
      <div className="quick-capture-actions" aria-label="Annotation tools">
        {(['select', 'arrow', 'rectangle', 'text', 'blur', 'crop'] as const).map((item) => (
          <Button key={item} aria-pressed={tool === item} onClick={() => setTool(item)} disabled={busy}>
            {
              {
                select: 'Select / Move',
                arrow: 'Arrow',
                rectangle: 'Rectangle',
                text: 'Text',
                blur: 'Redact',
                crop: 'Crop',
              }[item]
            }
          </Button>
        ))}
      </div>
      <AnnotationCanvas
        image={image}
        annotations={annotations}
        selectedId={selectedId}
        tool={tool}
        onChange={setAnnotations}
        onSelect={setSelectedId}
        stageRef={stage}
        onTool={setTool}
      />
      {error && <p role="alert">{error}</p>}
      <footer>
        <Button
          disabled={busy || !selectedId}
          onClick={() => {
            setAnnotations((items) => items.filter((item) => item.id !== selectedId));
            setSelectedId(null);
          }}
        >
          Delete annotation
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError('');
            try {
              const pngDataUrl = await renderAnnotatedImage(image, annotations);
              value(
                await window.imnotaQuickCapture.apply({
                  id: card.id,
                  revision: card.revision,
                  annotations,
                  pngDataUrl,
                }),
              );
              await onClose();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Edits could not be applied. Your original capture is kept.',
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          Apply edits
        </Button>
      </footer>
    </main>
  );
}
