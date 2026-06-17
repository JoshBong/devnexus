import fs from 'fs';
import path from 'path';
import {
  readVaultFile,
  readIndexJson,
  splitSections,
  lastEntries,
  findSection,
  listMarkdown,
} from './vault.js';
import {
  DECISIONS_DIR,
  PRACTICES_DIR,
  HANDOFFS_DIR,
  NODE_INDEX_FILE,
  DEFAULT_VAULT_SYNC,
} from '../constants.js';
import { syncedWrite, syncRead } from '../lib/vault-sync.js';
import { gitHeadInfo } from '../lib/git.js';
import { explainSymbol } from '../lib/why.js';

// --- helpers ---------------------------------------------------------------

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function noWorkspace() {
  return text(
    'No devnexus workspace found. The MCP server resolves the workspace from the ' +
    'launch directory (or DEVNEXUS_WORKSPACE / --workspace). Run `devnexus init` ' +
    'first, or launch the server from inside a workspace.'
  );
}

function syncMode(ctx) {
  return ctx.config.vaultSync || DEFAULT_VAULT_SYNC;
}

// Anchor a decision to code: explicit `commits` override, else the current HEAD
// of each configured repo at decision time ("repo@sha").
function captureCommits(ctx, override) {
  if (Array.isArray(override) && override.length) return override.map(String);
  const out = [];
  for (const repo of ctx.config.repos || []) {
    const info = gitHeadInfo(path.join(ctx.workspaceDir, repo));
    if (info) out.push(`${repo}@${info.sha}`);
  }
  return out;
}

// Turn a syncedWrite result into a human-readable trailer for the tool output.
function syncNote(res) {
  if (res.synced) return '\n\n_Synced: committed + pushed to the vault remote._';
  if (res.conflict) return `\n\n_⚠ ${res.note}. Resolve the vault conflict, then it will sync._`;
  if (res.committed) return `\n\n_${res.note}${res.pending ? ` (${res.pending} commit(s) pending push)` : ''}._`;
  return res.note ? `\n\n_${res.note}._` : '';
}

// Score a chunk against query terms (simple term-frequency, heading-weighted).
function scoreChunk(chunk, terms) {
  const hay = chunk.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!t) continue;
    const matches = hay.split(t).length - 1;
    score += matches;
  }
  return score;
}

// --- tools -----------------------------------------------------------------

/**
 * vault_context — the hot bundle an agent should read at session start.
 * MOC + API_CONTRACTS (exact) + last 3 session-log entries + open handoffs
 * + available practice areas. One call replaces "remember to read five files".
 */
async function vaultContext(ctx) {
  if (!ctx) return noWorkspace();
  const { vaultDir, config } = ctx;

  // Session start is the natural moment to pull the latest shared brain.
  await syncRead(vaultDir, { sync: syncMode(ctx) });

  const parts = [];

  parts.push(`# devnexus vault context — ${config.projectName || config.vaultName}`);
  parts.push('');

  const moc = readVaultFile(vaultDir, 'MOC.md');
  if (moc) parts.push(moc.trim());

  const contracts = readVaultFile(vaultDir, 'API_CONTRACTS.md');
  if (contracts) {
    parts.push('\n---\n');
    parts.push(contracts.trim());
  }

  const sessionLog = readVaultFile(vaultDir, 'SESSION_LOG.md');
  const recent = lastEntries(sessionLog, 3);
  if (recent.length) {
    parts.push('\n---\n');
    parts.push('## Recent sessions (last 3)\n');
    parts.push(recent.join('\n\n'));
  }

  const handoffs = listMarkdown(vaultDir, HANDOFFS_DIR)
    .filter(f => !/readme/i.test(f));
  if (handoffs.length) {
    parts.push('\n---\n');
    parts.push('## Open handoffs\n');
    for (const h of handoffs) parts.push(readVaultFile(vaultDir, h).trim());
  }

  const areas = listMarkdown(vaultDir, PRACTICES_DIR)
    .filter(f => !/readme/i.test(f))
    .map(f => path.basename(f, '.md'));
  if (areas.length) {
    parts.push('\n---\n');
    parts.push(
      `## Code practices available\n\nCall \`practices({ area })\` before writing code in: ${areas.join(', ')}.`
    );
  }

  parts.push(
    '\n---\n\n_For the live code graph (callers, blast radius, safe renames) use the ' +
    'GitNexus MCP. For structural analysis use `god_nodes` / `communities`._'
  );

  return text(parts.join('\n'));
}

