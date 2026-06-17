export function gate() {
  return `# ⚠ STOP — Read Before Any Edit

If this repo has a \`.gitnexus/\` directory:

1. **Before editing any function/class/method** → run \`gitnexus_impact({target: "symbolName", direction: "upstream"})\` and check the blast radius. No exceptions.
2. **Before searching for how something works** → try \`gitnexus_query({query: "concept"})\` before grep. It returns ranked, process-grouped results.
3. **Before committing** → run \`gitnexus_detect_changes({scope: "staged"})\` to verify only expected symbols changed.

If \`.gitnexus/\` does not exist, skip this rule.
`;
}

export function sourceOfTruth({ projectName, repoStack, vaultName }) {
  return `# Source of Truth

You are an expert engineer working on ${projectName}. This is ${repoStack}.

The Obsidian vault at \`../${vaultName}/\` is the single source of truth for architecture, API contracts, and decisions. Always check there first before writing code.

- **Architecture:** \`../${vaultName}/ARCHITECTURE_OVERVIEW.md\`
- **API contracts:** \`../${vaultName}/API_CONTRACTS.md\` — the final authority on endpoint shapes
- **Decisions:** \`../${vaultName}/DECISIONS.md\` (project-level) + \`../${vaultName}/decisions/DECISION_INDEX.md\` (symbol-linked)
`;
}

export function decisionLogic({ vaultName }) {
  return `# Decision Logic

- Before writing any code, consult \`../${vaultName}/API_CONTRACTS.md\` to ensure compatibility.
- Before proposing an alternative approach, check \`../${vaultName}/DECISIONS.md\` (project-level) and \`../${vaultName}/decisions/DECISION_INDEX.md\` (symbol-linked) — they log rejected approaches and why.
- If a requirement is unclear, check the vault for more context before asking.
- **Live decision capture:** When an approach fails, is abandoned, or a non-obvious choice is made mid-session, immediately suggest logging it. Before writing, run \`cd ../${vaultName} && git pull\`.
  - **Symbol-linked** (about specific functions/classes): create \`../${vaultName}/decisions/YYYY-MM-DD-short-slug.md\` with Date, Author, Status: ACTIVE, Refs: [[Symbol]], and body text. Then \`cd ../${vaultName} && git add decisions/ && git commit -m "decision: [title]" && git push\`.
  - **Project-level** (tooling, infra, process): append to \`../${vaultName}/DECISIONS.md\` with format \`## YYYY-MM-DD — Title (by [name])\` followed by two sentences. Then \`cd ../${vaultName} && git add DECISIONS.md && git commit -m "decision: [title]" && git push\`.
`;
}

export function contractDrift({ vaultName }) {
  return `# Contract Drift Check

Before pushing code, diff your changes against \`../${vaultName}/API_CONTRACTS.md\`. If any route, request/response shape, field, status code, or auth pattern has changed and the contract doesn't reflect it, stop and say:

> *"I found a contract drift: [describe the specific difference]. What would you like to do?"*
> 1. **Update the contract** — I'll update \`API_CONTRACTS.md\` to match the code
> 2. **Revert the code** — the contract is correct, I'll roll back the change
> 3. **Check impact first** — I'll analyze what depends on this before deciding

Do not silently update the contract or push without surfacing the mismatch.
`;
}

export function codeIntelligence() {
  return `# Code Intelligence (GitNexus)

If this repo has a \`.gitnexus/\` directory, the GitNexus MCP server is active. Use it for all code exploration — not just before edits.

## When Researching / Exploring

- **For quick lookups** (a specific string, error message, variable name): grep is fine.
- **For understanding how something works** (tracing a flow, finding all callers, understanding blast radius): use \`gitnexus_query({query: "concept"})\` — it returns process-grouped results ranked by relevance.
- **To understand a symbol:** \`gitnexus_context({name: "symbolName"})\` — shows all callers, callees, and which execution flows it participates in.
- **To trace a bug:** query first, then follow execution flows with \`gitnexus_context\` on suspect functions.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run \`gitnexus_impact({target: "symbolName", direction: "upstream"})\` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding.
- **MUST run \`gitnexus_detect_changes({scope: "staged"})\` before every commit** to verify your changes only affect expected symbols and execution flows.
- For full context on a symbol (callers, callees, execution flows): \`gitnexus_context({name: "symbolName"})\`.

## When Debugging

1. \`gitnexus_query({query: "<error or symptom>"})\` — find execution flows related to the issue
2. \`gitnexus_context({name: "<suspect function>"})\` — see all callers, callees, and process participation
3. \`gitnexus_impact({target: "<function>", direction: "upstream"})\` — trace what triggered it

## When Refactoring

- **Renaming:** MUST use \`gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})\` first. Review the preview, then run with \`dry_run: false\`.
- **Extracting/Splitting:** MUST run \`gitnexus_context({name: "target"})\` then \`gitnexus_impact({target: "target", direction: "upstream"})\` before moving code.
- After any refactor: run \`gitnexus_detect_changes({scope: "all"})\` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running \`gitnexus_impact\` on it.
- NEVER ignore HIGH or CRITICAL risk warnings.
- NEVER rename symbols with find-and-replace — use \`gitnexus_rename\` which understands the call graph.
- NEVER commit without running \`gitnexus_detect_changes()\` to confirm scope.

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Self-Check Before Finishing

Before completing any code modification task:
1. \`gitnexus_impact\` was run for all modified symbols
2. No HIGH/CRITICAL warnings were ignored
3. \`gitnexus_detect_changes()\` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated
`;
}
