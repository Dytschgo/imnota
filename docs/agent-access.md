# Local agent access

Optional, off by default. When enabled, Claude Code or Cursor can read prepared prompt bundles from the selected workspace without a clipboard paste. Imnota does not upload, call a hosted model, or start capture over this interface.

## Turn it on

1. Open **Settings → Workspace**.
2. Enable **Allow local agent access**.
3. Copy the Claude Code or Cursor snippet from that page into the editor's MCP config.
4. Keep Imnota running, or spawn the Imnota executable with `--mcp` for stdio.

Until the toggle is on, Imnota starts no listener and a `--mcp` process exits immediately.

The HTTP listener binds only to `http://127.0.0.1:17384/mcp`. It is not a public server.

Enabling access first checks that the listener can bind. If the port is occupied, Settings reports the failure and leaves access off. A failed settings write closes a newly started listener. If a later app launch cannot bind, Imnota disables access and explains how to retry. Disabling access stops the listener and rejects further requests.

## What agents can read

| Tool                    | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `list_projects`         | Active projects (path, name, updated time)                       |
| `list_collection_items` | Ordered items (id, kind, title, includeInExport, priority)       |
| `get_latest_bundle`     | Latest timestamped export: Markdown text and PNG paths           |
| `get_item`              | One item's Markdown plus image path for screenshots and drawings |
| `search_saved_text`     | Existing saved-text search results                               |

`get_latest_bundle` only reads files already written by **Copy Bundle**. If none exist it returns `bundle not prepared` and does not generate an export.

Paths outside the selected workspace are rejected with the same validators as the desktop IPC bridge. Recovery journals, backup archives, and hosted-share pairing or management secrets are not exposed.

## Install a skill or rule

Imnota never writes `~/.claude` or `.cursor`. Copy these files yourself if you want the editor to prefer MCP over guessing from chat images:

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