/**
 * search_vault — header-chunked search across the cold layer
 * (decisions history, architecture, graph report, nodes, archive, practices).
 * grep-first ranking; returns top chunks with file:heading refs.
 */
function searchVault(ctx, args) {
  if (!ctx) return noWorkspace();
  const { vaultDir } = ctx;
  const query = (args?.query || '').trim();
  if (!query) return text('Provide a `query`.');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.min(Math.max(args?.limit || 8, 1), 25);

  const files = new Set([
    'DECISIONS.md',
    'ARCHITECTURE_OVERVIEW.md',
    'GRAPH_REPORT.md',
    NODE_INDEX_FILE,
    ...listMarkdown(vaultDir, DECISIONS_DIR),
    ...listMarkdown(vaultDir, 'nodes'),
    ...listMarkdown(vaultDir, 'archive'),
    ...listMarkdown(vaultDir, PRACTICES_DIR),
  ]);

  const hits = [];
  for (const rel of files) {
    const md = readVaultFile(vaultDir, rel);
    if (!md) continue;
    for (const section of splitSections(md)) {
      const score = scoreChunk(section.raw, terms);
      if (score > 0) {
        hits.push({ rel, heading: section.heading || '(top)', score, raw: section.raw });
      }
    }
  }

  if (hits.length === 0) {
    return text(`No matches for "${query}" in the vault.`);
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);

  const out = [`# ${hits.length} match(es) for "${query}" — showing top ${top.length}\n`];
  for (const h of top) {
    const snippet = h.raw.length > 1200 ? h.raw.slice(0, 1200) + '\n…' : h.raw;
    out.push(`## ${h.rel} › ${h.heading}\n\n${snippet}\n`);
  }
  return text(out.join('\n'));
}

/**
 * get_contract — return API_CONTRACTS.md, or a single named section.
 * Always exact (never fuzzy/RAG) — contracts must be seen verbatim.
 */
function getContract(ctx, args) {
  if (!ctx) return noWorkspace();
  const md = readVaultFile(ctx.vaultDir, 'API_CONTRACTS.md');
  if (!md) return text('No API_CONTRACTS.md in this vault yet.');

  const name = (args?.name || '').trim();
  if (!name) return text(md.trim());

  const section = findSection(md, name);
  if (!section) {
    const headings = splitSections(md).filter(s => s.heading).map(s => s.heading);
    return text(
      `No contract section matching "${name}". Available sections:\n` +
      headings.map(h => `- ${h}`).join('\n')
    );
  }
  return text(section);
}

/**
 * log_decision — persist a decision to the vault.
 *   scope: 'project' -> append to DECISIONS.md
 *   scope: 'symbol'  -> atomic file in decisions/YYYY-MM-DD-slug.md
 */
