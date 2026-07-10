import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Parse GitNexus cypher output.
 * Output format: JSON with { markdown: "| col1 | col2 |\n| --- | --- |\n| val1 | val2 |", row_count: N }
 * Cell values are either plain strings/numbers or JSON objects.
 */
function parseCypherOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (parsed.error) {
    throw new Error(`GitNexus cypher error: ${parsed.error}`);
  }

  if (!parsed.markdown || parsed.row_count === 0) return [];

  const lines = parsed.markdown.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // First line is headers
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  // Skip separator line (line 1)
  const rows = [];

  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const val = cells[j] || '';
      // Try parsing as JSON object
      if (val.startsWith('{')) {
        try { row[headers[j]] = JSON.parse(val); continue; } catch { /* fall through */ }
      }
      // Try parsing as number
      const num = Number(val);
      if (!isNaN(num) && val !== '') {
        row[headers[j]] = num;
        continue;
      }
      row[headers[j]] = val;
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Run a cypher query against a GitNexus-indexed repo.
 */
function cypher(repoName, query) {
  try {
    const raw = execSync(`npx gitnexus cypher -r ${repoName} "${query}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseCypherOutput(raw.trim());
  } catch (err) {
    if (err.stdout) {
      const output = err.stdout.toString().trim();
      if (output) return parseCypherOutput(output);
    }
    return [];
  }
}

/**
 * Check if a repo has a GitNexus index.
 */
function hasIndex(repoDir) {
  return fs.existsSync(path.join(repoDir, '.gitnexus', 'meta.json'));
}

/**
 * Read GitNexus meta.json for a repo.
 */
function readMeta(repoDir) {
  const metaPath = path.join(repoDir, '.gitnexus', 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * Query all communities for a repo.
 * Returns: [{ id, label, cohesion, symbolCount }]
 */
// KuzuDB returns tied/unordered rows in scheduling-dependent order (multithreaded
// execution), so every query below pins a deterministic JS sort on its result. Without
// this the downstream index (god nodes, community names, symbol-file link lists) churns
// between identical runs — the root cause of the idempotency test flake. Sorting in JS
// (rather than trusting the cypher ORDER BY) is robust to the DB's tie handling.
function byId(a, b) { return String(a.id).localeCompare(String(b.id)); }

function queryCommunities(repoName) {
  const rows = cypher(repoName, 'MATCH (c:Community) RETURN c');
  return rows.map(r => {
    const c = r.c;
    return {
      id: c.id,
      label: c.label,
      heuristicLabel: c.heuristicLabel,
      cohesion: c.cohesion,
      symbolCount: c.symbolCount,
    };
  }).sort(byId);
}

/**
 * Query all symbols with their community membership.
 * Returns: [{ name, filePath, communityId, communityLabel }]
 */
function querySymbolMembership(repoName) {
  return cypher(repoName,
    'MATCH (s)-[r]->(c:Community) RETURN s.name, s.filePath, c.id, c.label'
  ).map(r => ({
    name: r['s.name'],
    filePath: r['s.filePath'],
    communityId: r['c.id'],
    communityLabel: r['c.label'],
  })).sort((a, b) =>
    String(a.name).localeCompare(String(b.name)) ||
    String(a.filePath).localeCompare(String(b.filePath)) ||
    String(a.communityId).localeCompare(String(b.communityId)));
}

/**
 * Query all symbols with their total edge count, sorted descending.
 * Returns: [{ name, filePath, edges }]
 */
function querySymbolEdges(repoName) {
  return cypher(repoName,
    "MATCH (s)-[r]-(other) WHERE labels(s) IN ['Function','Method','Class','Constructor','Interface','Enum','Record'] RETURN s.name, s.filePath, COUNT(r) AS edges ORDER BY edges DESC"
  ).map(r => ({
    name: r['s.name'],
    filePath: r['s.filePath'],
    edges: r['edges'],
  })).sort((a, b) =>
    (Number(b.edges) - Number(a.edges)) ||
    String(a.name).localeCompare(String(b.name)) ||
    String(a.filePath).localeCompare(String(b.filePath)));
}

/**
 * Query cross-community edge counts per symbol.
 * Returns: [{ name, crossCommunities }]
 */
function queryCrossCommunityEdges(repoName) {
  return cypher(repoName,
    "MATCH (s)-[r]->(other) WHERE labels(s) IN ['Function','Method','Class','Constructor','Interface','Enum','Record'] AND r.type = 'CALLS' MATCH (s)-[m]->(c:Community) MATCH (other)-[m2]->(c2:Community) WHERE c.id <> c2.id RETURN s.name, COUNT(DISTINCT c2.id) AS cross_communities ORDER BY cross_communities DESC"
  ).map(r => ({
    name: r['s.name'],
    crossCommunities: r['cross_communities'],
  })).sort((a, b) =>
    (Number(b.crossCommunities) - Number(a.crossCommunities)) ||
    String(a.name).localeCompare(String(b.name)));
}

/**
 * Query call graph edges.
 * Returns: [{ caller, callee }]
 */
function queryCallEdges(repoName) {
  return cypher(repoName,
    'MATCH (a)-[r]->(b) WHERE r.type = \'CALLS\' RETURN a.name, b.name'
  ).map(r => ({
    caller: r['a.name'],
    callee: r['b.name'],
  })).sort((a, b) =>
    String(a.caller).localeCompare(String(b.caller)) ||
    String(a.callee).localeCompare(String(b.callee)));
}

/**
 * Query execution flows/processes.
 * Returns: [{ label, stepCount, processType }]
 */
function queryProcesses(repoName) {
  return cypher(repoName,
    'MATCH (p:Process) RETURN p.label, p.stepCount, p.processType'
  ).map(r => ({
    label: r['p.label'],
    stepCount: r['p.stepCount'],
    processType: r['p.processType'],
  }));
}

export {
  parseCypherOutput,
  cypher,
  hasIndex,
  readMeta,
  queryCommunities,
  querySymbolMembership,
  querySymbolEdges,
  queryCrossCommunityEdges,
  queryCallEdges,
  queryProcesses,
};
