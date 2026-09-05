import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import type Konva from 'konva';
import type { Annotation, AnnotationKind, ImagePayload } from '../../shared/types';
import { createId } from '../../shared/utils';
import { pixelatedRegion } from '../pixelate';
import { zoomAt } from '../viewport';

const COLORS: Record<string, string> = {
  red: '#ef4444',
  blue: '#3ec6e0',
  green: '#22c55e',
  amber: '#f59e0b',
  white: '#ffffff',
};

function defaultAnnotation(
  kind: AnnotationKind,
  x: number,
  y: number,
  x2: number,
  y2: number,
  count: number,
): Annotation {
  const base = {
    id: createId('ann'),
    kind,
    x,
    y,
    width: Math.max(2, x2 - x),
    height: Math.max(2, y2 - y),
    rotation: 0,
    stroke: COLORS.red,
    fill: 'transparent',
    strokeWidth: 4,
    opacity: 1,
    zIndex: count,
  };
  if (kind === 'highlight')
    return { ...base, fill: '#f59e0b', opacity: 0.26, stroke: '#f59e0b', strokeWidth: 2 };
  if (kind === 'step')
    return {
      ...base,
      width: 48,
      height: 48,
      fill: '#6857f5',
      stroke: '#ffffff',
      strokeWidth: 2,
      stepNumber: count + 1,
    };
  if (kind === 'text')
    return {
      ...base,
      text: 'Text',
      fill: COLORS.red,
      stroke: COLORS.red,
      fontSize: 24,
      width: 260,
      height: 42,
    };
  if (kind === 'callout')
    return {
      ...base,
      text: 'Explain this area',
      fill: '#6857f5',
      stroke: '#6857f5',
      fontSize: 18,
      width: 240,
      height: 58,
    };
  if (kind === 'blur')
    return { ...base, fill: '#10131a', stroke: '#ffffff', opacity: 1, strokeWidth: 1, blurIntensity: 14 };
  return base;
}

