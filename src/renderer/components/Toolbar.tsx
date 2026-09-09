import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

const TRANSFORM_TOOLS = MORE_TOOLS.filter((tool) => ['blur', 'pixelate', 'crop'].includes(tool.id));
const DRAWING_TOOLS = MORE_TOOLS.filter((tool) => !['blur', 'pixelate', 'crop', 'eraser'].includes(tool.id));
const DANGER_TOOLS = MORE_TOOLS.filter((tool) => tool.id === 'eraser');

function ToolTooltip({
  children,
  id,
  content,
  disabled = false,
}: {
  children: ReactNode;
  id?: string;
  content: ReactNode;
  disabled?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pointerFocus = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const hide = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };
  const show = () => {
    clearTimeout(timer.current);
    if (disabled) return;
    timer.current = setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - 105, window.innerWidth - 218)),
        top: Math.max(8, Math.min(rect.bottom + 9, window.innerHeight - 110)),
      });
    }, 320);
  };
  useEffect(() => {
    const dismiss = () => {
      clearTimeout(timer.current);
      setPosition(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <span
      ref={anchor}
      className="annotation-tooltip-anchor"
      onPointerEnter={show}
      onPointerLeave={() => {
        pointerFocus.current = false;
        hide();
      }}
      onPointerCancel={() => {
        pointerFocus.current = false;
        hide();
      }}
      onPointerDown={() => {
        pointerFocus.current = true;
        hide();
      }}
      onPointerUp={() => {
        pointerFocus.current = false;
      }}
      onFocus={(event) => {
        if (
          !pointerFocus.current &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !(event.relatedTarget instanceof Element && event.relatedTarget.closest('[role=menu]')) &&
          event.target.matches(':focus-visible')
        )
          show();
      }}
      onBlur={hide}
      onClick={hide}
    >
      {children}
      {position &&
        !disabled &&
        createPortal(
          <span className="annotation-tooltip" id={id} role="tooltip" style={position}>
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

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
    <ToolTooltip
      id={tooltipId}
      content={
        <>
          <strong>{definition.label}</strong>
          <span>{definition.description}</span>
          {definition.shortcut && <kbd>{definition.shortcut}</kbd>}
        </>
      }
    >
      <IconButton
        data-testid={`tool-${definition.id}`}
        label={`${definition.label}${definition.shortcut ? ` (${definition.shortcut})` : ''}`}
        title={undefined}
        aria-describedby={tooltipId}
        className={active ? 'is-active' : ''}
        aria-pressed={active}
        onClick={onClick}
      >
        <Icon size={18} />
      </IconButton>
    </ToolTooltip>
  );
}

function MoreToolSection({
  label,
  tools,
  activeTool,
  onSelect,
  focusedIndex,
  onFocusedIndexChange,
  onClose,
  onItemRef,
}: {
  label: string;
  tools: ToolDefinition[];
  activeTool: ToolChoice;
  onSelect(tool: ToolChoice): void;
  focusedIndex: number;
  onFocusedIndexChange(index: number): void;
  onClose(): void;
  onItemRef(index: number, element: HTMLButtonElement | null): void;
}) {
  return (
    <div className={label === 'Remove' ? 'annotation-menu-section is-danger' : 'annotation-menu-section'}>
      <span className="annotation-menu-label">{label}</span>
      {tools.map((definition) => {
        const Icon = definition.icon;
        const index = MORE_TOOLS.indexOf(definition);
        return (
          <button
            key={definition.id}
            ref={(element) => onItemRef(index, element)}
            type="button"
            role="menuitemradio"
            aria-checked={activeTool === definition.id}
            className={activeTool === definition.id ? 'is-active' : ''}
            tabIndex={index === focusedIndex ? 0 : -1}
            onClick={() => onSelect(definition.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                onFocusedIndexChange((index + 1) % MORE_TOOLS.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                onFocusedIndexChange((index - 1 + MORE_TOOLS.length) % MORE_TOOLS.length);
              } else if (event.key === 'Home') {
                event.preventDefault();
                onFocusedIndexChange(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                onFocusedIndexChange(MORE_TOOLS.length - 1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
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
  const [moreFocusedIndex, setMoreFocusedIndex] = useState(0);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTabCloseFrame = useRef<number | undefined>(undefined);
  const moreMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const moreMenuId = useId().replace(/:/g, '');
  const moreActive = MORE_TOOLS.some((definition) => definition.id === tool);

  const closeMoreMenu = (restoreFocus = false) => {
    if (moreTabCloseFrame.current !== undefined) {
      window.cancelAnimationFrame(moreTabCloseFrame.current);
      moreTabCloseFrame.current = undefined;
    }
    setMoreOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => moreTriggerRef.current?.focus());
  };

  const openMoreMenu = (focusedIndex = 0) => {
    setMoreFocusedIndex(Math.min(Math.max(focusedIndex, 0), MORE_TOOLS.length - 1));
    setMoreOpen(true);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const pointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) closeMoreMenu();
    };
    document.addEventListener('pointerdown', pointerDown);
    const frame = window.requestAnimationFrame(() => moreMenuItemRefs.current[moreFocusedIndex]?.focus());
    return () => {
      document.removeEventListener('pointerdown', pointerDown);
      window.cancelAnimationFrame(frame);
    };
  }, [moreFocusedIndex, moreOpen]);

  return (
    <div className="toolbar annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="tool-group annotation-primary-tools" role="group" aria-label="Annotate">
        {PRIMARY_TOOLS.map((definition) => (
          <ToolButton
            key={definition.id}
            definition={{ ...definition, shortcut: shortcutLabels[definition.id] }}
            active={tool === definition.id}
            onClick={() => setTool(definition.id)}
          />
        ))}
        <div
          className="annotation-more"
          ref={moreRef}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && moreOpen && event.target !== moreTriggerRef.current) {
              // Let the browser move focus first, including Shift+Tab back to the trigger.
              moreTabCloseFrame.current = window.requestAnimationFrame(() => closeMoreMenu());
            }
          }}
          onBlur={(event) => {
            if (!moreRef.current?.contains(event.relatedTarget as Node | null)) closeMoreMenu();
          }}
        >
          <ToolTooltip
            disabled={moreOpen}
            content={
              <>
                <strong>More tools</strong>
                <span>Redaction, pixelation, crop, drawing, and additional shapes.</span>
              </>
            }
          >
            <IconButton
              ref={moreTriggerRef}
              data-testid="more-annotation-tools"
              label="More annotation tools"
              title={undefined}
              className={moreActive ? 'is-active' : ''}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls={moreMenuId}
              onClick={() => (moreOpen ? closeMoreMenu() : openMoreMenu())}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Home') {
                  event.preventDefault();
                  openMoreMenu(0);
                } else if (event.key === 'ArrowUp' || event.key === 'End') {
                  event.preventDefault();
                  openMoreMenu(MORE_TOOLS.length - 1);
                } else if (event.key === 'Escape' && moreOpen) {
                  event.preventDefault();
                  closeMoreMenu(true);
                }
              }}
            >
              <span className="annotation-more-icon">
                <span>More</span>
                <ChevronDown size={13} />
              </span>
            </IconButton>
          </ToolTooltip>
          {moreOpen && (
            <div
              className="annotation-more-menu"
              id={moreMenuId}
              role="menu"
              aria-label="More annotation tools"
            >
              <MoreToolSection
                label="Transform"
                tools={TRANSFORM_TOOLS}
                activeTool={tool}
                onSelect={(next) => {
                  setTool(next);
                  closeMoreMenu(true);
                }}
                focusedIndex={moreFocusedIndex}
                onFocusedIndexChange={setMoreFocusedIndex}
                onClose={() => closeMoreMenu(true)}
                onItemRef={(index, element) => {
                  moreMenuItemRefs.current[index] = element;
                }}
              />
              <MoreToolSection
                label="Draw"
                tools={DRAWING_TOOLS}
                activeTool={tool}
                onSelect={(next) => {
                  setTool(next);
                  closeMoreMenu(true);
                }}
                focusedIndex={moreFocusedIndex}
                onFocusedIndexChange={setMoreFocusedIndex}
                onClose={() => closeMoreMenu(true)}
                onItemRef={(index, element) => {
                  moreMenuItemRefs.current[index] = element;
                }}
              />
              <MoreToolSection
                label="Remove"
                tools={DANGER_TOOLS}
                activeTool={tool}
                onSelect={(next) => {
                  setTool(next);
                  closeMoreMenu(true);
                }}
                focusedIndex={moreFocusedIndex}
                onFocusedIndexChange={setMoreFocusedIndex}
                onClose={() => closeMoreMenu(true)}
                onItemRef={(index, element) => {
                  moreMenuItemRefs.current[index] = element;
                }}
              />
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
      <div className="tool-group annotation-view-tools" aria-label="View">
        <span className="toolbar-group-label">View</span>
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
