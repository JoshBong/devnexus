# Quick Start

Get a persistent AI workspace running in under 2 minutes.

## Prerequisites

| Requirement | Why |
|-------------|-----|
| **Node.js 18+** | Runtime for the CLI |
| **git** | Repo detection, hooks, vault sync |
| **Obsidian** (free) | Opens and browses the vault — your agents' shared brain |
| **At least one AI agent** | Cursor, Claude Code, Codex, Windsurf, or OpenCode |

## Install

```bash
npm install -g devnexus
```

## Initialize a Workspace

```bash
mkdir my-project && cd my-project
devnexus init
```

The interactive setup asks for:

```
? Project name: my-project
? Short description: E-commerce platform with Next.js frontend and FastAPI backend
? Tech stack (comma-separated): Next.js, FastAPI, Supabase, TypeScript, Python
? Repository URLs or local paths: ./frontend, ./backend
? Select AI agents: Claude Code, Cursor
```

## What Just Happened

devnexus created three things:

### 1. An Obsidian Vault — the shared brain

```
my-project-vault/
├── MOC.md                    # Entry point — read FIRST every session
├── ARCHITECTURE_OVERVIEW.md  # System design, how repos connect
├── API_CONTRACTS.md          # Endpoint shapes — final authority
├── DECISIONS.md              # Rejected approaches, non-obvious choices
├── SESSION_LOG.md            # Two-line handoff notes per session
└── GRAPH_REPORT.md           # Structural analysis (populated by devnexus index)
```

### 2. Agent Rules — the shared protocol

```
.ai-rules/                   # Workspace-level rules
├── 01-session-start.md       # What to read and in what order
├── 02-vault-rules.md         # When to update vault files
├── 03-contract-drift.md      # Block pushes if API contracts are stale
└── 04-vault-brain-mcp.md     # devnexus MCP tools for the vault
```

Each repo also gets its own `.ai-rules/` with repo-specific rules (source of truth, decision logic, code intelligence).

### 3. Git Hooks — the safety net

| Hook | What It Does |
|------|-------------|
| **pre-push** | Blocks push if API-related files changed but `API_CONTRACTS.md` wasn't updated |
| **post-commit** | Runs `gitnexus analyze` to keep the code graph fresh |
| **post-merge** | Warns you to run `devnexus index` if symbol count shifted significantly |

## Your First Session

Open the vault in Obsidian, then start your AI agent. It will:

1. Read `MOC.md` → `DECISIONS.md` → `SESSION_LOG.md` to pick up where the last session left off
2. Check `API_CONTRACTS.md` before making API changes
3. Log any rejected approaches to `DECISIONS.md` during the session
4. Write a handoff note to `SESSION_LOG.md` when you're done

That's it. Every future session starts with full context from every past session.

## .gitignore

devnexus generates files that should not be committed to your project repos. Add these to each repo's `.gitignore`:

```gitignore
# devnexus
.ai-rules/
.workspace-config
*-vault/

# agent pointer files
CLAUDE.md
AGENTS.md
AI_RULES.md
.cursorrules
.windsurfrules

# obsidian
.obsidian/

# code intelligence
.gitnexus/
.claude/
```

> `devnexus init` automatically adds `.ai-rules/`, `.cursor/`, and `.gitnexus` to each repo's `.gitignore`, but you may want to add the full list above.

## Next Steps

- **Adding GitNexus?** → [GitNexus Integration](../integrations/gitnexus.md)
- **Working with a team?** → [Join an Existing Workspace](join-existing-workspace.md)
- **Setting up a specific agent?** → [Agent Setup](agent-setup.md)
- **Full command reference** → [Commands](../reference/commands.md)
