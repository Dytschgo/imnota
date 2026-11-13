---
description: Use Imnota MCP for screenshot bundles and collection items.
alwaysApply: false
---

When the user refers to “the screenshot”, “the bundle”, “the prompt”, or “the Imnota collection”, call the Imnota MCP tools instead of guessing from chat images.

- `get_latest_bundle` for the latest prepared Markdown + PNG export
- `list_new_since` to check for newer exports, then `get_bundle` to read one. While `more` is true, repeat the same query with `nextCursor` as `cursor` before advancing `since`; restart and deduplicate ids if the cursor becomes unavailable. Overlap polling timestamps and deduplicate ids across concurrent writes or clock changes.
- `get_item` for a specific screenshot, drawing, or Markdown block
- `list_projects` / `list_collections` to locate the collection and discover prepared bundle ids
- `list_collection_items` to inspect its ordered items
- `get_bundle` with a discovered id to read a particular saved export
- `inspect_bundle` with a discovered id to check file sizes and read limits before fetching content; inspection does not verify content or freshness
- `search_saved_text` for saved text only (not pixels)

If the tool returns `bundle not prepared`, ask the user to run **Copy Bundle** in Imnota. Do not generate or invent an export. Do not read recovery journals, backups, or hosted-share secrets.

Bundles are saved snapshots. Check omission notes before claiming to have read every image or prompt; oversized content is represented by its saved path, and PNGs are returned as MCP image blocks.
