export function sessionStart({ vaultName }) {
  return `# Session Start

## Read the Vault

Read these vault files before doing anything else:

1. \`./${vaultName}/MOC.md\` — map of content, entry point, session start sequence
2. \`./${vaultName}/DECISIONS.md\` — project-level decisions (license, tooling, infra)
3. \`./${vaultName}/decisions/DECISION_INDEX.md\` — symbol-linked decisions; check before editing any referenced symbol
4. \`./${vaultName}/SESSION_LOG.md\` — where the last session left off
4. \`./${vaultName}/ARCHITECTURE_OVERVIEW.md\` — system design and how repos connect (read on demand)

Do not suggest code changes until you have read all of the above.

## Code Graph Navigation

If \`./${vaultName}/NODE_INDEX.md\` exists, the workspace has a navigable code graph:

1. **God nodes** are in the NODE_INDEX.md header — always read before editing any of these symbols
2. **Community directories** are in \`./${vaultName}/nodes/{community}/\` — each has a \`_COMMUNITY.md\` with hub nodes and internal call graph
3. **Individual symbol files** are in each community directory — callers, callees, and cross-references

**When to use the graph:**
- Before touching a high-edge symbol → check its node file for blast radius
- When exploring unfamiliar code → find its community, read \`_COMMUNITY.md\` for context
- When planning a refactor → check which communities are affected via NODE_INDEX.md

## Code Intelligence (GitNexus)

If any repo in this workspace has a \`.gitnexus/\` directory, the GitNexus MCP server is available for that repo. Use it — it prevents breaking changes.

### Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run \`gitnexus_impact({target: "symbolName", direction: "upstream"})\` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST run \`gitnexus_detect_changes({scope: "staged"})\` before committing** to verify your changes only affect expected symbols and execution flows.
- For full context on a symbol — callers, callees, execution flows — use \`gitnexus_context({name: "symbolName"})\`.
- To find code by concept instead of grepping: \`gitnexus_query({query: "concept"})\`.

### Never Do

- NEVER edit a function, class, or method without first running \`gitnexus_impact\` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use \`gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})\` which understands the call graph.
- NEVER commit without running \`gitnexus_detect_changes()\` to confirm scope.

### Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |
`;
}

export function vaultRules({ vaultName }) {
  return `# Vault Update Rules

After completing work, check whether the vault needs updating before ending the session.

## Always update \`API_CONTRACTS.md\` when the public interface changes:
- A function/method signature or exported type changed
- A CLI command or flag was added, removed, or changed
- An HTTP endpoint's request or response shape changed, or one was added/removed
- An event, message schema, or config key changed

## Always update \`ARCHITECTURE_OVERVIEW.md\` when:
- A key data structure was added or changed
- A new repo or service was added
- A known gap was resolved or a new one discovered

## Always log decisions when:
- An approach was tried and rejected
- A non-obvious architectural choice was made
- A library or pattern was considered and ruled out

## Where to log decisions

**Symbol-linked decisions** (about specific functions, classes, types):
→ Create an atomic file in \`./${vaultName}/decisions/\`

**Project-level decisions** (license, tooling, infra, process):
→ Append to \`./${vaultName}/DECISIONS.md\`

## Live decision capture (do this DURING the session, not just at the end):
When any of these happen mid-session, immediately say: *"That's worth logging — [one-line summary]. Want me to add it now?"*

- An approach was attempted and failed or was abandoned
- The user says "that didn't work", "let's try something else", "scrap that", "go back"
- A workaround was chosen over a cleaner solution (and why)
- A bug was caused by a non-obvious interaction
- A library or tool was evaluated and rejected
- You discover the current approach contradicts an existing decision

Do NOT wait until the end of the session. Log it as it happens.

## How to write a symbol-linked decision:

**Before writing:** Run \`cd ${vaultName} && git pull\`

**Create a file** at \`./${vaultName}/decisions/YYYY-MM-DD-short-slug.md\`:
\`\`\`markdown
# Short decision title

Date: YYYY-MM-DD
Author: [engineer name]
Status: ACTIVE
Refs: [[SymbolName]], [[OtherSymbol]]
Depends: (filename of prior related decision, if any)

---

What was considered and why it was rejected/chosen.
\`\`\`

**After writing:** Run \`cd ${vaultName} && git add decisions/ && git commit -m "decision: [short title]" && git push\`

## How to write a project-level decision:

**Before writing:** Run \`cd ${vaultName} && git pull\`

**Append to** \`./${vaultName}/DECISIONS.md\`:
\`\`\`markdown
## YYYY-MM-DD — Short title (by [engineer name])

What was considered and why it was rejected/chosen. Two sentences max.
\`\`\`

**After writing:** Run \`cd ${vaultName} && git add DECISIONS.md && git commit -m "decision: [short title]" && git push\`

## Suggest running \`devnexus index\` when:
- \`GRAPH_REPORT.md\` seems outdated after many files have changed
- The user asks about blast radius, god nodes, or structural dependencies and the report is stale
- After a major refactor that reorganized significant parts of the codebase

## Natural triggers — check the vault after:
- A feature is complete and ready to commit
- The user says anything like "done", "ship it", "commit", "that's it for now"
- A bug fix revealed something undocumented about how the system works

## How to update
When a trigger fires, proactively say: *"Before we wrap up — [specific file] needs updating because [reason]. Want me to do that now?"*

Do not silently skip it. Do not update the vault without confirming with the user first.
`;
}

