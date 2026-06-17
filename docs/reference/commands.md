# Commands Reference

Full CLI reference for devnexus.

## Overview

```bash
devnexus init                    # Set up a new AI-augmented workspace
devnexus analyze [--repo <name>] # Run GitNexus analyze on workspace repos
devnexus index                   # Build navigable code graph in the vault
devnexus update [--force]        # Regenerate .ai-rules/ with latest templates
devnexus add <repos...>          # Add repo(s) to existing workspace
devnexus remove <repo> [--clean] # Remove repo from workspace tracking
devnexus status                  # Show workspace health dashboard
devnexus doctor [--fix]          # Diagnose and fix workspace problems
devnexus agent ls                # Show configured agents and status
devnexus agent add <agent>       # Add an agent to the workspace
devnexus agent rm <agent>        # Remove an agent from the workspace
devnexus completion install      # Install shell tab completion
devnexus completion uninstall    # Remove shell tab completion
```

## Commands

### `devnexus init`

Set up a new AI-augmented workspace. Interactive — prompts for project details.

**What it creates:**
- Obsidian vault with 6 core files + full Obsidian config
- `.ai-rules/` at workspace level (4 rule files)
- `.ai-rules/` per repo (5 rule files)
- Agent pointer files per configured agent
- Git hooks per repo (pre-push, post-commit, post-merge)
- `.workspace-config` with all metadata

**Join flow:** Choose "Join existing" to connect to a team's vault instead of creating a new one.

---

### `devnexus analyze`

Run GitNexus analyze on workspace repos to rebuild the code graph.

```bash
devnexus analyze              # All repos
devnexus analyze --repo api   # Specific repo
```

Prerequisite for `devnexus index`. The post-commit hook already runs this automatically after each commit.

---

### `devnexus index`

Build navigable code graph documentation in the vault.

Reads the GitNexus graph for all repos and generates:

| Output | Description |
|--------|------------|
| `NODE_INDEX.md` | Full symbol table with tiers, betweenness centrality, communities |
| `nodes/{community}/` | Per-community directories with hub nodes and symbol files |
| `ARCHITECTURE_OVERVIEW.md` | God node summary and community list injected between markers |
| `GRAPH_REPORT.md` | Structural analysis with diff from previous run |

**Detection thresholds:**
- **God nodes:** >=10 edges OR >=3 cross-community reach OR betweenness centrality >0.05 (max 15 surfaced)
- **Bridges:** Sole call edge between two communities
- **Knowledge gaps:** Thin (<=2 symbols), low cohesion (<0.2), oversized (>50), flat (no hub with >=3 edges)

---

### `devnexus update`

Regenerate `.ai-rules/` with the latest templates.

```bash
devnexus update           # Only if template version changed
devnexus update --force   # Force regeneration regardless of version
```

**Updates:** Workspace `.ai-rules/`, per-repo `.ai-rules/`, inline agent pointers (Cursor, Windsurf), git hooks.

**Does NOT touch:** Vault content, non-inline pointer files (CLAUDE.md, AGENTS.md).

---

### `devnexus add`

Add repos to an existing workspace.

```bash
devnexus add ./new-service                        # Local path
devnexus add git@github.com:team/new-service.git  # Clone from URL
devnexus add service-a service-b                   # Multiple repos
```

For each repo: creates `.ai-rules/`, installs hooks, creates agent pointers, updates MOC.md and SESSION_LOG.md, runs `gitnexus analyze` if available.

---

### `devnexus remove`

Remove a repo from workspace tracking.

```bash
devnexus remove old-service           # Remove from config only
devnexus remove old-service --clean   # Also remove .ai-rules/ and pointer files
```

Does NOT delete the repo directory.

---

### `devnexus status`

Show workspace health dashboard.

Displays: project name, vault status (git state, last commit), `.ai-rules/` versions, agent pointer status per repo, code graph index stats (symbols, communities, god nodes, staleness).

---

### `devnexus doctor`

Diagnose workspace problems.

```bash
devnexus doctor         # Report only
devnexus doctor --fix   # Auto-repair what's possible
```

**Checks:**
- Config exists and is valid
- Vault has all expected files + git remote
- `.ai-rules/` at latest version (workspace + per-repo)
- Agent pointer files exist
- `.gitignore` has required entries
- GitNexus index exists per repo
- Code graph index freshness (<14 days)
- `NODE_INDEX.md` and `nodes/` exist
- Vault registered in `~/.claude/vault-map.json`

---

### `devnexus agent`

Manage AI agents.

```bash
devnexus agent          # Interactive selection
devnexus agent ls       # Show configured agents + per-repo status
devnexus agent add <n>  # Add agent (claude, cursor, codex, windsurf)
devnexus agent rm <n>   # Remove agent
```

---

### `devnexus completion`

Shell tab completion.

```bash
devnexus completion install     # Add to your shell profile
devnexus completion uninstall   # Remove from shell profile
```

## Next Steps

- **Getting started** → [Quick Start](../getting-started/quick-start.md)
- **Workspace config format** → [Config](config.md)
- **How rules work** → [AI Rules](ai-rules.md)
