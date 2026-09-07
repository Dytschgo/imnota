# Mixed-content model

Imnota collections can contain three ordered content types:

1. screenshots;
2. Markdown text blocks;
3. drawings.

The collection order is the order used by the rail, Markdown export and visual export.

## Current storage model

Schema 4 keeps screenshot records in the existing `screenshots` array for compatibility. Text and drawing records live in `contentItems`:

```ts
type ContentItemKind = 'drawing' | 'text';

interface ContentItemBase {
  id: string;
  collectionId: string;
  kind: ContentItemKind;
  position: number;
  includeInExport: boolean;
  createdAt: string;
  updatedAt: string;
}
```

The application creates an ordered view by combining screenshot records with `contentItems` and sorting by `position`, then by creation time and ID as deterministic tie-breakers. Screenshot IDs and filenames remain stable during migration.

This is a compatibility model, not three separate collection systems. The ordered view is the only order the UI and exporters should use.

## Item-specific data

Screenshots retain their existing source image, annotation JSON, description Markdown, title, priority and export visibility.

Text blocks contain Markdown only. The Markdown file is authoritative; `preview` is only a convenience value for list rendering and must never replace the source.

Drawings contain an editable JSON source and a rendered PNG cache. The JSON is authoritative for editing. The PNG is used for prompt and package export and must be regenerated when the source changes.

All content files are stored below the owning collection. Native persistence validates collection ownership, filenames, file sizes and content revisions. Renderer code does not write directly to the project work tree.

## Behaviour contract

All three item types support:

- stable identity;
- deterministic ordering;
- include/exclude visibility;
- duplicate;
- recoverable delete and Undo;
- autosave and stale-revision protection;
- close/reopen persistence;
- Markdown export in collection order.

Text blocks emit Markdown without an image asset. Screenshots and drawings emit visual assets when included. Excluded items remain represented textually where the export contract requires it, so omission is intentional rather than ambiguous.

## Compatibility rules

- Schema 3 projects open unchanged and migrate without changing screenshot IDs, filenames or order.
- Unknown future schema versions are rejected rather than silently rewritten.
- A failed migration must leave the original project recoverable.
- Drawing and text files must not be silently converted into screenshot fields.
- Export numbering is derived from the current ordered view, never stored as identity.

## Definition of done

The mixed-content model is finished when the following scenario passes in automated and native smoke coverage:

```text
Create project -> add text -> add drawing -> import screenshot -> reorder
-> edit all three -> hide one -> close/reopen -> export -> duplicate -> delete/Undo
```

The final export must contain the expected Markdown order, included visual assets, exclusion statements and editable drawing source files, with no orphaned or missing content files.
