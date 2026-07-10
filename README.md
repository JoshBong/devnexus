<div align="center">

# devnexus

**Your agents start every session with amnesia. devnexus fixes that.**

One command. Shared brain across repos, sessions, and engineers. Decisions survive, context compounds, no one re-discovers dead ends.

[![npm](https://img.shields.io/npm/v/devnexus)](https://www.npmjs.com/package/devnexus) [![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-blue.svg)](LICENSE) [![LinkedIn](https://img.shields.io/badge/LinkedIn-Joshua%20Huang-0A66C2?logo=linkedin)](https://www.linkedin.com/in/jhuang314/)

</div>

---

## Shared brain for AI agents across sessions and engineers.

When one engineer's agent discovers that approach X doesn't work, that knowledge dies when the session ends. The next engineer — or the same engineer tomorrow — re-discovers the same dead end.

devnexus gives every agent a vault they read before writing any code. Decisions, architecture, and API contracts persist across sessions and engineers. Context compounds instead of resetting.

As of **v3**, the vault is also an **MCP server** — agents read and write it live as they work, and you read the same store to review their work and remember *why* something was done. Same brain, two readers: the agent and you. Run `devnexus why <symbol>` and get the decisions (and the commits) behind any piece of code.

---

## Quick Start

```bash
npm install -g devnexus

mkdir my-project && cd my-project
devnexus init
```

That's it. devnexus creates an Obsidian vault alongside your repos that acts as the shared brain. Your agents read it before writing any code.

---

## Example Setup

```bash
mkdir example-proj && cd example-proj
devnexus init
```

```
? Do you have an existing project vault? No
? What's your project called? example-proj
? Describe your project: Restaurant booking platform with AI recommendations
? What's your tech stack? Next.js + FastAPI + Supabase (or auto-detected from your repos)
? What's your name? Sarah

? Repo: https://github.com/example/frontend.git
? Repo: https://github.com/example/backend.git
? Repo: (enter)

? Which AI agents do you use?
  ◉ claude
  ◯ cursor
  ◯ codex
  ◯ windsurf
```

Open `example-proj-vault/` in Obsidian and run `devnexus index` to generate the code graph. Start coding.

---

## Vault Sync

The vault needs a git remote to sync across machines and teammates.

1. Create a new repo on GitHub (private recommended)
2. Add it as the vault remote:
   ```bash
   cd your-vault
   git remote add origin https://github.com/you/your-vault.git
   git push -u origin main
   ```
3. Open Obsidian → File → Open Vault → select `your-vault/`
4. Settings → Community Plugins → install "Git" (by Vinzent)

**Sync is devnexus-owned (v3).** When an agent writes a decision or handoff through the MCP, devnexus commits and pushes it to the vault remote right then — and an embedded watcher commits + pushes your manual edits too, catching up anything you changed offline the next time an agent session starts. It's fail-soft (offline → commit locally, push later) and conflict-safe (atomic files + pull-before-write). Obsidian Git is left configured for **auto-pull only** (live viewing); devnexus does the committing. Check state with `devnexus status`, or force a sync with `devnexus sync`.

---

## For Teams

One engineer's discovery is every engineer's context — within minutes, not meetings.

```
10:00am  Engineer A's agent tries approach X on UserSync → fails
10:01am  Agent creates decisions/2026-04-16-usersync-polling-rejected.md → git push
10:01am  Obsidian Git syncs on Engineer B's machine (~1 min)
10:15am  Engineer B opens UserSync's node file → sees the decision linked
         before they even think about editing it
```

Decisions about specific code symbols go in `decisions/` as individual files with explicit refs. `devnexus index` links them back into the code graph. Project-level decisions (tooling, license, infra) stay in `DECISIONS.md` append-only. See [Decision System](docs/DECISIONS.md) for details.

**Sync model (v3):** devnexus commits and pushes as agents write (and the embedded watcher catches your manual edits); Obsidian Git only auto-pulls for live viewing. This is git-based, not a server — scales with your git host. Merge conflicts are rare because vault entries are append-only or in separate files; when one does happen, devnexus keeps your work committed locally, never leaves conflict markers in the tree, and flags it in `devnexus status` for a normal git resolve.

**Joining an existing workspace:**

```bash
mkdir my-project && cd my-project
devnexus init
# "Do you have an existing project vault?" → Yes
# Provide the vault git URL or local folder name
# Add your repos, pick your agents — done
```

The vault is cloned (or linked) into your workspace. Nothing in it is modified.

---

## Commands

```
devnexus init                     set up a new AI-augmented workspace
devnexus upgrade                  update devnexus and regenerate workspace rules
devnexus update                   regenerate .ai-rules/ and git hooks with latest templates
devnexus add <repo>               add a repo (HTTPS, SSH, or local folder)
devnexus remove <repo>            remove a repo from workspace tracking
devnexus analyze [target]         run GitNexus analyze (all repos or specific repo)
devnexus index                    build code graph, structural analysis, GRAPH_REPORT.md
devnexus index --force            rebuild even if index is up to date
devnexus status                   workspace health dashboard
devnexus doctor                   deep diagnostic
devnexus doctor --fix             auto-repair common issues
devnexus agent ls                 list agents configured per repo
devnexus agent add <agent>        add an agent (claude, cursor, codex, windsurf)
devnexus agent rm <agent>         remove an agent
devnexus completion install       set up shell tab completion (bash/zsh/fish)
devnexus completion uninstall     remove tab completion
devnexus mcp                      run the MCP server (agents call this, not you)
devnexus sync                     commit & push vault changes (or --watch)
devnexus why <symbol>             show the decisions & commits behind a symbol
```

---

## MCP: the vault as live agent tools

devnexus is a CLI **and** an MCP server. The CLI is for humans setting up the
workspace; the MCP is for agents reading and writing the shared brain *during* a
session. `devnexus init` / `update` auto-register the server for each agent
(`.mcp.json` for Claude, `.cursor/mcp.json` for Cursor; global config or printed
instructions for Codex/Windsurf) — you never launch it by hand.

Instead of hoping an agent reads the right files, it calls tools it's told to use:

| Tool | Use |
|------|-----|
| `vault_context` | Call first every session — MOC + contracts + recent handoffs + practice areas |
| `search_vault` | Ranked search over decisions, architecture, nodes, archive — before any architectural change |
| `get_contract` | API contracts verbatim — the final authority |
| `log_decision` | Persist a decision (project-level or symbol-linked) as it happens |
| `log_handoff` | Structured session handoff for the next agent/engineer |
| `god_nodes` / `communities` | devnexus's structural analysis — read before touching shared structures |
| `practices` | Project code conventions by area (frontend, auth, …) — before you write |
| `why` | The decisions + commits behind a symbol — the provenance, for agent or human |

devnexus owns the **knowledge layer + derived structure**; [GitNexus](https://github.com/abhigyanpatwari/GitNexus) owns
the **raw code graph** (callers, blast radius, safe renames). Run both — they compose.
Full reference: [docs/MCP.md](docs/MCP.md).

---

## How It Works

devnexus builds a **code graph** from your repos and writes it into the vault as browsable Obsidian files.

`devnexus analyze` builds a raw graph per repo — every function, class, and type becomes a node, call relationships become edges. `devnexus index` merges them into a single cross-repo view and computes structural analysis:

- **God nodes** — symbols with high [betweenness centrality](https://en.wikipedia.org/wiki/Betweenness_centrality). Many shortest paths route through them, so changes ripple further than edge count suggests. Always surfaced so agents check before editing.
- **Communities** — groups of symbols that call each other more than they call outside the group. Auto-detected, named from file paths, with hub nodes identified.
- **Bridges** — the sole call edge between two communities. If it breaks, those communities disconnect.
- **Knowledge gaps** — thin communities, oversized communities, low cohesion. Structural warning signs.

The vault has two layers (v3):

- **Authored** — `decisions/`, `handoffs/`, `API_CONTRACTS.md`, `practices/`. Written by you and your agents, **committed and shared**, branch-agnostic. This is the durable "why."
- **Derived** — the code graph below. Regenerated from code by `devnexus index`, so it's **local + per-branch + gitignored** (each engineer's index follows their own checkout — no merge fights).

| Derived file | What it is |
|------|------------|
| `NODE_INDEX.md` | A clean, human "Code Map" — god nodes and areas in plain language |
| `NODE_INDEX.json` | The complete structured record — what the MCP tools and (later) the plugin read |
| `nodes/{community}/*.md` | Per-symbol cards — lead with *why* (decisions), then callers/callees |
| `GRAPH_REPORT.md` | Structural analysis — god nodes, bridges, gaps, diff from last index |

Cross-repo symbols are namespaced (`frontend::UserCard` vs `backend::UserCard`), so the merged graph shows how repos connect without collisions.

---

## Integrations

devnexus works on its own. [GitNexus](https://github.com/abhigyanpatwari/GitNexus) adds deeper code intelligence if you want it — devnexus manages it for you.

| Tool | What it adds | How to use |
|------|-------------|------------|
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Code intelligence — blast radius, execution flows, safe renames via MCP | Prompted during `devnexus init` — auto-installs if you say yes |
| `devnexus analyze` | Runs GitNexus analyze on all repos (or a specific one) | Built-in command |
| `devnexus index` | Builds vault code graph, structural analysis, GRAPH_REPORT.md | Built-in command, no extra install |

For details: [Integrations Guide](docs/INTEGRATIONS.md)

---

## Requirements

| | Required | Purpose |
|-|----------|---------|
| `git` | Yes | Vault sync, repo cloning |
| `node` ≥18 | Yes | Running devnexus |
| [Obsidian](https://obsidian.md/) | Recommended | Free markdown editor — browse the vault (the vault is plain markdown; any editor works) |
| AI agent (Claude Code, Cursor, Windsurf, Codex) | Yes | At least one |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | **Yes (v3)** | Powers the code graph — `devnexus init` installs it for you |

---

## FAQ

**Can I use this with one repo?**
Yes. The vault still adds value as persistent memory across sessions.

**Should I edit `.ai-rules/`?**
devnexus owns its numbered rule files (`00-gate.md`, `01-…`) — those are regenerated by `update`. But you can add your **own** rule files alongside them (e.g. `05-team-conventions.md`): every `.md` in the dir is a live rule, and `devnexus update` preserves anything it didn't write. Pointer files (`CLAUDE.md`, `.cursorrules`, …) also keep your customizations.

**How do I add an agent later?**
`devnexus agent add windsurf`. List: `devnexus agent ls`. Remove: `devnexus agent rm cursor`.

**How do I update?**
`devnexus upgrade`. Updates the package and regenerates `.ai-rules/` and git hooks. Upgrading to v3 also migrates the vault: scaffolds `practices/` + `handoffs/`, switches to devnexus-owned sync, and moves the derived code graph to local/per-branch (it prints a one-line commit to finish the migration).

**Why does my code say `retryFetch` polls?**
Run `devnexus why retryFetch` — it returns the decisions (and the commits) behind that symbol. Agents call the same thing via the MCP `why` tool before changing code they don't understand.

**What is the contract drift check?**
A pre-push hook that blocks pushes when API dirs change without updating `API_CONTRACTS.md`. Bypass with `git push --no-verify`.

**Second project?**
`devnexus init` in a new folder. Each workspace is independent.

---

## Development

```bash
git clone https://github.com/JoshBong/devnexus.git && cd devnexus
npm install
npm test
```

The graph-dependent suites (index builder, decisions, stress) need a local GitNexus index and skip with a note until you run `npx gitnexus analyze` in the checkout; everything else runs anywhere.

---

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and noncommercial use.

For commercial or enterprise licensing, contact [huangjoshuawork@gmail.com](mailto:huangjoshuawork@gmail.com).
