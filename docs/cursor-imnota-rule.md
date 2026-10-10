---
description: Use Imnota MCP for screenshot bundles and collection items.
alwaysApply: false
---

When the user refers to “the screenshot”, “the bundle”, “the prompt”, or “the Imnota collection”, call the Imnota MCP tools instead of guessing from chat images.

- `get_latest_bundle` for the latest prepared Markdown + PNG export
- `list_new_since` to check for exports newer than a time you already handled, then `get_bundle` to read one
- `get_item` for a specific screenshot, drawing, or Markdown block
- `list_projects` / `list_collections` to locate the collection and discover prepared bundle ids
- `list_collection_items` to inspect its ordered items
- `get_bundle` with a discovered id to read a particular saved export
- `search_saved_text` for saved text only (not pixels)

If the tool returns `bundle not prepared`, ask the user to run **Copy Bundle** in Imnota. Do not generate or invent an export. Do not read recovery journals, backups, or hosted-share secrets.

Bundles are saved snapshots. Check omission notes before claiming to have read every image or prompt; oversized content is represented by its saved path, and PNGs are returned as MCP image blocks.
