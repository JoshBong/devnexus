# AI Rules Reference

`.ai-rules/` is the protocol that tells AI agents how to interact with the vault. devnexus generates these files at workspace and repo level.

## Two Levels of Rules

```
workspace/
├── .ai-rules/                    # Workspace-level rules (4 files)
│   ├── 01-session-start.md
│   ├── 02-vault-rules.md
│   ├── 03-contract-drift.md
│   ├── 04-vault-brain-mcp.md
│   └── version.txt
├── repo-a/
│   └── .ai-rules/               # Repo-level rules (5 files)
│       ├── 00-gate.md
│       ├── 01-source-of-truth.md
│       ├── 02-decision-logic.md
│       ├── 03-contract-drift.md
│       ├── 04-code-intelligence.md
│       └── version.txt
└── repo-b/
    └── .ai-rules/               # Same structure, same rules
```

**Workspace rules** govern session behavior (what to read, when to update the vault). **Repo rules** govern coding behavior (check contracts before coding, use GitNexus for impact analysis).

## Workspace Rules

### 01-session-start.md

Tells the agent what to read and in what order at session start:

1. Read vault files: MOC → DECISIONS → SESSION_LOG → ARCHITECTURE_OVERVIEW
2. If `NODE_INDEX.md` exists, check god nodes and communities
3. Use GitNexus MCP tools for code exploration

### 02-vault-rules.md

When to update vault files during a session:

- Update `API_CONTRACTS.md` when endpoints change
- Update `ARCHITECTURE_OVERVIEW.md` when data structures or repos change
- Add to `DECISIONS.md` when an approach is rejected or a non-obvious choice is made
- **Live decision capture:** log immediately when an approach fails, don't wait for session end

### 03-contract-drift.md

Before pushing:

1. Diff code changes against `API_CONTRACTS.md`
2. If mismatch found → stop and surface three options:
   - Update the contract
   - Revert the code
   - Check downstream impact
3. Never silently update the contract or push with a mismatch

### 04-vault-brain-mcp.md

When to use the devnexus MCP tools for the vault:

- `vault_context` to pull the current vault state at session start
- `search_vault` to find decisions and contracts by concept
- `why` to surface the reasoning behind a logged decision

## Repo Rules

### 01-source-of-truth.md

Establishes that the vault at `../{vaultName}/` is the single source of truth. Before writing code, check:
- `ARCHITECTURE_OVERVIEW.md` for system design
- `API_CONTRACTS.md` for endpoint shapes
- `DECISIONS.md` for rejected approaches

### 02-decision-logic.md

Before coding:
- Consult `API_CONTRACTS.md` for compatibility
- Check `DECISIONS.md` for already-rejected approaches
- Live decision capture during the session

### 03-contract-drift.md

Same contract check as workspace level, scoped to this repo's API changes.

### 04-code-intelligence.md

GitNexus tool usage rules:

| Tool | When To Use |
|------|------------|
| `gitnexus_query()` | Find code by concept instead of grepping |
| `gitnexus_context()` | 360-degree view of one symbol (callers, callees, flows) |
| `gitnexus_impact()` | **Before editing any symbol** — blast radius analysis |
| `gitnexus_rename()` | Multi-file renames (never use find-and-replace) |
| `gitnexus_detect_changes()` | Pre-commit scope verification |

Risk levels: d=1 (WILL BREAK), d=2 (LIKELY AFFECTED), d=3 (MAY NEED TESTING).

Rules: Never edit without impact analysis. Never ignore HIGH/CRITICAL warnings.

## Version Tracking

Each `.ai-rules/` directory contains a `version.txt` file tracking the template version. When devnexus releases new templates:

```bash
devnexus update
```

This regenerates all rule files while preserving any `00-existing-rules.md` files you've added.

## Agent Pointer Files

Agents receive rules differently depending on type:

### Pointer Agents (Claude Code, Codex)

A thin file that references `.ai-rules/`:

```markdown
# AI Rules

Read the `.ai-rules/` directory for session rules and coding guidelines.
```

You can add custom content to these files — devnexus won't overwrite them.

### Inline Agents (Cursor, Windsurf)

Rules are concatenated directly into the config file:

```markdown
<!-- devnexus:managed:start -->
[all .ai-rules/ content concatenated here]
<!-- devnexus:managed:end -->

[your custom content goes here — preserved across updates]
```

Content between the managed markers is regenerated on `devnexus update`. Content outside the markers is yours.

## Next Steps

- **What the vault files contain** → [Vault Structure](vault-structure.md)
- **How git hooks enforce contracts** → [Git Hooks](git-hooks.md)
- **Adding/removing agents** → [Agent Setup](../getting-started/agent-setup.md)
