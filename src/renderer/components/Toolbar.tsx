import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  Circle,
  Crop,
  Eraser,
  Grid2X2,
  Highlighter,
  ListOrdered,
  Maximize2,
  MessageSquareText,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  Shield,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AnnotationKind } from '../../shared/types';
import { ANNOTATION_COLORS } from '../canvas/annotation-layout';
import { IconButton } from './ui';
import './annotation-tools.css';

export type ToolChoice = 'select' | AnnotationKind | 'eraser';

interface ToolDefinition {
  id: ToolChoice;
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;
}

const PRIMARY_TOOLS: ToolDefinition[] = [
  {
    id: 'select',
    label: 'Select / Move',
    description: 'Move annotations or drag empty canvas space to pan.',
    icon: MousePointer2,
  },
  {
    id: 'text',
    label: 'Text',
    description: 'Click once, or double-click in Select mode, to add editable text.',
    icon: Type,
  },
  {
    id: 'arrow',
    label: 'Arrow',
    description: 'Point to a specific interface detail.',
    icon: MoveRight,
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    description: 'Frame an area that needs attention.',
    icon: Square,
  },
  {
    id: 'highlight',
    label: 'Highlight',
    description: 'Add a translucent emphasis area.',
    icon: Highlighter,
  },
  {
    id: 'step',
    label: 'Note / Step',
    description: 'Place a numbered visual step marker.',
    icon: ListOrdered,
  },
];

const MORE_TOOLS: ToolDefinition[] = [
  {
    id: 'blur',
    label: 'Redaction mask',
    description: 'Cover sensitive content with an opaque mask.',
    icon: Shield,
  },
  {
    id: 'pixelate',
    label: 'Pixelation',
    description: 'Obscure an area visually; use Redaction mask for secrets.',
    icon: Grid2X2,
  },
  {
    id: 'crop',
    label: 'Crop',
    description: 'Drag or resize a crop box, then Apply or Cancel. The original is preserved.',
    icon: Crop,
  },
  { id: 'pen', label: 'Freehand', description: 'Draw a freehand mark.', icon: Pencil },
  { id: 'line', label: 'Line', description: 'Draw a straight line.', icon: Minus },
  { id: 'ellipse', label: 'Ellipse', description: 'Circle an area.', icon: Circle },
  {
    id: 'callout',
    label: 'Callout',
    description: 'Add text inside a filled visual callout.',
    icon: MessageSquareText,
  },
  {
    id: 'rounded-rectangle',
    label: 'Rounded rectangle',
    description: 'Frame an area with softened corners.',
    icon: Square,
  },
  {
    id: 'eraser',
    label: 'Delete annotation',
    description: 'Click an annotation to remove it.',
    icon: Eraser,
  },
];

function ToolButton({
  definition,
  active,
  onClick,
}: {
  definition: ToolDefinition;
  active: boolean;
  onClick: () => void;
}) {
  const tooltipId = `${useId().replace(/:/g, '')}-tooltip`;
  const Icon = definition.icon;
  return (
    <span className="annotation-tooltip-anchor">
      <IconButton
        data-testid={`tool-${definition.id}`}
        label={`${definition.label}${definition.shortcut ? ` (${definition.shortcut})` : ''}`}
        aria-describedby={tooltipId}
        className={active ? 'is-active' : ''}
        aria-pressed={active}
        onClick={onClick}
      >
        <Icon size={18} />
      </IconButton>
      <span className="annotation-tooltip" id={tooltipId} role="tooltip">
        <strong>{definition.label}</strong>
        <span>{definition.description}</span>
        {definition.shortcut && <kbd>{definition.shortcut}</kbd>}
      </span>
    </span>
  );
}

export interface ToolbarProps {
  tool: ToolChoice;
  setTool: (tool: ToolChoice) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onActualSize?: () => void;
  /** Enables the compact quick palette when supplied. */
  onColorSelect?: (color: string) => void;
  selectedColor?: string;
  shortcutLabels?: Partial<Record<ToolChoice | 'undo' | 'redo' | 'fit' | 'actualSize', string>>;
}

export function Toolbar({
  tool,
  setTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoom,
  onFit,
  onActualSize,
  onColorSelect,
  selectedColor,
  shortcutLabels = {},
}: ToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE_TOOLS.some((definition) => definition.id === tool);

  useEffect(() => {
    if (!moreOpen) return;
    const pointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('keydown', keydown);
    };
  }, [moreOpen]);

  return (
    <div className="toolbar annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="tool-group annotation-primary-tools">
        {PRIMARY_TOOLS.map((definition) => (
          <ToolButton
            key={definition.id}
            definition={{ ...definition, shortcut: shortcutLabels[definition.id] }}
            active={tool === definition.id}
            onClick={() => setTool(definition.id)}
          />
        ))}
        <div className="annotation-more" ref={moreRef}>
          <span className="annotation-tooltip-anchor">
            <IconButton
              data-testid="more-annotation-tools"
              label="More annotation tools"
              className={moreActive ? 'is-active' : ''}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className="annotation-more-icon">
                <span>More</span>
                <ChevronDown size={13} />
              </span>
            </IconButton>
            {!moreOpen && (
              <span className="annotation-tooltip" role="tooltip">
                <strong>More tools</strong>
                <span>Redaction, pixelation, crop, drawing, and additional shapes.</span>
              </span>
            )}
          </span>
          {moreOpen && (
            <div className="annotation-more-menu" role="menu" aria-label="More annotation tools">
              {MORE_TOOLS.map((definition) => {
                const Icon = definition.icon;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tool === definition.id}
                    className={tool === definition.id ? 'is-active' : ''}
                    onClick={() => {
                      setTool(definition.id);
                      setMoreOpen(false);
                    }}
                  >
                    <Icon size={16} />
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {onColorSelect && (
        <>
          <div className="toolbar-divider" />
          <div className="annotation-palette" role="group" aria-label="Quick annotation colors">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={selectedColor?.toLowerCase() === color ? 'is-active' : ''}
                aria-label={`Use color ${color}`}
                aria-pressed={selectedColor?.toLowerCase() === color}
                style={{ '--swatch': color } as CSSProperties}
                onClick={() => onColorSelect(color)}
              />
            ))}
          </div>
        </>
      )}

      <div className="toolbar-divider" />
      <div className="tool-group annotation-view-tools">
        <IconButton
          label={`Undo${shortcutLabels.undo ? ` (${shortcutLabels.undo})` : ''}`}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={17} />
        </IconButton>
        <IconButton
          label={`Redo${shortcutLabels.redo ? ` (${shortcutLabels.redo})` : ''}`}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={17} />
        </IconButton>
        <span className="toolbar-divider" />
        <IconButton label="Zoom out" onClick={() => onZoom(-0.1)}>
          <ZoomOut size={17} />
        </IconButton>
        <IconButton label="Zoom in" onClick={() => onZoom(0.1)}>
          <ZoomIn size={17} />
        </IconButton>
        <IconButton
          label={`Fit screenshot${shortcutLabels.fit ? ` (${shortcutLabels.fit})` : ''}`}
          onClick={onFit}
        >
          <Maximize2 size={17} />
        </IconButton>
        <IconButton
          label={`Actual size${shortcutLabels.actualSize ? ` (${shortcutLabels.actualSize})` : ''}`}
          onClick={onActualSize ?? (() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })))}
        >
          <span className="actual-size-label">1:1</span>
        </IconButton>
      </div>
    </div>
  );
}
