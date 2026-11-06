import { useEffect, useRef, useState } from 'react';
import { Columns2 } from 'lucide-react';
import type { ProjectData, ScreenshotComparison as Pair } from '../../shared/types';
import { comparisonLabels } from '../../shared/screenshot-comparison';
import { nowIso } from '../../shared/utils';
import { Button, Modal } from '../components/ui';
import { useAppStore } from '../store';
import { renderAnnotatedImageWithDimensions, type AnnotatedImageRender } from '../export-image';
import './screenshot-comparison.css';

interface Props {
  onFlush(): Promise<boolean>;
  onSaveProject(project: ProjectData): Promise<boolean>;
}

export function ScreenshotComparison(props: Props) {
  const store = useAppStore();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const collection = store.snapshot?.project.collections.find(
    (entry) => entry.id === store.activeCollectionId,
  );
  const screenshots =
    store.snapshot?.project.screenshots.filter((shot) => shot.collectionId === collection?.id) ?? [];
  if (!collection || !store.snapshot) return null;
  return (
    <>
      <Button
        data-testid="compare-screenshots"
        variant="ghost"
        disabled={busy || (!collection.comparison && screenshots.length < 2)}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError('');
          try {
            if (!(await props.onFlush()))
              throw new Error('Save the current edits before comparing screenshots.');
            setOpen(true);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Comparison could not be opened.');
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <Columns2 size={16} aria-hidden="true" />
        Compare
      </Button>
      {error && <span role="alert">{error}</span>}
      {open && <ComparisonDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ComparisonDialog({ onFlush, onSaveProject, onClose }: Props & { onClose(): void }) {
  const store = useAppStore();
  const identity = useRef({
    path: store.snapshot!.projectPath,
    collectionId: store.activeCollectionId,
  }).current;
  const collection = store.snapshot!.project.collections.find((entry) => entry.id === identity.collectionId)!;
  const shots = store
    .snapshot!.project.screenshots.filter((shot) => shot.collectionId === identity.collectionId)
    .sort((a, b) => a.position - b.position);
  const [pair, setPair] = useState<Pair>(
    () =>
      collection.comparison ?? {
        kind: 'current-expected',
        leftId: shots.find((shot) => shot.id === store.activeScreenshotId)?.id ?? shots[0]?.id ?? '',
        rightId: shots.find((shot) => shot.id !== (store.activeScreenshotId ?? shots[0]?.id))?.id ?? '',
      },
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const labels = comparisonLabels(pair.kind);
  const valid =
    pair.leftId !== pair.rightId &&
    [pair.leftId, pair.rightId].every((id) => shots.some((shot) => shot.id === id));

  async function save(remove = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!(await onFlush()))
        throw new Error('Current edits could not be saved. Your comparison selections are kept for retry.');
      const current = useAppStore.getState().snapshot;
      if (
        current?.projectPath !== identity.path ||
        !current.project.collections.some((entry) => entry.id === identity.collectionId)
      )
        throw new Error('The open collection changed. Close comparison and reopen it.');
      if (
        !remove &&
        ![pair.leftId, pair.rightId].every((id) =>
          current.project.screenshots.some(
            (shot) => shot.id === id && shot.collectionId === identity.collectionId,
          ),
        )
      )
        throw new Error('A selected screenshot is no longer available. Choose another screenshot.');
      const timestamp = nowIso();
      const next = {
        ...current.project,
        updatedAt: timestamp,
        collections: current.project.collections.map((entry) => {
          if (entry.id !== identity.collectionId) return entry;
          const rest = { ...entry };
          delete rest.comparison;
          return { ...rest, updatedAt: timestamp, ...(!remove ? { comparison: pair } : {}) };
        }),
      };
      if (!(await onSaveProject(next)))
        throw new Error('Comparison could not be saved. Your selections are kept; retry Save comparison.');
      if (alive.current) {
        if (remove) onClose();
        else setMessage('Comparison saved. Roles will be included in prompt bundles.');
      }
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Comparison could not be saved.');
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Modal
      title="Compare screenshots"
      description="Pair existing evidence without changing collection order. Save the pair to include its roles in prompt bundles."
      variant="preview"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <div className="comparison-content">
        <div className="comparison-controls">
          <label className="field">
            <span className="field-label">Comparison</span>
            <select
              aria-label="Comparison"
              value={pair.kind}
              disabled={busy}
              onChange={(event) => {
                setPair({ ...pair, kind: event.target.value as Pair['kind'] });
                setMessage('');
              }}
            >
              <option value="current-expected">Current / Expected</option>
              <option value="before-after">Before / After</option>
            </select>
          </label>
          {(['leftId', 'rightId'] as const).map((side, index) => (
            <label className="field" key={side}>
              <span className="field-label">{labels[index]} screenshot</span>
              <select
                aria-label={`${labels[index]} screenshot`}
                value={pair[side]}
                disabled={busy}
                onChange={(event) => {
                  setPair({ ...pair, [side]: event.target.value });
                  setMessage('');
                }}
              >
                {!shots.some((shot) => shot.id === pair[side]) && (
                  <option value={pair[side]}>Screenshot unavailable — choose another</option>
                )}
                {shots.map((shot) => (
                  <option key={shot.id} value={shot.id}>
                    {shot.title || shot.originalFilename}
                    {shot.includeInExport ? '' : ' (excluded)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {!valid && (
          <p role="status">
            Choose two different available screenshots. A deleted counterpart can be restored through Undo or
            Recently deleted.
          </p>
        )}
        {valid && (
          <ComparisonImages
            key={`${pair.leftId}:${pair.rightId}:${store.snapshot?.projectRevision ?? ''}`}
            projectPath={identity.path}
            shots={[
              shots.find((shot) => shot.id === pair.leftId)!,
              shots.find((shot) => shot.id === pair.rightId)!,
            ]}
            labels={labels}
          />
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          {collection.comparison && (
            <Button disabled={busy} onClick={() => void save(true)}>
              Remove comparison
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Done
          </Button>
          <Button variant="primary" disabled={!valid || busy} busy={busy} onClick={() => void save()}>
            Save comparison
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ComparisonImages({
  projectPath,
  shots,
  labels,
}: {
  projectPath: string;
  shots: [ProjectData['screenshots'][number], ProjectData['screenshots'][number]];
  labels: readonly [string, string];
}) {
  type ComparisonImage = AnnotatedImageRender & { sourceWidth: number; sourceHeight: number };
  const [images, setImages] = useState<ComparisonImage[]>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [zooms, setZooms] = useState([100, 100]);
  const [linked, setLinked] = useState(true);
  const panes = useRef<Array<HTMLDivElement | null>>([]);
  // Pair identity owns this component. Render sequentially and discard obsolete results.
  const initialShots = useRef(shots).current;
  useEffect(() => {
    let active = true;
    setError('');
    setImages([]);
    void (async () => {
      const rendered: ComparisonImage[] = [];
      for (const screenshot of initialShots) {
        const content = await window.imnota.loadScreenshotContent({ projectPath, screenshot });
        if (!active) return;
        rendered.push({
          ...(await renderAnnotatedImageWithDimensions(content.image, content.annotations)),
          sourceWidth: content.image.width,
          sourceHeight: content.image.height,
        });
        if (!active) return;
      }
      setImages(rendered);
    })().catch((reason: unknown) => {
      if (active)
        setError(reason instanceof Error ? reason.message : 'Comparison images could not be loaded.');
    });
    return () => {
      active = false;
    };
  }, [initialShots, projectPath, attempt]);
  const comparable =
    images.length === 2 && images[0].width === images[1].width && images[0].height === images[1].height;
  return (
    <>
      {shots.some((shot) => !shot.includeInExport) && (
        <p role="status">
          Comparison incomplete for export: an excluded screenshot is visible here but will not be included in
          prompt images.
        </p>
      )}
      {error ? (
        <div role="alert">
          {error} <Button onClick={() => setAttempt((value) => value + 1)}>Retry images</Button>
        </div>
      ) : images.length !== 2 ? (
        <p role="status">Rendering comparison…</p>
      ) : (
        <>
          <label className="comparison-link">
            <input
              type="checkbox"
              checked={linked && comparable}
              disabled={!comparable}
              onChange={(event) => {
                setLinked(event.target.checked);
                setZooms([100, 100]);
                panes.current.forEach((pane) => pane?.scrollTo(0, 0));
              }}
            />
            Link zoom and scrolling
          </label>
          {!comparable && (
            <p>
              Rendered dimensions differ. Views scroll and zoom independently; images are not stretched or
              automatically aligned.
            </p>
          )}
          <div className="comparison-images">
            {images.map((image, index) => (
              <section key={shots[index].id} className="comparison-image">
                <h3>
                  {labels[index]} · {shots[index].title || shots[index].originalFilename}
                </h3>
                <p>
                  Source: {image.sourceWidth}×{image.sourceHeight} · Rendered: {image.width}×{image.height}
                </p>
                <label className="field">
                  <span className="field-label">
                    {labels[index]} zoom: {zooms[index]}%
                  </span>
                  <input
                    aria-label={`${labels[index]} zoom`}
                    type="range"
                    min="100"
                    max="400"
                    step="25"
                    value={zooms[index]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setZooms((current) =>
                        linked && comparable
                          ? [value, value]
                          : current.map((zoom, side) => (side === index ? value : zoom)),
                      );
                    }}
                  />
                </label>
                <div
                  className="comparison-viewport"
                  tabIndex={0}
                  role="region"
                  aria-label={`${labels[index]} image; use arrow keys to scroll`}
                  ref={(pane) => {
                    panes.current[index] = pane;
                  }}
                  onScroll={(event) => {
                    if (!linked || !comparable) return;
                    const source = event.currentTarget;
                    const target = panes.current[1 - index];
                    if (!target) return;
                    for (const [position, size, client] of [
                      ['scrollLeft', 'scrollWidth', 'clientWidth'],
                      ['scrollTop', 'scrollHeight', 'clientHeight'],
                    ] as const) {
                      const ratio = source[position] / Math.max(1, source[size] - source[client]);
                      const next = ratio * Math.max(0, target[size] - target[client]);
                      if (Math.abs(target[position] - next) > 1) target[position] = next;
                    }
                  }}
                >
                  <img
                    src={image.dataUrl}
                    alt={`${labels[index]} annotated screenshot`}
                    style={{ inlineSize: `${zooms[index]}%` }}
                    draggable={false}
                  />
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
