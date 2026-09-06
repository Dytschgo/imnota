import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
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
import { textAnnotationNoteNumbers } from '../../shared/annotation-order';
import {
  NOTE_BADGE_GAP,
  NOTE_BADGE_HEIGHT,
  noteBadgeWidth,
  textAnnotationLayout,
} from '../../shared/annotation-geometry';
import type { Annotation, AnnotationKind, ImagePayload } from '../../shared/types';
import { createId } from '../../shared/utils';
import {
  createBrowserTextMeasurer,
  edgePanVelocity,
  liveTextColor,
  semanticAnnotationColor,
  type CanvasTheme,
} from '../canvas/annotation-layout';
import { pixelatedRegion } from '../pixelate';
import { zoomAt } from '../viewport';
import type { ToolChoice } from './Toolbar';
import './annotation-canvas.css';

type ThemePreference = CanvasTheme | 'system';

interface EditingText {
  id: string;
  text: string;
  isNew: boolean;
}

interface DraggingAnnotation {
  id: string;
  kind: AnnotationKind;
  node: Konva.Node;
}

export interface AnnotationCanvasProps {
  image: ImagePayload | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: ToolChoice;
  onChange: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
  onMessage?: (message: string) => void;
  stageRef: MutableRefObject<Konva.Stage | null>;
  onTool?: (tool: ToolChoice) => void;
  /** Pass the resolved app setting for immediate theme updates; DOM theme detection is the fallback. */
  theme?: ThemePreference;
  /** Optional current palette color for newly created annotations. */
  annotationColor?: string;
}

function systemTheme(): CanvasTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function domTheme(preference?: ThemePreference): CanvasTheme {
  if (preference && preference !== 'system') return preference;
  const attribute = document.documentElement.dataset.theme;
  if (attribute === 'light' || attribute === 'dark') return attribute;
  return systemTheme();
}

function useCanvasTheme(preference?: ThemePreference): CanvasTheme {
  const [theme, setTheme] = useState<CanvasTheme>(() => domTheme(preference));
  useEffect(() => {
    const update = () => setTheme(domTheme(preference));
    update();
    if (preference && preference !== 'system') return;
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', update);
    };
  }, [preference]);
  return theme;
}

export function createDefaultAnnotation(
  kind: AnnotationKind,
  x: number,
  y: number,
  x2: number,
  y2: number,
  count: number,
  theme: CanvasTheme,
  color?: string,
): Annotation {
  const semanticColor = color ?? semanticAnnotationColor(kind, theme);
  const base = {
    id: createId('ann'),
    kind,
    x,
    y,
    width: Math.max(2, x2 - x),
    height: Math.max(2, y2 - y),
    rotation: 0,
    stroke: semanticColor,
    fill: 'transparent',
    strokeWidth: 4,
    opacity: 1,
    zIndex: count,
  };
  if (kind === 'highlight')
    return { ...base, fill: semanticColor, opacity: 0.26, stroke: semanticColor, strokeWidth: 2 };
  if (kind === 'step')
    return {
      ...base,
      width: 48,
      height: 48,
      fill: semanticColor,
      stroke: '#ffffff',
      strokeWidth: 2,
      stepNumber: annotationsStepNumber(count),
    };
  if (kind === 'text')
    return {
      ...base,
      text: '',
      fill: semanticColor,
      stroke: semanticColor,
      fontSize: 24,
      width: 260,
      height: 42,
    };
  if (kind === 'callout')
    return {
      ...base,
      text: '',
      fill: semanticColor,
      stroke: semanticColor,
      fontSize: 18,
      width: 240,
      height: 58,
    };
  if (kind === 'blur')
    return { ...base, fill: '#0b0d12', stroke: '#ffffff', opacity: 1, strokeWidth: 1, blurIntensity: 14 };
  return base;
}

