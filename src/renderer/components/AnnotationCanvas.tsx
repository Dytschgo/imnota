import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  normalizeAnnotationBounds,
  textAnnotationLayout,
} from '../../shared/annotation-geometry';
import type { Annotation, AnnotationKind, ImagePayload } from '../../shared/types';
import { createId } from '../../shared/utils';
import {
  committedTextAnnotationSize,
  createBrowserTextMeasurer,
  edgePanVelocity,
  liveTextColor,
  semanticAnnotationColor,
  sourceSizeFromEditorResize,
  textEditorPresentationSize,
  type AnnotationEditorResize,
  type CanvasTheme,
} from '../canvas/annotation-layout';
import {
  captureContentPointer,
  finalizeAnnotationDrag,
  releaseContentPointer,
  type ActiveAnnotationDrag,
} from '../canvas/pointer-interaction';
import { CANVAS_COMMAND_EVENT, canvasCommandFromEvent, viewportForCanvasCommand } from '../canvas/commands';
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
  const dragging = useRef<ActiveAnnotationDrag | null>(null);
  const edgePanFrame = useRef<number | null>(null);
  const edgePanTime = useRef<number | null>(null);
  const finalizePointerInteractionRef = useRef<(event?: Event) => void>(() => undefined);
  const explicitEditorResize = useRef<{ id: string; size: AnnotationEditorResize } | null>(null);
  const editorResizeListenerCleanup = useRef<(() => void) | null>(null);

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
  useEffect(
    () => () => {
      editorResizeListenerCleanup.current?.();
    },
    [],
  );

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
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
      pan.current = null;
    };
    const blur = (event: FocusEvent) => {
      setSpaceHeld(false);
      pan.current = null;
      setDraft(null);
      finalizePointerInteractionRef.current(event);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [onSelect]);

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
      if (wrapRef.current) {
        const next = { width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight };
        setSize((current) =>
          current.width === next.width && current.height === next.height ? current : next,
        );
      }
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

  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container || !imageObj || !image) return;
    const handleCommand = (event: Event) => {
      const command = canvasCommandFromEvent(event);
      if (!command) return;
      setViewport((current) => viewportForCanvasCommand(current, command, size, image));
    };
    container.addEventListener(CANVAS_COMMAND_EVENT, handleCommand);
    return () => container.removeEventListener(CANVAS_COMMAND_EVENT, handleCommand);
  }, [image, imageObj, size, stageRef]);

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
    const content = event.target.getStage()?.content;
    if (!content) return;
    try {
      capturedPointer.current = captureContentPointer(content, event.evt.pointerId)
        ? event.evt.pointerId
        : null;
    } catch {
      capturedPointer.current = null;
    }
  }

  function releasePointer() {
    const pointerId = capturedPointer.current;
    if (pointerId === null) return;
    capturedPointer.current = null;
    const content = stageRef.current?.content;
    if (!content) return;
    try {
      releaseContentPointer(content, pointerId);
    } catch {
      // Capture may already have been released by the browser after cancellation.
    }
  }

  function beginTextEditing(annotation: Annotation, isNew: boolean) {
    editorResizeListenerCleanup.current?.();
    explicitEditorResize.current = null;
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

  function finalizePointerInteraction(event?: Event) {
    const active = dragging.current;
    if (active) finalizeAnnotationDrag(active, (id, position) => update(id, position), event);
    dragging.current = null;
    pointerPosition.current = null;
    stopEdgePan();
    releasePointer();
  }

  function abortPointerInteraction(event?: Event) {
    finalizePointerInteraction(event);
    pan.current = null;
    setDraft(null);
  }

  finalizePointerInteractionRef.current = abortPointerInteraction;

  function finishEditing(commit: boolean) {
    if (!editing) return;
    editorResizeListenerCleanup.current?.();
    const annotation = annotations.find((item) => item.id === editing.id);
    if (!annotation) {
      explicitEditorResize.current = null;
      setEditing(null);
      onTool?.('select');
      return;
    }
    if (!commit) {
      if (editing.isNew) {
        onChange(annotations.filter((item) => item.id !== editing.id));
        onSelect(null);
      }
      explicitEditorResize.current = null;
      setEditing(null);
      onTool?.('select');
      return;
    }
    const nextText = editing.text;
    if (editing.isNew && !nextText.trim()) {
      onChange(annotations.filter((item) => item.id !== editing.id));
      onSelect(null);
    } else {
      const resized =
        explicitEditorResize.current?.id === annotation.id ? explicitEditorResize.current.size : undefined;
      const committedSize = committedTextAnnotationSize(annotation, nextText, measureText, resized);
      update(annotation.id, {
        text: nextText,
        width: committedSize.width,
        height: committedSize.height,
      });
      onMessage?.(editing.isNew ? 'Text note added' : 'Text note updated');
    }
    explicitEditorResize.current = null;
    setEditing(null);
    onTool?.('select');
  }

  function observeExplicitEditorResize(event: ReactPointerEvent<HTMLTextAreaElement>) {
    if (!editing) return;
    const editor = event.currentTarget;
    const activeEditingId = editing.id;
    const pointerId = event.pointerId;
    const initial = { width: editor.offsetWidth, height: editor.offsetHeight };
    const scale = viewportRef.current.scale;
    editorResizeListenerCleanup.current?.();
    const cleanup = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      editorResizeListenerCleanup.current = null;
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const size = sourceSizeFromEditorResize(
        initial,
        { width: editor.offsetWidth, height: editor.offsetHeight },
        scale,
      );
      if (size.width !== undefined || size.height !== undefined) {
        const previous =
          explicitEditorResize.current?.id === activeEditingId ? explicitEditorResize.current.size : {};
        explicitEditorResize.current = { id: activeEditingId, size: { ...previous, ...size } };
      }
      cleanup();
    };
    editorResizeListenerCleanup.current = cleanup;
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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
    const wasDragging = dragging.current !== null;
    finalizePointerInteraction(event.evt);
    if (wasDragging) return;
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
    const completed = normalizeAnnotationBounds(draft);
    onChange([...annotations, completed]);
    onSelect(completed.id);
    if (completed.kind === 'callout') beginTextEditing(completed, true);
    else onTool?.('select');
    setDraft(null);
  }

  function cancelPointer(event: Konva.KonvaEventObject<PointerEvent>) {
    abortPointerInteraction(event.evt);
  }

  function dragPointer(event: Konva.KonvaEventObject<DragEvent>) {
    const pointer = localPointer(event.evt);
    if (pointer) pointerPosition.current = pointer;
  }

  function startAnnotationDrag(annotation: Annotation, event: Konva.KonvaEventObject<DragEvent>) {
    dragging.current = {
      id: annotation.id,
      kind: annotation.kind,
      width: Math.abs(annotation.width ?? 0),
      height: Math.abs(annotation.height ?? 0),
      node: event.target,
      finalized: false,
    };
    dragPointer(event);
    startEdgePan();
  }

  function endAnnotationDrag(event: Konva.KonvaEventObject<DragEvent>) {
    finalizePointerInteraction(event.evt);
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
      onDragEnd: endAnnotationDrag,
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

  useEffect(() => {
    if (!imageObj) return;
    const content = stageRef.current?.content;
    if (!content) return;
    const lostPointerCapture = (event: PointerEvent) => {
      queueMicrotask(() => {
        if (capturedPointer.current === event.pointerId) finalizePointerInteractionRef.current(event);
      });
    };
    content.addEventListener('lostpointercapture', lostPointerCapture);
    return () => content.removeEventListener('lostpointercapture', lostPointerCapture);
  }, [imageObj, stageRef]);

  const editedAnnotation = editing ? annotations.find((annotation) => annotation.id === editing.id) : null;
  const editedLayout = editedAnnotation
    ? textAnnotationLayout({ ...editedAnnotation, text: editing?.text ?? editedAnnotation.text }, measureText)
    : null;
  const editorPresentation = editedLayout ? textEditorPresentationSize(editedLayout, viewport.scale) : null;

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
              {draft && renderAnnotation(normalizeAnnotationBounds(draft))}
              <Transformer
                ref={transformerRef}
                rotateEnabled={
                  !['crop', 'pixelate'].includes(
                    annotations.find((annotation) => annotation.id === selectedId)?.kind ?? '',
                  )
                }
                keepRatio={false}
                flipEnabled={false}
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
      {editing && editedAnnotation && editedLayout && editorPresentation && (
        <textarea
          ref={editorRef}
          aria-label="Edit annotation text"
          className="canvas-text-editor annotation-text-editor"
          placeholder="Type a note…"
          value={editing.text}
          style={{
            left: viewport.x + editedAnnotation.x * viewport.scale,
            top: viewport.y + editedAnnotation.y * viewport.scale,
            width: editorPresentation.width,
            minHeight: editorPresentation.height,
            fontSize: Math.max(12, editedLayout.fontSize * viewport.scale),
            color: liveTextColor(
              editedAnnotation.fill === 'transparent'
                ? editedAnnotation.stroke
                : (editedAnnotation.fill ?? editedAnnotation.stroke),
              theme,
            ),
            transform: `rotate(${editedAnnotation.rotation ?? 0}deg)`,
          }}
          onPointerDown={observeExplicitEditorResize}
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
