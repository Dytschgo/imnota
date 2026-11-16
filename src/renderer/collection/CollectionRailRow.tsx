import { Eye, EyeOff, FileImage, FileText, Pencil, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { shallow } from 'zustand/shallow';
import type { OrderedCollectionItem } from '../../shared/content-items';
import { shortcutMatchesEvent, type ShortcutPlatform } from '../../shared/shortcuts';
import { IconButton } from '../components/ui';
import { textBlockLabel } from './text-block-label';

/** One name for a rail item's visible label, tooltip and action names. */
export function railItemLabel(item: OrderedCollectionItem): string {
  if (item.kind === 'text') return textBlockLabel(item.preview);
  return item.title || (item.kind === 'screenshot' ? item.originalFilename : 'Drawing');
}

export interface CollectionRailRowProps {
  item: OrderedCollectionItem;
  index: number;
  itemCount: number;
  active: boolean;
  thumbnail?: string;
  reorderHint?: string;
  reorderUp: string | null;
  reorderDown: string | null;
  shortcutPlatform: ShortcutPlatform;
  /** Formatted delete binding; shown only on the active row. */
  deleteShortcut?: string;
  onSelect(id: string): void;
  onToggleVisibility(item: OrderedCollectionItem): void;
  onDelete?(id: string, kind: OrderedCollectionItem['kind']): void;
  /** Moves the dragged item, or `sourceIndex` when given, to `targetIndex`. */
  onReorder(targetIndex: number, sourceIndex?: number): void;
  onDragIndex(index: number | null): void;
}

function CollectionRailRowView({
  item,
  index,
  itemCount,
  active,
  thumbnail,
  reorderHint,
  reorderUp,
  reorderDown,
  shortcutPlatform,
  deleteShortcut,
  onSelect,
  onToggleVisibility,
  onDelete,
  onReorder,
  onDragIndex,
}: CollectionRailRowProps) {
  const label = railItemLabel(item);
  return (
    <div
      draggable
      className={`shot-item ${active ? 'active' : ''} ${item.includeInExport ? '' : 'excluded'}`}
      onDragStart={() => onDragIndex(index)}
      onDragEnd={() => onDragIndex(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReorder(index);
      }}
    >
      <button
        className="shot-select"
        onClick={() => onSelect(item.id)}
        data-testid={`screenshot-${item.id}`}
        onKeyDown={(event) => {
          const matches = (binding: string | null) =>
            shortcutMatchesEvent(event.nativeEvent, binding, shortcutPlatform);
          const step = matches(reorderUp) ? -1 : matches(reorderDown) ? 1 : 0;
          if (!step) return;
          // Handled here so the same keys keep their global meaning everywhere else.
          event.preventDefault();
          const next = index + step;
          if (next >= 0 && next < itemCount) onReorder(next, index);
        }}
        title={[label, reorderHint].filter(Boolean).join('\n')}
      >
        <span className="shot-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="thumb">
          {thumbnail ? (
            <img src={thumbnail} alt="" />
          ) : item.kind === 'text' ? (
            <FileText size={18} aria-hidden="true" />
          ) : item.kind === 'drawing' ? (
            <Pencil size={18} aria-hidden="true" />
          ) : (
            <FileImage size={18} aria-hidden="true" />
          )}
        </div>
        <span className="shot-copy">
          <strong>{label}</strong>
          <small>
            {'conflict' in item && item.conflict
              ? item.includeInExport
                ? 'Copy conflict · included manually · '
                : 'Copy conflict · excluded · '
              : ''}
            {item.kind === 'screenshot'
              ? `${item.priority} priority`
              : item.kind === 'drawing'
                ? 'Drawing'
                : 'Markdown'}
          </small>
        </span>
      </button>
      <div className="shot-item-actions">
        <IconButton
          data-testid={`screenshot-export-toggle-${item.id}`}
          className="shot-visibility"
          label={item.includeInExport ? `Exclude ${label} from prompt` : `Include ${label} in prompt`}
          aria-pressed={item.includeInExport}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisibility(item);
          }}
        >
          {item.includeInExport ? (
            <Eye size={16} aria-hidden="true" />
          ) : (
            <EyeOff size={16} aria-hidden="true" />
          )}
        </IconButton>
        {onDelete && (
          <IconButton
            className="shot-delete"
            data-testid={`item-delete-${item.id}`}
            label={`Delete ${item.kind === 'text' ? 'text block' : item.kind}: ${label}`}
            {...(deleteShortcut && active ? { title: `Delete (${deleteShortcut})` } : {})}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(item.id, item.kind);
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/**
 * Rail items are rebuilt from the project on every edit, so compare the item by its fields: an
 * edit to one screenshot re-renders only that row instead of the whole collection.
 */
function sameRowProps(previous: CollectionRailRowProps, next: CollectionRailRowProps): boolean {
  const keys = Object.keys(next) as Array<keyof CollectionRailRowProps>;
  if (Object.keys(previous).length !== keys.length) return false;
  return keys.every((key) =>
    key === 'item' ? shallow(previous.item, next.item) : Object.is(previous[key], next[key]),
  );
}

export const CollectionRailRow = memo(CollectionRailRowView, sameRowProps);
