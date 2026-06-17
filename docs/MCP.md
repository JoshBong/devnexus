# devnexus MCP

devnexus is both a **CLI** (humans set up the workspace) and an **MCP server**
(agents read and write the shared brain live, in-session). Same package, same
vault, two surfaces.

```
devnexus init        # human: scaffold the workspace + vault (CLI)
devnexus mcp         # agent: serve the vault as tools (MCP, stdio)
```

`devnexus init` / `devnexus update` register the MCP server for every configured
agent automatically — you don't run `devnexus mcp` by hand; the agent launches it.

## Why

The CLI gives agents a vault they're *supposed* to read. The MCP makes the vault a
set of tools they're *told* to call, injected via server instructions every session.
Passive files become an active brain — the actual fix for agent amnesia.

## Tools

| Tool | Use |
|------|-----|
| `vault_context` | **Call first every session.** Map of content + API contracts (verbatim) + last 3 handoffs + open handoffs + available practice areas. |
| `search_vault({query, limit?})` | Header-chunked, ranked search over the cold layer: decision history, architecture, graph report, node files, archive, practices. Use before proposing architectural changes. |
| `get_contract({name?})` | API contracts verbatim (never summarized). No name → whole file; with a name → that endpoint/section. |
| `log_decision({title, body, scope?, refs?})` | Persist a decision. `scope:"project"` → `DECISIONS.md`; `scope:"symbol"` (with `refs`) → atomic `decisions/` file. |
| `log_handoff({summary, branch?, done?, next?, to?})` | Structured session handoff appended to `SESSION_LOG.md`. |
| `god_nodes` | High-betweenness symbols devnexus computed from the graph — read before touching shared structures. |
| `communities` | Functional clusters with hub nodes — orient in unfamiliar code, scope refactors. |
| `practices({area?})` | Project code conventions. No area → list; with an area (`frontend`, `auth`, `java`…) → those rules. Call before writing code in an area. |

## Boundary with GitNexus

devnexus MCP and GitNexus MCP are complementary, not competing:

- **GitNexus** = the *raw code graph* — callers, blast radius, safe renames
  (`gitnexus_impact`, `gitnexus_query`, `gitnexus_context`, `gitnexus_rename`).
- **devnexus** = the *knowledge layer* (decisions, contracts, practices, handoffs)
  **+** *derived structure* (god nodes, communities) computed on top of the graph.

Run both. devnexus tells agents to defer to GitNexus for live graph ops.

## Auto-registration per agent

`init`/`update` write the MCP registration where each agent expects it:

| Agent | Where | Scope |
|-------|-------|-------|
| Claude Code | `.mcp.json` | project (committed) |
| Cursor | `.cursor/mcp.json` | project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | global (merged if present, else instructions printed) |
| Codex | `~/.codex/config.toml` | global (merged if present, else instructions printed) |

Claude and Cursor are fully automatic and project-scoped. Codex and Windsurf only
support global MCP config, so devnexus merges into the global file when it exists and
otherwise prints exact copy-paste instructions — never a silent no-op. The server
resolves the workspace from its launch directory, so one global registration works
across all your workspaces.

## Code practices

`devnexus init` scaffolds `<vault>/practices/` with starter files (`frontend.md`,
`auth.md`, `api.md`). Fill them with your conventions; add any area you want
(`java.md`, `db.md`, …). The filename is the area name agents pass to
`practices({ area })`. The `.ai-rules/` "Vault Brain" rule tells agents to call it
before writing code in an area — conventions land before the code, not at review.

## Manual / advanced

```
devnexus mcp                       # serve, resolving the workspace from cwd
devnexus mcp --workspace <dir>     # pin a workspace explicitly
DEVNEXUS_WORKSPACE=<dir> devnexus mcp
```

The protocol owns stdout; all server logging goes to stderr.
