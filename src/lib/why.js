import fs from 'fs';
import path from 'path';
import { NODE_INDEX_JSON_FILE } from '../constants.js';
import { decisionsForSymbol } from './decisions.js';

function readIndex(vaultDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultDir, NODE_INDEX_JSON_FILE), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Explain WHY a symbol exists: the decisions behind it (with the commits they
 * were recorded against) plus its identity/risk from the code graph.
 *
 * devnexus owns the "why"; for live callers/blast radius the caller defers to
 * GitNexus. Returns a structured result that the MCP tool and CLI both format.
 *
 * { symbol, found, file, community, isGod, edges, decisions, indexed }
 */
export function explainSymbol(vaultDir, symbol) {
  const idx = readIndex(vaultDir);
  const result = { symbol, found: false, file: null, community: null, isGod: false, edges: null, indexed: !!idx, decisions: [] };

  if (idx) {
    const god = idx.godNodes.find(g => g.name === symbol);
    const sym = god || idx.symbols.find(s => s.name === symbol);
    if (sym) {
      result.found = true;
      result.file = sym.file || null;
      result.community = sym.community || null;
      result.edges = sym.edges ?? null;
      result.isGod = !!god;
    }
  }

  result.decisions = decisionsForSymbol(vaultDir, symbol).map(d => ({
    title: d.title,
    date: d.date,
    author: d.author,
    status: d.status,
    commits: d.commits,
    file: `decisions/${d.filename}.md`,
    body: d.body,
  }));

  return result;
}
