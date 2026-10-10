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

| Tool                    | Arguments                                | Result                                                                           |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `list_projects`         | None                                     | Active projects (path, name, updated time)                                       |
| `list_collections`      | `projectPath`                            | Collections, including archived ones, and up to ten recent saved bundle ids each |
| `list_collection_items` | `projectPath`, `collectionId`            | Ordered items (id, kind, title, includeInExport, priority)                       |
| `get_latest_bundle`     | Optional `projectPath`, `collectionId`   | Latest readable saved export: Markdown text and PNG image blocks                 |
| `list_new_since`        | Optional `since`, `projectPath`, `limit` | Saved exports newer than `since`, newest first: ids, paths and times only        |
| `get_bundle`            | `id`                                     | One saved export identified by a discovered bundle id                            |
| `get_item`              | `projectPath`, `itemId`                  | One item's Markdown plus image path for screenshots and drawings                 |
| `search_saved_text`     | `query`, optional search filters         | Existing saved-text search results                                               |

`get_latest_bundle` without arguments searches active projects and active collections. Supplying only `projectPath` narrows it to that project's active collections; supplying both `projectPath` and `collectionId` selects that collection, including an archived one. `collectionId` alone is invalid. Timestamp ties use a stable project-path, collection-id and folder-name order.

Bundle tools read folders matching the export layout used by **Copy Bundle**; they do not establish who wrote them. A folder needs a valid local timestamp and a canonical Markdown file; empty folders, staging folders, malformed names, links and implausibly future-dated sets are ignored. Unreadable sets are skipped when finding the latest readable export. If none exist, `get_latest_bundle` returns `bundle not prepared` and does not generate an export. This is a saved snapshot, not a claim that the current edits are exported. `preparedAt` is the export filename's local wall-clock time, without a timezone.

"Latest" is derived from export folder names, not an independent publication record. Anyone able to write into the workspace can influence which bundle is reported as latest; they could equally edit the bundle contents. Copy Bundle removes its temporary ownership record when publishing and leaves no reliable ordering record. Names more than **five minutes** ahead of the current clock are ignored. This small allowance covers clock corrections and ordinary one-second timestamp reservations, without accepting tomorrow's fabricated export. Parsing uses the machine's current local timezone, matching Copy Bundle's local-time name generation, rather than treating the name as UTC. After a timezone change, a clock correction larger than five minutes, or an unusually long run of occupied timestamp reservations, a genuine set may be temporarily omitted. Timezone/DST ambiguity cannot be recovered from these names.

`list_new_since` is the inbox check: pass the `preparedAt` of the last bundle you handled as `since` (local time, `YYYY-MM-DDTHH:MM:SS`) and it lists newer exports from active projects and collections, newest first. Without `since` it lists the most recent ones. `limit` defaults to 10 (maximum 50) and `more` says whether more matched. It returns no Markdown or images; read one with `get_bundle`. The same folder rules, workspace path checks and access switch apply as for `get_latest_bundle`, and it writes nothing.

Use the opaque `id` returned by `list_collections` or `get_latest_bundle` for `get_bundle`. IDs remain stable while the workspace-relative project folder, collection id and export folder name stay the same. Moving or removing a set, changing the selected workspace, or making it inaccessible can return `bundle not found`. An id is never treated as a filesystem path.

The first MCP content block is JSON text with bundle metadata and ordered `bundles` entries. PNG image blocks follow in that same order for entries whose `image` is `included`. Each entry carries its saved `markdownPath`, optional `pngPath`, Markdown text and image status. Text-only exports are supported. PNG signature, chunk integrity and dimension checks reject invalid images.

Per call, bundle reads return at most **10 PNGs**, **5,000,000 raw bytes per PNG**, **20,000,000 raw image bytes in total**, and **4,000,000 raw Markdown bytes**. Oversized content is omitted with its saved path, status, counts and explanatory `notes`; invalid images are also reported. JSON text responses are capped at **5,000,000 UTF-8 bytes**. A response exceeding that cap returns a tool error instead of a partial JSON document. Requests are capped at **1,000,000 bytes** (stdio checks each received line). Directory scans stop at **5,000 entries** per directory; narrow large workspace requests to a project. These limits do not write or regenerate files.

