import {
  Circle,
  Crop,
  Eraser,
  Highlighter,
  MousePointer2,
  MoveRight,
  Pencil,
  RectangleHorizontal,
  Square,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  MoreHorizontal,
} from 'lucide-react';
import type { AnnotationKind } from '../../shared/types';
import { IconButton } from './ui';

type ToolChoice = 'select' | AnnotationKind | 'eraser';
const tools: Array<{ id: ToolChoice; label: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select and move', icon: MousePointer2 },
  { id: 'arrow', label: 'Arrow', icon: MoveRight },
  { id: 'line', label: 'Line', icon: RectangleHorizontal },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'rounded-rectangle', label: 'Rounded rectangle', icon: RectangleHorizontal },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'highlight', label: 'Highlight area', icon: Highlighter },
  { id: 'pen', label: 'Freehand pen', icon: Pencil },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'callout', label: 'Text callout', icon: Type },
  { id: 'step', label: 'Numbered step', icon: MoreHorizontal },
  { id: 'blur', label: 'Mask sensitive area', icon: Crop },
  { id: 'pixelate', label: 'Pixelate area (use a mask for secrets)', icon: Highlighter },
  { id: 'crop', label: 'Crop exported image (original preserved)', icon: Crop },
  { id: 'eraser', label: 'Delete annotation', icon: Eraser },
];

export function Toolbar({
  tool,
  setTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoom,
  onFit,
}: {
  tool: 'select' | AnnotationKind | 'eraser';
  setTool: (tool: 'select' | AnnotationKind | 'eraser') => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoom: (delta: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="tool-group">
        {tools.map(({ id, label, icon: Icon }) => (
          <IconButton
            key={id}
            label={label}
            className={tool === id ? 'is-active' : ''}
            onClick={() => setTool(id)}
          >
            <Icon size={18} />
          </IconButton>
        ))}
      </div>
      <div className="toolbar-divider" />
      <div className="tool-group">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={17} />
        </IconButton>
        <span className="toolbar-divider" />
        <IconButton label="Zoom out" onClick={() => onZoom(-0.1)}>
          <ZoomOut size={17} />
        </IconButton>
        <IconButton label="Zoom in" onClick={() => onZoom(0.1)}>
          <ZoomIn size={17} />
        </IconButton>
        <IconButton label="Fit screenshot (0)" onClick={onFit}>
          <Maximize2 size={17} />
        </IconButton>
      </div>
    </div>
  );
}
