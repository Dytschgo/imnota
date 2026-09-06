# Collections and simple screenshot context

This filename is retained for existing inbound links. The user-facing term is now **Collection**, not Subfolder or feedback round.

The primary workflow uses:

- Empty new collections with stable internal IDs, editable names and archive/restore actions.
- One optional Overall context per collection.
- One optional Description per screenshot.
- Low, Medium or High agent priority.
- Direct eye/crossed-eye prompt visibility.
- Current-collection-only Markdown + PNG prompt bundles.

Legacy descriptions and populated structured notes are merged into the single Description during schema migration. Legacy project instructions, desired outcomes and technical constraints are merged into Overall context. Existing files and a versioned metadata backup are retained until the migration commits successfully.

Priority appears in Markdown but never sorts screenshots. Export-time Picture numbers follow the user's current order and remain stable across automatically split bundles. An excluded screenshot remains editable, is omitted from PNGs and appears as a textual exclusion in Markdown.

Deleting is a separate action: the screenshot image, annotations and description move to the operating-system trash, and Imnota offers immediate Undo where restoration is supported.

See the [user guide](user-guide.md) and [data format](data-format.md) for the current behavior.
