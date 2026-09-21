---
description: Use Imnota MCP for screenshot bundles and collection items.
alwaysApply: false
---

When the user refers to “the screenshot”, “the bundle”, “the prompt”, or “the Imnota collection”, call the Imnota MCP tools instead of guessing from chat images.

- `get_latest_bundle` for the latest prepared Markdown + PNG export
- `get_item` for a specific screenshot, drawing, or Markdown block
- `list_projects` / `list_collection_items` to locate the collection
- `search_saved_text` for saved text only (not pixels)

If the tool returns `bundle not prepared`, ask the user to run **Copy Bundle** in Imnota. Do not generate or invent an export. Do not read recovery journals, backups, or hosted-share secrets.