export function AnnotationCanvas({
  image,
  annotations,
  selectedId,
  tool,
  onChange,
  onSelect,
  onMessage,
  stageRef,
  onTool,
}: {
  image: ImagePayload | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: AnnotationKind | 'select' | 'eraser';
  onChange: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
  onMessage?: (message: string) => void;
  stageRef: MutableRefObject<Konva.Stage | null>;
  onTool?: (tool: 'select') => void;
}) {
  void onMessage;
  const wrapRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pan = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId) {
      editorRef.current?.focus();
      editorRef.current?.select();
    }
  }, [editingId]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches('input, textarea, select') ||
          event.target.isContentEditable ||
          event.target.closest('[role="dialog"]'))
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        setSpaceHeld(true);
      }
      if (event.key === 'Escape') {
        setDraft(null);
        pan.current = null;
        onSelect(null);
      }
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        setViewport((v) =>
          zoomAt(v, { x: size.width / 2, y: size.height / 2 }, event.key === '-' ? 1 / 1.1 : 1.1),
        );
      }
      if (event.key === '1' && image)
        setViewport({ x: (size.width - image.width) / 2, y: (size.height - image.height) / 2, scale: 1 });
      if (event.key === '0' && image) {
        const fit = Math.max(
          0.02,
          Math.min((size.width - 64) / image.width, (size.height - 64) / image.height, 1),
        );
        setViewport({
          x: (size.width - image.width * fit) / 2,
          y: (size.height - image.height * fit) / 2,
          scale: fit,
        });
      }
    };
    const up = () => {
      setSpaceHeld(false);
      pan.current = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', up);
    };
  }, [image, size, onSelect]);
  useEffect(() => {
    if (!image?.dataUrl) {
      setImageObj(null);
      return;
    }
    const next = new window.Image();
    let cancelled = false;
    next.onload = () => {
      if (!cancelled) setImageObj(next);
    };
    next.src = image.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [image?.dataUrl]);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (wrapRef.current)
        setSize({ width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight });
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!image) return;
    const fit = Math.max(
      0.02,
      Math.min((size.width - 64) / image.width, (size.height - 64) / image.height, 1),
    );
    setViewport({
      x: (size.width - image.width * fit) / 2,
      y: (size.height - image.height * fit) / 2,
      scale: fit,
    });
  }, [image, size]);
  const scale = 1;
  const canvasWidth = size.width;
  const canvasHeight = size.height;
  const pixelated = useMemo(
    () =>
      new Map(
        imageObj
          ? [...annotations, ...(draft ? [draft] : [])]
              .filter((a) => a.kind === 'pixelate')
              .map((a) => [a.id, pixelatedRegion(imageObj, a)])
          : [],
      ),
    [imageObj, annotations, draft],
  );
  useEffect(() => {
    const node = transformerRef.current;
    if (!node) return;
    const selected = node.getStage()?.findOne(`#${selectedId ?? ''}`);
    node.nodes(selected ? [selected] : []);
    node.getLayer()?.batchDraw();
  }, [selectedId, annotations]);
  function point(event: Konva.KonvaEventObject<MouseEvent>) {
    const p = event.target.getStage()?.getPointerPosition();
    return p ? { x: (p.x - viewport.x) / viewport.scale, y: (p.y - viewport.y) / viewport.scale } : null;
  }
  function onDown(event: Konva.KonvaEventObject<MouseEvent>) {
    if (editing) return;
    if (
      event.evt.button === 1 ||
      spaceHeld ||
      (tool === 'select' && event.target === event.target.getStage())
    ) {
      event.evt.preventDefault();
      const pointer = event.target.getStage()?.getPointerPosition();
      if (pointer) pan.current = { ...pointer, originX: viewport.x, originY: viewport.y };
      return;
    }
    if (event.evt.button !== 0 || event.target.getParent()?.className === 'Transformer') return;
    if (tool === 'select') return;
    const p = point(event);
    if (!p) return;
    if (tool === 'eraser') {
      const hit = event.target;
      const id = hit.id();
      if (id) onChange(annotations.filter((a) => a.id !== id));
      return;
    }
    setDraft(defaultAnnotation(tool, p.x, p.y, p.x + 2, p.y + 2, annotations.length));
  }
  function onMove(event: Konva.KonvaEventObject<MouseEvent>) {
    if (pan.current) {
      const p = event.target.getStage()?.getPointerPosition();
      if (p)
        setViewport((v) => ({
          ...v,
          x: pan.current!.originX + p.x - pan.current!.x,
          y: pan.current!.originY + p.y - pan.current!.y,
        }));
      return;
    }
    if (!draft) return;
    if (['text', 'callout', 'step'].includes(draft.kind)) return;
    const p = point(event);
    if (!p) return;
    if (draft.kind === 'pen')
      setDraft({
        ...draft,
        points: [...(draft.points ?? [0, 0]), p.x - draft.x, p.y - draft.y],
        width: Math.max(4, Math.abs(p.x - draft.x)),
        height: Math.max(4, Math.abs(p.y - draft.y)),
      });
    else if (draft.kind === 'arrow' || draft.kind === 'line')
      setDraft({
        ...draft,
        points: [0, 0, p.x - draft.x, p.y - draft.y],
        width: Math.abs(p.x - draft.x),
        height: Math.abs(p.y - draft.y),
      });
    else setDraft({ ...draft, width: p.x - draft.x, height: p.y - draft.y });
  }
  function onUp() {
    if (pan.current) {
      pan.current = null;
      return;
    }
    if (!draft) return;
    if (
      Math.abs(draft.width ?? 0) < 4 &&
      Math.abs(draft.height ?? 0) < 4 &&
      !['text', 'callout', 'step'].includes(draft.kind)
    ) {
      setDraft(null);
      return;
    }
    onChange([
      ...annotations,
      {
        ...draft,
        x: draft.points ? draft.x : Math.min(draft.x, draft.x + (draft.width ?? 0)),
        y: draft.points ? draft.y : Math.min(draft.y, draft.y + (draft.height ?? 0)),
        width: Math.abs(draft.width ?? 0),
        height: Math.abs(draft.height ?? 0),
      },
    ]);
    onSelect(draft.id);
    if (draft.kind === 'text' || draft.kind === 'callout')
      setEditing({ id: draft.id, text: draft.text ?? '' });
    onTool?.('select');
    setDraft(null);
  }
  function update(id: string, patch: Partial<Annotation>) {
    onChange(annotations.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function renderAnnotation(a: Annotation) {
    const common = {
      key: a.id,
      id: a.id,
      x: a.x * scale,
      y: a.y * scale,
      rotation: a.rotation,
      opacity: a.kind === 'blur' ? 1 : a.opacity,
      draggable: tool === 'select' && !spaceHeld && !editing,
      visible: editing?.id !== a.id,
      onDblClick: () => {
        if (a.kind === 'text' || a.kind === 'callout') setEditing({ id: a.id, text: a.text ?? '' });
      },
      onDblTap: () => {
        if (a.kind === 'text' || a.kind === 'callout') setEditing({ id: a.id, text: a.text ?? '' });
      },
      onClick: () => onSelect(a.id),
      onTap: () => onSelect(a.id),
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
        update(a.id, {
          x: event.target.x() / scale - (a.kind === 'ellipse' ? (a.width ?? 0) / 2 : 0),
          y: event.target.y() / scale - (a.kind === 'ellipse' ? (a.height ?? 0) / 2 : 0),
        }),
    };
    const stroke = a.stroke ?? COLORS.red;
    const sw = (a.strokeWidth ?? 4) * scale;
    if (a.kind === 'pixelate')
      return (
        <KonvaImage
          {...common}
          image={pixelated.get(a.id)}
          width={(a.width ?? 20) * scale}
          height={(a.height ?? 20) * scale}
          imageSmoothingEnabled={false}
          opacity={1}
          rotation={0}
        />
      );
    if (a.kind === 'arrow')
      return (
        <Arrow
          {...common}
          points={(a.points ?? [0, 0, a.width ?? 10, a.height ?? 10]).map((n) => n * scale)}
          stroke={stroke}
          strokeWidth={sw}
          fill={stroke}
          pointerLength={12 * scale}
          pointerWidth={10 * scale}
          pointerAtEnding={a.arrowhead !== false}
        />
      );
    if (a.kind === 'line' || a.kind === 'pen')
      return (
        <Line
          {...common}
          points={(a.points ?? [0, 0, a.width ?? 10, a.height ?? 10]).map((n) => n * scale)}
          stroke={stroke}
          strokeWidth={sw}
          lineCap="round"
          lineJoin="round"
        />
      );
    if (a.kind === 'ellipse')
      return (
        <Ellipse
          {...common}
          radiusX={Math.abs(((a.width ?? 20) * scale) / 2)}
          radiusY={Math.abs(((a.height ?? 20) * scale) / 2)}
          x={(a.x + (a.width ?? 0) / 2) * scale}
          y={(a.y + (a.height ?? 0) / 2) * scale}
          stroke={stroke}
          strokeWidth={sw}
          fill={a.fill === 'transparent' ? undefined : a.fill}
        />
      );
    if (a.kind === 'text')
      return (
        <Text
          {...common}
          text={a.text ?? 'Text'}
          fontSize={(a.fontSize ?? 24) * scale}
          fontFamily={a.fontFamily ?? 'Arial'}
          fontStyle={a.fontStyle}
          align={a.align}
          fill={a.fill === 'transparent' ? '#ffffff' : a.fill}
          width={(a.width ?? 260) * scale}
          padding={6 * scale}
        />
      );
    if (a.kind === 'callout')
      return (
        <Group {...common}>
          <Rect
            width={(a.width ?? 240) * scale}
            height={(a.height ?? 58) * scale}
            fill={a.fill ?? '#6857f5'}
            cornerRadius={8 * scale}
          />
          <Text
            text={a.text ?? 'Callout'}
            fill="#fff"
            fontSize={(a.fontSize ?? 18) * scale}
            fontFamily={a.fontFamily ?? 'Arial'}
            fontStyle={a.fontStyle}
            align={a.align}
            width={(a.width ?? 240) * scale}
            height={(a.height ?? 58) * scale}
            padding={10 * scale}
            verticalAlign="middle"
          />
        </Group>
      );
    if (a.kind === 'step')
      return (
        <Group {...common}>
          <Ellipse
            radiusX={((a.width ?? 48) / 2) * scale}
            radiusY={((a.height ?? 48) / 2) * scale}
            fill={a.fill ?? '#6857f5'}
            stroke={a.stroke ?? '#fff'}
            strokeWidth={2 * scale}
            x={((a.width ?? 48) / 2) * scale}
            y={((a.height ?? 48) / 2) * scale}
          />
          <Text
            text={String(a.stepNumber ?? 1)}
            fill="#fff"
            fontSize={Math.min(a.width ?? 48, a.height ?? 48) * 0.46 * scale}
            fontStyle="bold"
            width={(a.width ?? 48) * scale}
            height={(a.height ?? 48) * scale}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );
    return (
      <Rect
        {...common}
        width={Math.abs((a.width ?? 20) * scale)}
        height={Math.abs((a.height ?? 20) * scale)}
        stroke={stroke}
        strokeWidth={sw}
        fill={a.kind === 'blur' ? '#0b0d12' : a.fill === 'transparent' ? undefined : a.fill}
        cornerRadius={a.kind === 'rounded-rectangle' ? 8 * scale : 0}
        dash={a.kind === 'crop' ? [8 * scale, 6 * scale] : undefined}
      />
    );
  }
  return (
    <div
      className="canvas-wrap"
      style={{ cursor: spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}
      ref={wrapRef}
      data-image-x={viewport.x}
      data-image-y={viewport.y}
      data-image-scale={viewport.scale}
    >
      <div className="canvas-meta">
        <span>{image ? `${image.width} × ${image.height}` : 'No screenshot selected'}</span>
        <span>
          {Math.round(viewport.scale * 100)}% · {tool === 'select' ? 'Select and move' : `Tool: ${tool}`}
        </span>
      </div>
      {imageObj ? (
        <Stage
          ref={stageRef}
          width={canvasWidth}
          height={canvasHeight}
          className="konva-stage"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={() => {
            pan.current = null;
          }}
          onWheel={(event) => {
            event.evt.preventDefault();
            if (event.evt.ctrlKey || event.evt.metaKey) {
              const p = event.target.getStage()?.getPointerPosition();
              if (!p) return;
              setViewport((v) => zoomAt(v, p, Math.exp(-event.evt.deltaY * 0.01)));
            } else setViewport((v) => ({ ...v, x: v.x - event.evt.deltaX, y: v.y - event.evt.deltaY }));
          }}
          onClick={(event) => {
            if (event.target === event.target.getStage()) onSelect(null);
          }}
        >
          <Layer>
            <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
              <KonvaImage image={imageObj} width={image?.width} height={image?.height} listening={false} />
              {[...annotations].sort((a, b) => a.zIndex - b.zIndex).map(renderAnnotation)}
              {draft && renderAnnotation(draft)}
              <Transformer
                ref={transformerRef}
                rotateEnabled={
                  !['crop', 'pixelate'].includes(annotations.find((a) => a.id === selectedId)?.kind ?? '')
                }
                keepRatioEnabled={false}
                borderStroke="#6857f5"
                anchorStroke="#6857f5"
                anchorFill="#fff"
                anchorSize={10}
                onTransformEnd={() => {
                  const node = transformerRef.current?.nodes()[0];
                  if (node && selectedId) {
                    const selected = annotations.find((a) => a.id === selectedId);
                    const width = Math.max(2, (selected?.width ?? node.width() / scale) * node.scaleX());
                    const height = Math.max(2, (selected?.height ?? node.height() / scale) * node.scaleY());
                    update(selectedId, {
                      x: node.x() / scale - (selected?.kind === 'ellipse' ? width / 2 : 0),
                      y: node.y() / scale - (selected?.kind === 'ellipse' ? height / 2 : 0),
                      rotation: node.rotation(),
                      width,
                      height,
                      ...(selected?.points
                        ? {
                            points: selected.points.map(
                              (point, index) => point * (index % 2 === 0 ? node.scaleX() : node.scaleY()),
                            ),
                          }
                        : {}),
                    });
                    node.scaleX(1);
                    node.scaleY(1);
                  }
                }}
              />
            </Group>
          </Layer>
        </Stage>
      ) : (
        <div className="canvas-empty">
          <span>Import a screenshot to begin marking context.</span>
        </div>
      )}
      {editing &&
        (() => {
          const a = annotations.find((item) => item.id === editing.id);
          if (!a) return null;
          return (
            <textarea
              ref={editorRef}
              aria-label="Edit annotation text"
              className="canvas-text-editor"
              value={editing.text}
              style={{
                left: viewport.x + a.x * viewport.scale,
                top: viewport.y + a.y * viewport.scale,
                width: Math.max(160, (a.width ?? 260) * viewport.scale),
                minHeight: Math.max(60, (a.height ?? 42) * viewport.scale),
                fontSize: Math.max(12, (a.fontSize ?? 24) * viewport.scale),
                transform: `rotate(${a.rotation ?? 0}deg)`,
              }}
              onChange={(event) => setEditing({ ...editing, text: event.target.value })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  update(a.id, { text: editing.text });
                  setEditing(null);
                }
              }}
              onBlur={() => {
                update(a.id, { text: editing.text });
                setEditing(null);
              }}
            />
          );
        })()}
      <div className="canvas-hint">
        Space + drag to pan · Pinch to zoom · 0 fit · 1 actual size · Double-click text to edit
      </div>
    </div>
  );
}
