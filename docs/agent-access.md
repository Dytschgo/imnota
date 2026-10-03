# Local agent access

Optional, off by default. When enabled, any MCP-capable coding agent can read prepared prompt bundles from the selected workspace without a clipboard paste. Imnota does not upload, call a hosted model, or start capture over this interface.

## Turn it on

1. Open **Settings → Features**.
2. Enable **Allow local agent access**.
3. Choose **Copy prompt** and paste the setup prompt into your agent. The prompt names the server, both transports, and the tool list, and instructs the agent to write its own MCP configuration and report which file it changed. A **Configuration reference** disclosure holds generic `mcpServers` entries for HTTP and stdio if you prefer to edit the file yourself.
4. Keep Imnota running, or spawn the Imnota executable with `--mcp` for stdio.

Until the toggle is on, Imnota starts no listener and a `--mcp` process exits immediately.

The HTTP listener binds only to `http://127.0.0.1:17384/mcp`. It is not a public server. The existing interface has no authentication token: enabling it allows local processes to read the selected workspace. Requests with a foreign Host or a browser Origin are rejected; no CORS permission is granted. Hosted-share tokens do not authorize MCP access.

Enabling access first checks that the listener can bind. If the port is occupied, Settings reports the failure and leaves access off. A failed settings write closes a newly started listener. If a later app launch cannot bind, Imnota disables access and explains how to retry. Disabling access stops the listener and rejects further requests.

## What agents can read

| Tool                    | Arguments                              | Result                                                                           |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `list_projects`         | None                                   | Active projects (path, name, updated time)                                       |
| `list_collections`      | `projectPath`                          | Collections, including archived ones, and up to ten recent saved bundle ids each |
| `list_collection_items` | `projectPath`, `collectionId`          | Ordered items (id, kind, title, includeInExport, priority)                       |
| `get_latest_bundle`     | Optional `projectPath`, `collectionId` | Latest readable saved export: Markdown text and PNG image blocks                 |
| `get_bundle`            | `id`                                   | One saved export identified by a discovered bundle id                            |
| `get_item`              | `projectPath`, `itemId`                | One item's Markdown plus image path for screenshots and drawings                 |
| `search_saved_text`     | `query`, optional search filters       | Existing saved-text search results                                               |

`get_latest_bundle` without arguments searches active projects and active collections. Supplying only `projectPath` narrows it to that project's active collections; supplying both `projectPath` and `collectionId` selects that collection, including an archived one. `collectionId` alone is invalid. Timestamp ties use a stable project-path, collection-id and folder-name order.

Bundle tools only read published export folders already written by **Copy Bundle**. A folder needs a valid local timestamp and a canonical Markdown file; empty folders, staging folders, malformed names, links and implausibly future-dated sets are ignored. Unreadable sets are skipped when finding the latest readable export. If none exist, `get_latest_bundle` returns `bundle not prepared` and does not generate an export. This is a saved snapshot, not a claim that the current edits are exported. `preparedAt` is the export filename's local wall-clock time, without a timezone.

Use the opaque `id` returned by `list_collections` or `get_latest_bundle` for `get_bundle`. IDs remain stable while the workspace-relative project folder, collection id and export folder name stay the same. Moving or removing a set, changing the selected workspace, or making it inaccessible can return `bundle not found`. An id is never treated as a filesystem path.

The first MCP content block is JSON text with bundle metadata and ordered `bundles` entries. PNG image blocks follow in that same order for entries whose `image` is `included`. Each entry carries its saved `markdownPath`, optional `pngPath`, Markdown text and image status. Text-only exports are supported. PNG signature, chunk integrity and dimension checks reject invalid images.

Per call, bundle reads return at most **10 PNGs**, **5,000,000 raw bytes per PNG**, **20,000,000 raw image bytes in total**, and **4,000,000 raw Markdown bytes**. Oversized content is omitted with its saved path, status, counts and explanatory `notes`; invalid images are also reported. JSON text responses are capped at **5,000,000 UTF-8 bytes**. A response exceeding that cap returns a tool error instead of a partial JSON document. Requests are capped at **1,000,000 bytes** (stdio checks each received line). Directory scans stop at **5,000 entries** per directory; narrow large workspace requests to a project. These limits do not write or regenerate files.

Paths outside the selected workspace are rejected with the same validators as the desktop IPC bridge. Linked project or export paths are rejected, and reads recheck file identity and size. Recovery journals, backup archives, and hosted-share pairing or management secrets are not exposed. MCP performs no migrations, recovery, capture, export generation or file writes. Access remains controlled by the explicit local opt-in; disabling it rejects later HTTP and stdio reads.

## Install a skill or rule

Imnota never writes agent or editor configuration. The setup prompt already tells the agent to prefer these tools over guessing from chat images; copy one of these files yourself if your agent supports installable skills or rules:

- [Claude Code skill](claude-code-imnota-skill.md)
- [Cursor rule](cursor-imnota-rule.md)

Stdio config, if you spawn Imnota instead of using the loopback URL:

```json
{
  "mcpServers": {
    "imnota": {
      "command": "<path-to-Imnota-executable>",
      "args": ["--mcp"]
    }
  }
}
```