function annotationsStepNumber(count: number): number {
  return count + 1;
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
  theme: themePreference,
  annotationColor,
}: AnnotationCanvasProps) {
  const theme = useCanvasTheme(themePreference);
  const measureText = useMemo(() => createBrowserTextMeasurer(), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pan = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [editing, setEditing] = useState<EditingText | null>(null);
  const capturedPointer = useRef<number | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef<DraggingAnnotation | null>(null);
  const edgePanFrame = useRef<number | null>(null);
  const edgePanTime = useRef<number | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const stopEdgePan = useCallback(() => {
    if (edgePanFrame.current !== null) cancelAnimationFrame(edgePanFrame.current);
    edgePanFrame.current = null;
    edgePanTime.current = null;
  }, []);

  const runEdgePan = useCallback(
    (time: number) => {
      const active = dragging.current;
      const pointer = pointerPosition.current;
      if (!active || !pointer) {
        stopEdgePan();
        return;
      }
      const elapsed = edgePanTime.current === null ? 16.67 : Math.min(34, time - edgePanTime.current);
      edgePanTime.current = time;
      const velocity = edgePanVelocity(pointer, size);
      const frameScale = elapsed / 16.67;
      const shiftX = velocity.x * frameScale;
      const shiftY = velocity.y * frameScale;
      if (shiftX || shiftY) {
        const scale = viewportRef.current.scale;
        const next = {
          ...viewportRef.current,
          x: viewportRef.current.x - shiftX,
          y: viewportRef.current.y - shiftY,
        };
        viewportRef.current = next;
        setViewport(next);
        active.node.position({
          x: active.node.x() + shiftX / scale,
          y: active.node.y() + shiftY / scale,
        });
        active.node.getLayer()?.batchDraw();
      }
      edgePanFrame.current = requestAnimationFrame(runEdgePan);
    },
    [size, stopEdgePan],
  );

  const startEdgePan = useCallback(() => {
    if (edgePanFrame.current === null) edgePanFrame.current = requestAnimationFrame(runEdgePan);
  }, [runEdgePan]);

  useEffect(() => stopEdgePan, [stopEdgePan]);

  const editingId = editing?.id;
  useEffect(() => {
    if (!editingId) return;
    editorRef.current?.focus();
    if (!editing?.isNew) editorRef.current?.select();
  }, [editingId, editing?.isNew]);

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
        setViewport((current) =>
          zoomAt(current, { x: size.width / 2, y: size.height / 2 }, event.key === '-' ? 1 / 1.1 : 1.1),
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
      dragging.current = null;
      stopEdgePan();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', up);
    };
  }, [image, onSelect, size, stopEdgePan]);

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
    const resizeObserver = new ResizeObserver(() => {
      if (wrapRef.current)
        setSize({ width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight });
    });
    if (wrapRef.current) resizeObserver.observe(wrapRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!image) return;
    const fit = Math.max(
      0.02,
      Math.min((size.width - 64) / image.width, (size.height - 64) / image.height, 1),
    );
    const next = {
      x: (size.width - image.width * fit) / 2,
      y: (size.height - image.height * fit) / 2,
      scale: fit,
    };
    viewportRef.current = next;
    setViewport(next);
  }, [image, size]);

  const pixelated = useMemo(
    () =>
      new Map(
        imageObj
          ? [...annotations, ...(draft ? [draft] : [])]
              .filter((annotation) => annotation.kind === 'pixelate')
              .map((annotation) => [annotation.id, pixelatedRegion(imageObj, annotation)])
          : [],
      ),
    [annotations, draft, imageObj],
  );
  const noteNumbers = useMemo(() => textAnnotationNoteNumbers(annotations), [annotations]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const selected = transformer.getStage()?.findOne(`#${selectedId ?? ''}`);
    transformer.nodes(selected ? [selected] : []);
    transformer.getLayer()?.batchDraw();
  }, [annotations, selectedId]);

  function localPointer(event: PointerEvent | MouseEvent | DragEvent): { x: number; y: number } | null {
    const bounds = wrapRef.current?.getBoundingClientRect();
    if (!bounds || !('clientX' in event)) return null;
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function imagePoint(event: PointerEvent | MouseEvent): { x: number; y: number } | null {
    const pointer = localPointer(event);
    if (!pointer) return null;
    return {
      x: (pointer.x - viewportRef.current.x) / viewportRef.current.scale,
      y: (pointer.y - viewportRef.current.y) / viewportRef.current.scale,
    };
  }

  function pointerIsOnImage(point: { x: number; y: number }): boolean {
    return Boolean(
      image && point.x >= 0 && point.y >= 0 && point.x <= image.width && point.y <= image.height,
    );
  }

  function capturePointer(event: Konva.KonvaEventObject<PointerEvent>) {
    const container = event.target.getStage()?.container();
    if (!container) return;
    try {
      container.setPointerCapture(event.evt.pointerId);
      capturedPointer.current = event.evt.pointerId;
    } catch {
      capturedPointer.current = null;
    }
  }

  function releasePointer(event: Konva.KonvaEventObject<PointerEvent>) {
    const container = event.target.getStage()?.container();
    const pointerId = capturedPointer.current;
    if (!container || pointerId === null) return;
    try {
      if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser after cancellation.
    }
    capturedPointer.current = null;
  }

  function beginTextEditing(annotation: Annotation, isNew: boolean) {
    onSelect(annotation.id);
    onTool?.('text');
    setEditing({
      id: annotation.id,
      text: annotation.text ?? '',
      isNew,
    });
  }

  function createTextAt(point: { x: number; y: number }) {
    if (!pointerIsOnImage(point)) return;
    const annotation = createDefaultAnnotation(
      'text',
      point.x,
      point.y,
      point.x + 2,
      point.y + 2,
      annotations.length,
      theme,
      annotationColor,
    );
    onChange([...annotations, annotation]);
    beginTextEditing(annotation, true);
  }

  function update(id: string, patch: Partial<Annotation>) {
    onChange(annotations.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function finishEditing(commit: boolean) {
    if (!editing) return;
    const annotation = annotations.find((item) => item.id === editing.id);
    if (!annotation) {
      setEditing(null);
      onTool?.('select');
      return;
    }
    if (!commit) {
      if (editing.isNew) {
        onChange(annotations.filter((item) => item.id !== editing.id));
        onSelect(null);
      }
      setEditing(null);
      onTool?.('select');
      return;
    }
    const nextText = editing.text;
    if (editing.isNew && !nextText.trim()) {
      onChange(annotations.filter((item) => item.id !== editing.id));
      onSelect(null);
    } else {
      const layout = textAnnotationLayout({ ...annotation, text: nextText }, measureText);
      const editorWidth = editorRef.current?.offsetWidth
        ? editorRef.current.offsetWidth / viewportRef.current.scale
        : layout.width;
      const editorHeight = editorRef.current?.scrollHeight
        ? editorRef.current.scrollHeight / viewportRef.current.scale
        : layout.height;
      update(annotation.id, {
        text: nextText,
        width: Math.max(72, editorWidth),
        height: Math.max(layout.height, editorHeight),
      });
      onMessage?.(editing.isNew ? 'Text note added' : 'Text note updated');
    }
    setEditing(null);
    onTool?.('select');
  }

  function beginPointer(event: Konva.KonvaEventObject<PointerEvent>) {
    capturePointer(event);
    const pointer = localPointer(event.evt);
    if (pointer) pointerPosition.current = pointer;
    if (editing) return;
    const stage = event.target.getStage();
    if (event.evt.button === 1 || spaceHeld || (tool === 'select' && event.target === stage)) {
      event.evt.preventDefault();
      if (pointer)
        pan.current = { ...pointer, originX: viewportRef.current.x, originY: viewportRef.current.y };
      return;
    }
    if (event.evt.button !== 0 || event.target.getParent()?.className === 'Transformer') return;
    if (tool === 'select') return;
    const point = imagePoint(event.evt);
    if (!point || !pointerIsOnImage(point)) return;
    if (tool === 'eraser') {
      const id = event.target.id();
      if (id) onChange(annotations.filter((annotation) => annotation.id !== id));
      return;
    }
    if (tool === 'text') {
      createTextAt(point);
      return;
    }
    setDraft(
      createDefaultAnnotation(
        tool,
        point.x,
        point.y,
        point.x + 2,
        point.y + 2,
        annotations.length,
        theme,
        annotationColor,
      ),
    );
  }

  function movePointer(event: Konva.KonvaEventObject<PointerEvent>) {
    const pointer = localPointer(event.evt);
    if (pointer) pointerPosition.current = pointer;
    if (pan.current && pointer) {
      const next = {
        ...viewportRef.current,
        x: pan.current.originX + pointer.x - pan.current.x,
        y: pan.current.originY + pointer.y - pan.current.y,
      };
      viewportRef.current = next;
      setViewport(next);
      return;
    }
    if (!draft || ['callout', 'step'].includes(draft.kind)) return;
    const point = imagePoint(event.evt);
    if (!point) return;
    if (draft.kind === 'pen')
      setDraft({
        ...draft,
        points: [...(draft.points ?? [0, 0]), point.x - draft.x, point.y - draft.y],
        width: Math.max(4, Math.abs(point.x - draft.x)),
        height: Math.max(4, Math.abs(point.y - draft.y)),
      });
    else if (draft.kind === 'arrow' || draft.kind === 'line')
      setDraft({
        ...draft,
        points: [0, 0, point.x - draft.x, point.y - draft.y],
        width: Math.abs(point.x - draft.x),
        height: Math.abs(point.y - draft.y),
      });
    else setDraft({ ...draft, width: point.x - draft.x, height: point.y - draft.y });
  }

  function endPointer(event: Konva.KonvaEventObject<PointerEvent>) {
    releasePointer(event);
    if (pan.current) {
      pan.current = null;
      return;
    }
    if (!draft) return;
    if (
      Math.abs(draft.width ?? 0) < 4 &&
      Math.abs(draft.height ?? 0) < 4 &&
      !['callout', 'step'].includes(draft.kind)
    ) {
      setDraft(null);
      return;
    }
    const completed = {
      ...draft,
      x: draft.points ? draft.x : Math.min(draft.x, draft.x + (draft.width ?? 0)),
      y: draft.points ? draft.y : Math.min(draft.y, draft.y + (draft.height ?? 0)),
      width: Math.abs(draft.width ?? 0),
      height: Math.abs(draft.height ?? 0),
    };
    onChange([...annotations, completed]);
    onSelect(completed.id);
    if (completed.kind === 'callout') beginTextEditing(completed, true);
    else onTool?.('select');
    setDraft(null);
  }

  function cancelPointer(event: Konva.KonvaEventObject<PointerEvent>) {
    releasePointer(event);
    pan.current = null;
    const active = dragging.current;
    if (active)
      update(active.id, {
        x: active.node.x() - (active.kind === 'ellipse' ? active.node.width() / 2 : 0),
        y: active.node.y() - (active.kind === 'ellipse' ? active.node.height() / 2 : 0),
      });
    dragging.current = null;
    stopEdgePan();
  }

  function dragPointer(event: Konva.KonvaEventObject<DragEvent>) {
    const pointer = localPointer(event.evt);
    if (pointer) pointerPosition.current = pointer;
  }

  function startAnnotationDrag(annotation: Annotation, event: Konva.KonvaEventObject<DragEvent>) {
    dragging.current = { id: annotation.id, kind: annotation.kind, node: event.target };
    dragPointer(event);
    startEdgePan();
  }

  function endAnnotationDrag(annotation: Annotation, event: Konva.KonvaEventObject<DragEvent>) {
    stopEdgePan();
    dragging.current = null;
    update(annotation.id, {
      x: event.target.x() - (annotation.kind === 'ellipse' ? (annotation.width ?? 0) / 2 : 0),
      y: event.target.y() - (annotation.kind === 'ellipse' ? (annotation.height ?? 0) / 2 : 0),
    });
  }

  function commonProps(annotation: Annotation) {
    return {
      key: annotation.id,
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      rotation: annotation.rotation,
      opacity: annotation.kind === 'blur' ? 1 : annotation.opacity,
      draggable: tool === 'select' && !spaceHeld && !editing,
      visible: editing?.id !== annotation.id,
      onPointerDblClick: () => {
        if (annotation.kind === 'text' || annotation.kind === 'callout') beginTextEditing(annotation, false);
      },
      onDblTap: () => {
        if (annotation.kind === 'text' || annotation.kind === 'callout') beginTextEditing(annotation, false);
      },
      onPointerClick: () => onSelect(annotation.id),
      onTap: () => onSelect(annotation.id),
      onDragStart: (event: Konva.KonvaEventObject<DragEvent>) => startAnnotationDrag(annotation, event),
      onDragMove: dragPointer,
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => endAnnotationDrag(annotation, event),
    };
  }

  function renderAnnotation(annotation: Annotation) {
    const common = commonProps(annotation);
    const stroke = annotation.stroke ?? '#ef4444';
    const strokeWidth = annotation.strokeWidth ?? 4;
    if (annotation.kind === 'pixelate')
      return (
        <KonvaImage
          {...common}
          image={pixelated.get(annotation.id)}
          width={annotation.width ?? 20}
          height={annotation.height ?? 20}
          imageSmoothingEnabled={false}
          opacity={1}
          rotation={0}
        />
      );
    if (annotation.kind === 'arrow')
      return (
        <Arrow
          {...common}
          points={annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={stroke}
          pointerLength={12}
          pointerWidth={10}
          pointerAtEnding={annotation.arrowhead !== false}
        />
      );
    if (annotation.kind === 'line' || annotation.kind === 'pen')
      return (
        <Line
          {...common}
          points={annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
        />
      );
    if (annotation.kind === 'ellipse')
      return (
        <Ellipse
          {...common}
          radiusX={Math.abs((annotation.width ?? 20) / 2)}
          radiusY={Math.abs((annotation.height ?? 20) / 2)}
          x={annotation.x + (annotation.width ?? 0) / 2}
          y={annotation.y + (annotation.height ?? 0) / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={annotation.fill === 'transparent' ? undefined : annotation.fill}
        />
      );
    if (annotation.kind === 'text') {
      const layout = textAnnotationLayout(annotation, measureText);
      const noteNumber = noteNumbers.get(annotation.id);
      const badgeWidth = noteNumber ? noteBadgeWidth(noteNumber) : 0;
      return (
        <Group {...common} width={layout.width} height={layout.height}>
          <Text
            text={layout.wrappedText}
            fontSize={layout.fontSize}
            fontFamily={annotation.fontFamily ?? 'Arial'}
            fontStyle={annotation.fontStyle}
            align={annotation.align}
            fill={liveTextColor(
              annotation.fill === 'transparent' ? annotation.stroke : (annotation.fill ?? annotation.stroke),
              theme,
            )}
            width={layout.width}
            height={layout.height}
            padding={layout.padding}
            lineHeight={1.25}
            wrap="none"
          />
          {noteNumber && (
            <Group x={layout.width + NOTE_BADGE_GAP} y={0} listening={false}>
              <Rect
                width={badgeWidth}
                height={NOTE_BADGE_HEIGHT}
                fill="#111827"
                stroke="#ffffff"
                strokeWidth={1}
                cornerRadius={5}
              />
              <Text
                text={`Note ${noteNumber}`}
                width={badgeWidth}
                height={NOTE_BADGE_HEIGHT}
                fill="#ffffff"
                fontSize={11}
                fontStyle="bold"
                align="center"
                verticalAlign="middle"
              />
            </Group>
          )}
        </Group>
      );
    }
    if (annotation.kind === 'callout') {
      const layout = textAnnotationLayout(annotation, measureText);
      const noteNumber = noteNumbers.get(annotation.id);
      const badgeWidth = noteNumber ? noteBadgeWidth(noteNumber) : 0;
      return (
        <Group {...common} width={layout.width} height={layout.height}>
          <Rect
            width={layout.width}
            height={layout.height}
            fill={annotation.fill ?? '#6857f5'}
            cornerRadius={8}
          />
          <Text
            text={layout.wrappedText}
            fill="#ffffff"
            fontSize={layout.fontSize}
            fontFamily={annotation.fontFamily ?? 'Arial'}
            fontStyle={annotation.fontStyle}
            align={annotation.align}
            width={layout.width}
            height={layout.height}
            padding={layout.padding}
            lineHeight={1.25}
            wrap="none"
            verticalAlign="middle"
          />
          {noteNumber && (
            <Group x={layout.width + NOTE_BADGE_GAP} y={0} listening={false}>
              <Rect
                width={badgeWidth}
                height={NOTE_BADGE_HEIGHT}
                fill="#111827"
                stroke="#ffffff"
                strokeWidth={1}
                cornerRadius={5}
              />
              <Text
                text={`Note ${noteNumber}`}
                width={badgeWidth}
                height={NOTE_BADGE_HEIGHT}
                fill="#ffffff"
                fontSize={11}
                fontStyle="bold"
                align="center"
                verticalAlign="middle"
              />
            </Group>
          )}
        </Group>
      );
    }
    if (annotation.kind === 'step')
      return (
        <Group {...common}>
          <Ellipse
            radiusX={(annotation.width ?? 48) / 2}
            radiusY={(annotation.height ?? 48) / 2}
            fill={annotation.fill ?? '#6857f5'}
            stroke={annotation.stroke ?? '#ffffff'}
            strokeWidth={2}
            x={(annotation.width ?? 48) / 2}
            y={(annotation.height ?? 48) / 2}
          />
          <Text
            text={String(annotation.stepNumber ?? 1)}
            fill="#ffffff"
            fontSize={Math.min(annotation.width ?? 48, annotation.height ?? 48) * 0.46}
            fontStyle="bold"
            width={annotation.width ?? 48}
            height={annotation.height ?? 48}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );
    return (
      <Rect
        {...common}
        width={Math.abs(annotation.width ?? 20)}
        height={Math.abs(annotation.height ?? 20)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={
          annotation.kind === 'blur'
            ? '#0b0d12'
            : annotation.fill === 'transparent'
              ? undefined
              : annotation.fill
        }
        cornerRadius={annotation.kind === 'rounded-rectangle' ? 8 : 0}
        dash={annotation.kind === 'crop' ? [8, 6] : undefined}
      />
    );
  }

  const editedAnnotation = editing ? annotations.find((annotation) => annotation.id === editing.id) : null;
  const editedLayout = editedAnnotation
    ? textAnnotationLayout({ ...editedAnnotation, text: editing?.text ?? editedAnnotation.text }, measureText)
    : null;

  return (
    <div
      className="canvas-wrap annotation-canvas"
      style={{ cursor: spaceHeld || pan.current ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair' }}
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
          width={size.width}
          height={size.height}
          className="konva-stage"
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={cancelPointer}
          onPointerDblClick={(event) => {
            if (editing || tool !== 'select' || event.target !== event.target.getStage()) return;
            const point = imagePoint(event.evt);
            if (point) createTextAt(point);
          }}
          onWheel={(event) => {
            event.evt.preventDefault();
            if (event.evt.ctrlKey || event.evt.metaKey) {
              const pointer = event.target.getStage()?.getPointerPosition();
              if (!pointer) return;
              setViewport((current) => zoomAt(current, pointer, Math.exp(-event.evt.deltaY * 0.01)));
            } else
              setViewport((current) => ({
                ...current,
                x: current.x - event.evt.deltaX,
                y: current.y - event.evt.deltaY,
              }));
          }}
          onPointerClick={(event) => {
            if (event.target === event.target.getStage()) onSelect(null);
          }}
        >
          <Layer>
            <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
              <KonvaImage image={imageObj} width={image?.width} height={image?.height} listening={false} />
              {[...annotations].sort((left, right) => left.zIndex - right.zIndex).map(renderAnnotation)}
              {draft && renderAnnotation(draft)}
              <Transformer
                ref={transformerRef}
                rotateEnabled={
                  !['crop', 'pixelate'].includes(
                    annotations.find((annotation) => annotation.id === selectedId)?.kind ?? '',
                  )
                }
                keepRatioEnabled={false}
                borderStroke="#8e83ff"
                anchorStroke="#6857f5"
                anchorFill="#ffffff"
                anchorSize={10}
                onTransformEnd={() => {
                  const node = transformerRef.current?.nodes()[0];
                  if (!node || !selectedId) return;
                  const selected = annotations.find((annotation) => annotation.id === selectedId);
                  const width = Math.max(2, (selected?.width ?? node.width()) * node.scaleX());
                  const height = Math.max(2, (selected?.height ?? node.height()) * node.scaleY());
                  update(selectedId, {
                    x: node.x() - (selected?.kind === 'ellipse' ? width / 2 : 0),
                    y: node.y() - (selected?.kind === 'ellipse' ? height / 2 : 0),
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
      {editing && editedAnnotation && editedLayout && (
        <textarea
          ref={editorRef}
          aria-label="Edit annotation text"
          className="canvas-text-editor annotation-text-editor"
          placeholder="Type a note…"
          value={editing.text}
          style={{
            left: viewport.x + editedAnnotation.x * viewport.scale,
            top: viewport.y + editedAnnotation.y * viewport.scale,
            width: Math.max(160, editedLayout.width * viewport.scale),
            minHeight: Math.max(60, editedLayout.height * viewport.scale),
            fontSize: Math.max(12, editedLayout.fontSize * viewport.scale),
            color: liveTextColor(
              editedAnnotation.fill === 'transparent'
                ? editedAnnotation.stroke
                : (editedAnnotation.fill ?? editedAnnotation.stroke),
              theme,
            ),
            transform: `rotate(${editedAnnotation.rotation ?? 0}deg)`,
          }}
          onChange={(event) => setEditing({ ...editing, text: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              finishEditing(false);
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              finishEditing(true);
            }
          }}
          onBlur={() => finishEditing(true)}
        />
      )}
      <div className="canvas-hint">
        Drag empty space to pan · Double-click screenshot for text · Shift+Enter for a new line · 0 fit · 1
        actual size
      </div>
    </div>
  );
}
