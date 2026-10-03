---
name: imnota
description: Read Imnota prompt bundles and collection items through the local MCP server.
---

# Imnota

Use this skill when the user refers to “the screenshot”, “the bundle”, “the prompt”, or “the Imnota collection”.

Call the Imnota MCP tools instead of guessing from chat images or asking the user to paste again.

1. Prefer `get_latest_bundle` for the prepared Markdown + PNG export of a collection.
2. Use `get_item` for a specific screenshot, drawing, or Markdown block.
3. Use `list_projects` and `list_collections` when the project or collection is unclear. `list_collections` includes prepared bundle ids; pass one to `get_bundle` to read a particular saved export. Use `list_collection_items` for its ordered items.
4. Use `search_saved_text` for saved titles, descriptions, and Markdown. It does not read pixels.

If `get_latest_bundle` returns `bundle not prepared`, tell the user to use **Copy Bundle** in Imnota first. Do not invent export contents.

Bundles are saved snapshots. Check omission notes before claiming to have read every image or prompt; oversized content is represented by its saved path, and PNGs are returned as MCP image blocks.

Stay inside the selected workspace. Do not ask for hosted-share tokens, pairing codes, recovery journals, or backup archives.