export function contractDrift({ vaultName }) {
  return `# Contract Drift Check — Before Every Push

Before pushing code, compare your changes against \`./${vaultName}/API_CONTRACTS.md\`:

1. Review the diff: did any part of the public interface change — a function signature or exported type, a CLI command or flag, an HTTP route or request/response shape, a status code, an event, a config key, or an auth pattern?
2. Read \`API_CONTRACTS.md\` and check whether it still matches the code you're about to push.

**If you find a mismatch**, stop and say:

> *"I found a contract drift: [describe the specific difference]. What would you like to do?"*
> 1. **Update the contract** — I'll update \`API_CONTRACTS.md\` to match the code changes
> 2. **Revert the code** — the contract is correct, I'll roll back the change
> 3. **Check impact first** — I'll analyze what depends on this interface before deciding

Do NOT silently update the contract. Do NOT silently push. Surface it, present the three options, and wait for a decision.

**What counts as drift:**
- A part of the public interface exists in code but not in \`API_CONTRACTS.md\` (a new function, CLI flag, endpoint, event, or config key)
- A documented interface was removed or renamed
- Inputs or outputs were added, removed, or changed type (function params/return, request/response fields, flags)
- Status codes or error/failure responses changed
- Auth or access requirements changed
`;
}

export function mcpRules() {
  return `# Vault Brain (devnexus MCP)

If the \`devnexus\` MCP server is connected, the vault is available as live tools.
Use them — they prevent re-discovering dead ends and re-deciding settled questions.

## Always Do

- **MUST call \`vault_context\` at the START of every session** — it returns the map of
  content, API contracts (verbatim), the last 3 handoffs, and which practice areas exist.
  This replaces opening MOC.md / API_CONTRACTS.md / SESSION_LOG.md by hand.
- **MUST call \`search_vault\` before proposing any architectural change** — check what was
  already decided and rejected. Dead ends stay dead.
- **MUST call \`practices({ area })\` before writing code in an area** (frontend, auth, etc.)
  so you follow conventions up front, not after review.
- **Before touching a shared structure**, call \`god_nodes\` / \`communities\` to see blast radius.
- **Log decisions with \`log_decision\` AS THEY HAPPEN** — \`scope:"project"\` for tooling/infra,
  \`scope:"symbol"\` (with \`refs\`) for decisions about specific functions/classes.
- **At session end, call \`log_handoff\`** with branch, what's done, and what's next.

## Never Do

- NEVER propose an architectural change without \`search_vault\` first.
- NEVER treat \`get_contract\` output as advisory — contracts are the final authority.
- NEVER use devnexus tools for the live code graph. For callers, blast radius, and safe
  renames use the **GitNexus** MCP (\`gitnexus_impact\`, \`gitnexus_query\`, \`gitnexus_context\`).
  devnexus owns knowledge + derived structure; GitNexus owns the raw graph.

## If the MCP is not connected

Fall back to reading the vault files directly (see Session Start). The tools are a faster,
more reliable surface over the same files — the rules above still apply either way.
`;
}