async function logDecision(ctx, args) {
  if (!ctx) return noWorkspace();
  const { vaultDir } = ctx;
  const title = (args?.title || '').trim();
  const body = (args?.body || '').trim();
  if (!title || !body) return text('Provide both `title` and `body`.');

  const scope = args?.scope === 'symbol' ? 'symbol' : 'project';
  const author = (args?.author || ctx.config.author || 'agent').trim();
  const date = today();
  const commits = captureCommits(ctx, args?.commits); // code state behind the decision

  if (scope === 'project') {
    // writeFn re-reads nothing — it appends to whatever DECISIONS.md is current
    // after the pre-write pull, so it is safe to replay on a sync retry.
    const codeLine = commits.length ? `\n_Code state: ${commits.join(', ')}_\n` : '';
    const res = await syncedWrite(vaultDir, { message: `decision: ${title}`, sync: syncMode(ctx) }, () => {
      const file = path.join(vaultDir, 'DECISIONS.md');
      fs.appendFileSync(file, `\n\n## ${date} — ${title} (by ${author})\n\n${body}\n${codeLine}`);
      return ['DECISIONS.md'];
    });
    return text(`Logged project decision:\n## ${date} — ${title}` + syncNote(res));
  }

  // symbol-scoped atomic decision — unique filename (suffix on collision)
  const refs = Array.isArray(args?.refs) ? args.refs : [];
  const refsLine = refs.map(r => `[[${r}]]`).join(', ');
  const md =
    `# ${title}\n\n` +
    `Date: ${date}\n` +
    `Author: ${author}\n` +
    `Status: ACTIVE\n` +
    `Refs: ${refsLine}\n` +
    `Commits: ${commits.join(', ')}\n` +
    `Depends:\n\n---\n\n${body}\n`;

  let relPath;
  const res = await syncedWrite(vaultDir, { message: `decision: ${title}`, sync: syncMode(ctx) }, () => {
    const dir = path.join(vaultDir, DECISIONS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const base = `${date}-${slugify(title)}`;
    let filename = `${base}.md`;
    let n = 2;
    while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.md`;
    fs.writeFileSync(path.join(dir, filename), md);
    relPath = path.posix.join(DECISIONS_DIR, filename);
    return [relPath];
  });
  return text(
    `Logged symbol decision to ${relPath}` +
    (refs.length ? ` (refs: ${refs.join(', ')}).` : '.') +
    `\nRun \`devnexus index\` to link it into the code graph.` +
    syncNote(res)
  );
}

/**
 * log_handoff — write a structured session handoff so the next agent/engineer
 * picks up with full context. Appends to SESSION_LOG.md.
 */
async function logHandoff(ctx, args) {
  if (!ctx) return noWorkspace();
  const { vaultDir } = ctx;
  const summary = (args?.summary || '').trim();
  if (!summary) return text('Provide a `summary`.');

  const author = (args?.author || ctx.config.author || 'agent').trim();
  const date = today();
  const branch = (args?.branch || '').trim();
  const done = (args?.done || '').trim();
  const next = (args?.next || '').trim();
  const to = (args?.to || '').trim();

  let entry = `\n\n## ${date} — ${summary} (by ${author})\n`;
  if (branch) entry += `\n**Branch:** ${branch}`;
  if (to) entry += `\n**For:** ${to}`;
  if (done) entry += `\n**Done:** ${done}`;
  if (next) entry += `\n**Next:** ${next}`;
  entry += '\n';

  const res = await syncedWrite(vaultDir, { message: `handoff: ${summary}`, sync: syncMode(ctx) }, () => {
    const file = path.join(vaultDir, 'SESSION_LOG.md');
    if (!fs.existsSync(file)) fs.writeFileSync(file, '# Session Log\n');
    fs.appendFileSync(file, entry);
    return ['SESSION_LOG.md'];
  });
  return text(`Handoff logged to SESSION_LOG.md:\n## ${date} — ${summary}` + syncNote(res));
}

/**
 * god_nodes — high-betweenness symbols devnexus computed from the graph.
 * Reads the already-built vault index (no live GitNexus call needed).
 */
function godNodes(ctx) {
  if (!ctx) return noWorkspace();
  const { vaultDir, config } = ctx;

  // Prefer the structured index; fall back to scraping markdown.
  const idx = readIndexJson(vaultDir);
  if (idx?.godNodes?.length) {
    const c = idx.corpus || {};
    const out = [
      `**Index:** ${c.symbols} symbols · ${c.communities} communities · ${c.godNodes} god nodes · ${c.bridges} bridges · ${c.gaps} gaps\n`,
      '## God Nodes (by betweenness centrality)\n',
      '> High BC = bottleneck. Many shortest paths route through this node. Audit before editing.\n',
      '| Symbol | BC | Edges | Cross-Community | File | Repo |',
      '|--------|----|-------|-----------------|------|------|',
      ...idx.godNodes.map(g => `| **${g.name}** | ${g.bc} | ${g.edges} | ${g.crossCommunities} | \`${g.file || ''}\` | ${g.repo} |`),
      '\n_Before editing any of these, run `gitnexus_impact` for live blast radius._',
    ];
    return text(out.join('\n'));
  }

  const report = readVaultFile(vaultDir, 'GRAPH_REPORT.md');
  const nodeIndex = readVaultFile(vaultDir, NODE_INDEX_FILE);
  if (!report && !nodeIndex) {
    return text(
      'No code graph yet. Run `devnexus index` (after `gitnexus analyze` on each repo) ' +
      'to compute god nodes and communities.'
    );
  }

  const out = [];
  if (config.indexStats) {
    const s = config.indexStats;
    out.push(
      `**Index:** ${s.symbols} symbols · ${s.communities} communities · ` +
      `${s.godNodes} god nodes · ${s.bridges} bridges · ${s.gaps} gaps\n`
    );
  }

  const section = findSection(report, 'god node') || findSection(nodeIndex, 'god node');
  if (section) {
    out.push(section);
  } else {
    out.push('No god-node section found in the index. Re-run `devnexus index`.');
  }
  out.push(
    '\n_Before editing any of these, run `gitnexus_impact` for live blast radius._'
  );
  return text(out.join('\n'));
}

/**
 * communities — functional clusters devnexus computed from the graph,
 * with their hub nodes. Reads the built vault index.
 */
function communities(ctx) {
  if (!ctx) return noWorkspace();
  const { vaultDir } = ctx;

  // Prefer the structured index; fall back to NODE_INDEX.md / _COMMUNITY files.
  const idx = readIndexJson(vaultDir);
  if (idx?.communities?.length) {
    const out = [
      '# Communities\n',
      '| Community | Symbols | Hubs | Cohesion | Repo |',
      '|-----------|---------|------|----------|------|',
      ...idx.communities.map(c => `| ${c.name} | ${c.size} | ${c.hubs.join(', ')} | ${c.cohesion} | ${c.repo} |`),
    ];
    return text(out.join('\n'));
  }

  const nodeIndex = readVaultFile(vaultDir, NODE_INDEX_FILE);
  if (!nodeIndex) {
    return text('No NODE_INDEX.md yet. Run `devnexus index` to generate the code graph.');
  }

  // Prefer the communities section of NODE_INDEX; fall back to listing _COMMUNITY files.
  const section = findSection(nodeIndex, 'communit');
  if (section) return text(section);

  const community = listMarkdown(vaultDir, 'nodes').filter(f => /_COMMUNITY\.md$/.test(f));
  if (community.length) {
    const out = ['# Communities\n'];
    for (const rel of community) {
      const md = readVaultFile(vaultDir, rel);
      const first = splitSections(md)[0];
      out.push(`- **${path.basename(path.dirname(rel))}** — ${first?.heading || rel}`);
    }
    return text(out.join('\n'));
  }
  return text('No communities found. Run `devnexus index`.');
}

/**
 * practices — team/project code conventions, surfaced before the agent writes.
 * No area -> list available areas. With area -> return practices/<area>.md.
 */
function practices(ctx, args) {
  if (!ctx) return noWorkspace();
  const { vaultDir } = ctx;
  const dir = path.join(vaultDir, PRACTICES_DIR);

  const areas = listMarkdown(vaultDir, PRACTICES_DIR)
    .filter(f => !/readme/i.test(f))
    .map(f => path.basename(f, '.md'));

  const area = (args?.area || '').trim().toLowerCase();
  if (!area) {
    if (!areas.length) {
      return text(
        `No practice files yet. Add markdown to ${PRACTICES_DIR}/ ` +
        `(e.g. ${PRACTICES_DIR}/frontend.md) and they become callable by area.`
      );
    }
    return text(`Available practice areas: ${areas.join(', ')}.\nCall \`practices({ area })\`.`);
  }

  const file = path.join(dir, `${area}.md`);
  if (!fs.existsSync(file)) {
    return text(
      `No practices for "${area}".` +
      (areas.length ? ` Available: ${areas.join(', ')}.` : ` Add ${PRACTICES_DIR}/${area}.md.`)
    );
  }
  return text(fs.readFileSync(file, 'utf-8').trim());
}

/**
 * why — the provenance of a symbol: the decisions behind it (and the commits
 * they were recorded against) plus its identity/risk. devnexus owns the "why";
 * for live callers/blast radius, defer to GitNexus.
 */
function why(ctx, args) {
  if (!ctx) return noWorkspace();
  const symbol = (args?.symbol || '').trim();
  if (!symbol) return text('Provide a `symbol`.');

  const r = explainSymbol(ctx.vaultDir, symbol);
  const out = [`# Why: ${symbol}\n`];

  if (r.found) {
    out.push(`\`${r.file || '?'}\`${r.community ? ` · in ${r.community}` : ''}`);
    if (r.isGod) out.push('> [!warning] God node — changes ripple widely.');
  } else if (r.indexed) {
    out.push(`_Not found in the current index — check the name or re-run \`devnexus index\`._`);
  } else {
    out.push(`_No code graph yet — run \`devnexus index\` for identity/risk context._`);
  }

  if (r.decisions.length) {
    out.push(`\n## Decisions (${r.decisions.length})\n`);
    for (const d of r.decisions) {
      out.push(`### ${d.title}  ·  ${d.date} · ${d.author} · ${d.status}`);
      if (d.commits.length) out.push(`Commits: ${d.commits.join(', ')}`);
      const snippet = (d.body || '').split('\n').filter(Boolean).slice(0, 3).join('\n');
      if (snippet) out.push(`\n${snippet}`);
      out.push(`\n→ ${d.file}\n`);
    }
  } else {
    out.push(`\n_No decisions logged for \`${symbol}\` yet. Capture one with \`log_decision({ scope: "symbol", refs: ["${symbol}"] })\` so the next person (or agent) knows why._`);
  }

  out.push('\n_For live callers and blast radius, use `gitnexus_impact`._');
  return text(out.join('\n'));
}

// --- registry --------------------------------------------------------------

export const TOOLS = [
  {
    name: 'vault_context',
    description:
      'Read FIRST every session. Returns the hot vault bundle: map of content, API ' +
      'contracts (verbatim), the last 3 session handoffs, open handoffs, and available ' +
      'code-practice areas. Replaces manually opening five vault files.',
    inputSchema: { type: 'object', properties: {} },
    handler: vaultContext,
  },
  {
    name: 'search_vault',
    description:
      'Search the cold knowledge layer (decision history, architecture, graph report, ' +
      'node files, archive, practices). Header-chunked, ranked. Use before proposing ' +
      'architectural changes to see what was already decided.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        limit: { type: 'number', description: 'Max chunks to return (1-25, default 8).' },
      },
      required: ['query'],
    },
    handler: searchVault,
  },
  {
    name: 'get_contract',
    description:
      'Return API contracts verbatim (never summarized). No name -> whole file. ' +
      'With a name -> the matching endpoint/section. Contracts are the final authority.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional endpoint/section to fetch.' },
      },
    },
    handler: getContract,
  },
  {
    name: 'log_decision',
    description:
      'Persist a decision to the vault. scope="project" appends to DECISIONS.md; ' +
      'scope="symbol" writes an atomic decisions/ file with symbol refs. Log decisions ' +
      'as they happen, not just at session end.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'What was considered and why.' },
        scope: { type: 'string', enum: ['project', 'symbol'], description: 'Default project.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'Symbol names (symbol scope).' },
        commits: { type: 'array', items: { type: 'string' }, description: 'Optional commit refs this decision produced (e.g. "repo@sha"). Defaults to current repo HEADs.' },
        author: { type: 'string' },
      },
      required: ['title', 'body'],
    },
    handler: logDecision,
  },
  {
    name: 'log_handoff',
    description:
      'Write a structured session handoff to SESSION_LOG.md so the next agent/engineer ' +
      'picks up with full context (branch, what is done, what is next).',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        branch: { type: 'string' },
        done: { type: 'string' },
        next: { type: 'string' },
        to: { type: 'string', description: 'Who the handoff is for.' },
        author: { type: 'string' },
      },
      required: ['summary'],
    },
    handler: logHandoff,
  },
  {
    name: 'god_nodes',
    description:
      'High-betweenness symbols (bridges across communities) devnexus computed from the ' +
      'code graph. Read before touching shared structures — a change ripples further than ' +
      'it looks. Pairs with gitnexus_impact for live blast radius.',
    inputSchema: { type: 'object', properties: {} },
    handler: godNodes,
  },
  {
    name: 'communities',
    description:
      'Functional clusters devnexus detected in the codebase, with their hub nodes. ' +
      'Use to orient in unfamiliar code or to scope which areas a refactor touches.',
    inputSchema: { type: 'object', properties: {} },
    handler: communities,
  },
  {
    name: 'practices',
    description:
      'Project/team code conventions. No area -> list available areas. With an area ' +
      '(e.g. "frontend", "auth", "java") -> return those practices. Call before writing ' +
      'code in an area so you follow the conventions up front, not after review.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Practice area, e.g. frontend, auth, java.' },
      },
    },
    handler: practices,
  },
  {
    name: 'why',
    description:
      'Explain WHY a symbol exists: the decisions behind it (and the commits they were ' +
      'recorded against) plus its identity and risk. Call before changing or removing a ' +
      'symbol whose purpose is unclear. For live callers/blast radius, use GitNexus.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name (function/class/type).' },
      },
      required: ['symbol'],
    },
    handler: why,
  },
];