Paths outside the selected workspace are rejected with the same validators as the desktop IPC bridge. Linked project or export paths are rejected, and reads recheck file identity and size. Recovery journals, backup archives, and hosted-share pairing or management secrets are not exposed. MCP performs no migrations, recovery, capture, export generation or file writes. Access remains controlled by the explicit local opt-in. HTTP uses the running UI's settings. Before each stdio tool call, the existing session reads `settings.json` once and validates it using the shared settings schemas: access off refuses the call, and a changed workspace takes effect for that call. Missing, unreadable or malformed settings fail closed rather than retaining enabled access. Invalid workspace values cannot authorize a root. This does not cancel a read already in progress; initialization and tool discovery do not read workspace content.

## Install a skill or rule

Imnota never writes agent or editor configuration. The setup prompt already tells the agent to prefer these tools over guessing from chat images; copy one of these files yourself if your agent supports installable skills or rules:

- [Claude Code skill](claude-code-imnota-skill.md)
- [Cursor rule](cursor-imnota-rule.md)

Stdio config for macOS and Linux, if you spawn Imnota instead of using the loopback URL:

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

## Windows stdio launch contract

Bare `Imnota.exe --mcp` is not a strict MCP stdio command. Electron 44.2.0 [writes a startup newline before application JavaScript](https://github.com/electron/electron/blob/v44.2.0/shell/app/electron_main_delegate.cc#L185-L191) and [replaces Windows `process.stdin` with an EOF-only stream](https://github.com/electron/electron/blob/v44.2.0/lib/common/init.ts#L56-L67). Two packaged diagnostics observed the literal stdout bytes `0d0a` with access off; `ELECTRON_NO_ATTACH_CONSOLE=1` did not remove them.

Use **Node.js 24 or later** and the relay shipped with the installed Windows application. After running the installer, locate `resources/imnota-mcp.mjs` beside the installation's `Imnota.exe`. The usual per-user location is `%LOCALAPPDATA%/Programs/imnota/resources/imnota-mcp.mjs`; resolve the full path in your client configuration. For example:

```json
{
  "mcpServers": {
    "imnota": {
      "command": "node",
      "args": ["C:/Users/YOUR_NAME/AppData/Local/Programs/imnota/resources/imnota-mcp.mjs"]
    }
  }
}
```

Use an absolute path to `node.exe` if your client cannot find Node on PATH. The relay takes no extra arguments and locates the sibling installed executable itself. The portable download's self-extracting launcher is not this command; install Imnota to obtain a stable relay path. No separate downloaded relay asset is required. macOS and Linux continue using the executable directly.

The relay launches the real packaged `Imnota.exe --mcp` with inherited pipes, normal saved settings and the existing local-access opt-in. The server binds an owned read stream to descriptor 0 on Windows without changing `process.stdin`. The relay removes exactly one initial CR LF required by Electron 44.2.0, validates complete JSON-RPC response lines, and forwards their original bytes. Missing, changed or repeated prefixes, invalid UTF-8, blank/non-response output and incomplete lines fail closed. It never fabricates RPC responses or regenerates an export. A response line is bounded at 40 MB, accommodating the existing tool payload limits; normal pipe backpressure applies.

Client EOF closes the server input. The relay waits up to ten seconds for shutdown and terminates only its own child on failure, with bounded escalation. Pipe errors produce a short stderr message and failure exit; normal access-off refusal remains stderr with exit 1 and no client-visible stdout. Inherited Node injection, development-server and smoke variables are removed from the server environment. No `ELECTRON_RUN_AS_NODE` mode or console-attachment flag is required.

The existing Windows packaged verifier exercises both the bundled launch function and the external `node resources/imnota-mcp.mjs` command, including OFF refusal, ON discovery and exact saved bytes, strict stdout and EOF exit. A private IPC observation channel records the relay-owned server closing before the outer Node process exits; it also routes verifier failure cleanup to that exact child. It does not change the command arguments or MCP stdout. This launch contract still needs a passing report for the exact candidate and independent review. A source or Node pipe test does not establish that result. Until that gate passes, the existing opt-in loopback endpoint remains the verified Windows option. The local opt-in, selected-workspace boundary and HTTP Host/Origin checks are unchanged.
