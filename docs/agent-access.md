# Local agent access

Optional, off by default. When enabled, Claude Code or Cursor can read prepared prompt bundles from the selected workspace without a clipboard paste. Imnota does not upload, call a hosted model, or start capture over this interface.

## Turn it on

1. Open **Settings → Workspace**.
2. Enable **Allow local agent access**.
3. Copy the Claude Code or Cursor snippet from that page into the editor's MCP config.
4. Keep Imnota running, or spawn the Imnota executable with `--mcp` for stdio.

**Tell agents to use the Imnota skill** (on by default) inserts a short **How to use this brief** section into every prompt bundle. That instruction is for any coding agent — Claude Code, Cursor, Codex, Grok, and others — not only MCP clients. It does not write editor config. Install the skill from [dytschgo-skills](https://github.com/Dytschgo/dytschgo-skills):

```bash
npx skills add https://github.com/Dytschgo/dytschgo-skills --skill imnota
```

Until **Allow local agent access** is on, Imnota starts no listener and a `--mcp` process exits immediately.

The HTTP listener binds only to `http://127.0.0.1:17384/mcp`. It is not a public server.

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

Imnota never writes `~/.claude` or `.cursor`. Prefer the downloadable **Imnota** skill in [dytschgo-skills](https://github.com/Dytschgo/dytschgo-skills) so any compatible agent can load it. The in-repo [Claude Code skill](claude-code-imnota-skill.md) and [Cursor rule](cursor-imnota-rule.md) remain copies for editors that still want a local file.

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
