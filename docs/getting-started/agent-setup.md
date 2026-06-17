# Agent Setup

devnexus supports multiple AI agents simultaneously. Each agent gets rules tailored to how it reads configuration.

## Supported Agents

| Agent | Config File | Type | Integration Level |
|-------|------------|------|-------------------|
| **Claude Code** | `CLAUDE.md` | Pointer | Full — reads `.ai-rules/` directory natively |
| **Cursor** | `.cursorrules` | Inline | Full — rules concatenated into file |
| **Codex** | `AGENTS.md` | Pointer | Full — reads `.ai-rules/` directory natively |
| **Windsurf** | `.windsurfrules` | Inline | Full — rules concatenated into file |
| **Generic** | `AI_RULES.md` | Inline | Any tool — rules concatenated into a universal file |

### Pointer vs Inline

**Pointer agents** (Claude Code, Codex) get a thin file that says "read `.ai-rules/`". The agent follows the reference and reads each rule file. You can freely edit the pointer file — devnexus won't overwrite it.

**Inline agents** (Cursor, Windsurf) can't follow directory references, so devnexus concatenates all `.ai-rules/` content directly into the config file. Content between `<!-- devnexus:managed:start -->` and `<!-- devnexus:managed:end -->` markers is managed by devnexus. You can add custom content outside the fences — it's preserved across updates.

## Managing Agents

### Add an agent to your workspace

```bash
devnexus agent add cursor
```

Creates the config file at workspace level and in every tracked repo.

### Remove an agent

```bash
devnexus agent rm windsurf
```

Removes config files from workspace and all repos.

### See what's configured

```bash
devnexus agent ls
```

Shows each agent and its status per repo (green = file exists, red = missing).

### Interactive selection

```bash
devnexus agent
```

Prompts you to select which agents you want. Adds or removes to match your selection.

## Multi-Agent Workflows

devnexus is designed for teams that use different agents for different tasks. A common pattern:

| Task | Agent | Why |
|------|-------|-----|
| Architecture, cross-repo reasoning | Claude Code | Sees the full workspace, strategic context window |
| Component edits, bug fixes (1-5 files) | Cursor | Fast, tactical, stays scoped |
| Code review, PR analysis | Codex | Good at reviewing diffs |

All three agents read the same `.ai-rules/` and the same vault. When Cursor logs a decision during a bug fix, Claude Code sees it in its next session. The vault is the shared brain — the agents are interchangeable hands.

## What Each Agent Rule File Does

Every agent, regardless of type, gets these rules:

### Workspace Level (`.ai-rules/`)

| File | Purpose |
|------|---------|
| `01-session-start.md` | Read vault files in order: MOC → DECISIONS → SESSION_LOG → ARCHITECTURE_OVERVIEW |
| `02-vault-rules.md` | When to update API_CONTRACTS.md, ARCHITECTURE_OVERVIEW.md, DECISIONS.md |
| `03-contract-drift.md` | Before pushing: check code against API_CONTRACTS.md, stop if mismatched |
| `04-vault-brain-mcp.md` | devnexus MCP tools: vault_context, search_vault, why |

### Repo Level (`.ai-rules/`)

| File | Purpose |
|------|---------|
| `01-source-of-truth.md` | Vault is truth — check it before writing code |
| `02-decision-logic.md` | Consult API_CONTRACTS.md and DECISIONS.md before proposing changes |
| `03-contract-drift.md` | Pre-push contract check with three resolution options |
| `04-code-intelligence.md` | GitNexus tool usage: when to query, impact, context, rename |

## Updating Rules After a devnexus Upgrade

When devnexus releases new rule templates:

```bash
devnexus update
```

This regenerates `.ai-rules/` across workspace and repos, syncs inline agent files, and updates git hooks. Vault content is never touched.

## Next Steps

- **What the vault contains** → [Vault Structure](../reference/vault-structure.md)
- **How .ai-rules/ works in detail** → [AI Rules Reference](../reference/ai-rules.md)
- **Full command reference** → [Commands](../reference/commands.md)
