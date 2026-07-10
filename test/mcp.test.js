import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { TOOLS } from '../src/mcp/tools.js';
import { resolveWorkspace, splitSections, lastEntries, findSection } from '../src/mcp/vault.js';
import { writeMcpConfig } from '../src/lib/mcp-config.js';

function tool(name) {
  return TOOLS.find(t => t.name === name).handler;
}
function textOf(result) {
  return result.content.map(c => c.text).join('\n');
}

// Build a throwaway workspace fixture and return its resolved ctx.
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devnexus-mcp-'));
  const vaultName = 'demo-vault';
  const vaultDir = path.join(root, vaultName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'practices'), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'handoffs'), { recursive: true });

  fs.writeFileSync(path.join(root, '.workspace-config'),
    JSON.stringify({ version: '2.0', projectName: 'demo', vaultName, author: 'Tester', repos: [], agents: ['claude'] }));

  fs.writeFileSync(path.join(vaultDir, 'MOC.md'), '# Map of Content — demo\n\nEntry point.\n');
  fs.writeFileSync(path.join(vaultDir, 'API_CONTRACTS.md'),
    '# API Contracts\n\n## Endpoints\n\n### POST /api/users\nCreates a user.\n\n### GET /api/health\nLiveness check.\n');
  fs.writeFileSync(path.join(vaultDir, 'SESSION_LOG.md'),
    '# Session Log\n\n## 2026-01-01 — first (by A)\nDid one thing.\n\n## 2026-01-02 — second (by B)\nDid another.\n\n## 2026-01-03 — third (by C)\nAnd a third.\n\n## 2026-01-04 — fourth (by D)\nMost recent.\n');
  fs.writeFileSync(path.join(vaultDir, 'DECISIONS.md'),
    '# Decisions\n\n## 2026-01-01 — Chose Postgres (by A)\nRejected Mongo because relations matter.\n');
  fs.writeFileSync(path.join(vaultDir, 'practices', 'frontend.md'),
    '# Frontend Practices\n\n## Do\n- Validate inputs at the boundary.\n');

  const ctx = resolveWorkspace(root);
  return { root, vaultDir, ctx };
}

test('resolveWorkspace finds config from a nested dir', () => {
  const { root, ctx } = makeWorkspace();
  const nested = path.join(root, 'demo-vault', 'decisions');
  const fromNested = resolveWorkspace(nested);
  assert.equal(fromNested.workspaceDir, ctx.workspaceDir);
  assert.equal(fromNested.config.vaultName, 'demo-vault');
});

test('splitSections / lastEntries chunk markdown by heading', () => {
  const md = '# Top\n\nintro\n\n## A\nbody a\n\n## B\nbody b\n';
  const secs = splitSections(md);
  assert.ok(secs.find(s => s.heading === 'A'));
  const last = lastEntries(md, 1);
  assert.equal(last.length, 1);
  assert.match(last[0], /## B/);
});

test('vault_context bundles MOC + contracts + last 3 sessions + practices', async () => {
  const { ctx } = makeWorkspace();
  const out = textOf(await tool('vault_context')(ctx));
  assert.match(out, /Map of Content/);
  assert.match(out, /API Contracts/);
  assert.match(out, /Recent sessions/);
  // only last 3 of 4 entries
  assert.ok(!out.includes('first (by A)'));
  assert.match(out, /fourth \(by D\)/);
  assert.match(out, /frontend/);
});

test('search_vault ranks chunks and returns file:heading refs', () => {
  const { ctx } = makeWorkspace();
  const out = textOf(tool('search_vault')(ctx, { query: 'Postgres Mongo relations' }));
  assert.match(out, /DECISIONS\.md/);
  assert.match(out, /Chose Postgres/);
});

test('get_contract returns whole file or a named section, exact', () => {
  const { ctx } = makeWorkspace();
  const whole = textOf(tool('get_contract')(ctx, {}));
  assert.match(whole, /POST \/api\/users/);
  assert.match(whole, /GET \/api\/health/);

  const one = textOf(tool('get_contract')(ctx, { name: 'health' }));
  assert.match(one, /GET \/api\/health/);
  assert.ok(!one.includes('POST /api/users'));

  // a PARENT section must include its subsections, not truncate at the first ###
  const parent = textOf(tool('get_contract')(ctx, { name: 'Endpoints' }));
  assert.match(parent, /POST \/api\/users/);
  assert.match(parent, /GET \/api\/health/);
});

test('splitSections/findSection ignore headings inside code fences', () => {
  const md = [
    '## Setup', '',
    'Run this:', '',
    '```bash', '# not a heading', 'npm install', '```', '',
    'Done.', '',
    '## Next', 'unrelated',
  ].join('\n');
  const got = findSection(md, 'Setup');
  assert.match(got, /npm install/);
  assert.match(got, /# not a heading/); // the fenced comment stayed inside Setup
  assert.ok(!got.includes('unrelated')); // did not bleed into the next real section
});

test('log_decision (project) appends to DECISIONS.md', async () => {
  const { vaultDir, ctx } = makeWorkspace();
  const out = textOf(await tool('log_decision')(ctx, { title: 'Use stdio MCP', body: 'Simplest local transport.', scope: 'project' }));
  assert.match(out, /Logged project decision/);
  const file = fs.readFileSync(path.join(vaultDir, 'DECISIONS.md'), 'utf-8');
  assert.match(file, /Use stdio MCP/);
  assert.match(file, /Simplest local transport/);
});

test('log_decision (symbol) writes an atomic file with refs', async () => {
  const { vaultDir, ctx } = makeWorkspace();
  const out = textOf(await tool('log_decision')(ctx, {
    title: 'Resolve workspace by walking up',
    body: 'cwd-based resolution works across agents.',
    scope: 'symbol',
    refs: ['resolveWorkspace', 'buildContext'],
  }));
  assert.match(out, /decisions\//);
  const files = fs.readdirSync(path.join(vaultDir, 'decisions'));
  const written = files.find(f => f.includes('resolve-workspace-by-walking-up'));
  assert.ok(written, 'atomic decision file created');
  const content = fs.readFileSync(path.join(vaultDir, 'decisions', written), 'utf-8');
  assert.match(content, /\[\[resolveWorkspace\]\], \[\[buildContext\]\]/);
  assert.match(content, /Status: ACTIVE/);
});

test('log_handoff appends a structured block to SESSION_LOG.md', async () => {
  const { vaultDir, ctx } = makeWorkspace();
  textOf(await tool('log_handoff')(ctx, { summary: 'MCP server landed', branch: 'feat/mcp', done: 'tools', next: 'docs' }));
  const file = fs.readFileSync(path.join(vaultDir, 'SESSION_LOG.md'), 'utf-8');
  assert.match(file, /MCP server landed/);
  assert.match(file, /\*\*Branch:\*\* feat\/mcp/);
  assert.match(file, /\*\*Next:\*\* docs/);
});

test('practices lists areas and returns a named area', () => {
  const { ctx } = makeWorkspace();
  const list = textOf(tool('practices')(ctx, {}));
  assert.match(list, /frontend/);
  const fe = textOf(tool('practices')(ctx, { area: 'frontend' }));
  assert.match(fe, /Validate inputs at the boundary/);
  const missing = textOf(tool('practices')(ctx, { area: 'rust' }));
  assert.match(missing, /No practices for "rust"/);
});

test('why/god_nodes/communities degrade gracefully on a partial NODE_INDEX.json', async () => {
  const { vaultDir, ctx } = makeWorkspace();
  // valid JSON, but missing godNodes/symbols/communities arrays (older or partial build)
  fs.writeFileSync(path.join(vaultDir, 'NODE_INDEX.json'), JSON.stringify({ schemaVersion: 1 }));
  const w = textOf(await tool('why')(ctx, { symbol: 'anything' }));
  assert.match(w, /anything/); // answered, did not throw
  // present-but-EMPTY arrays are authoritative — no fallback to stale markdown
  fs.writeFileSync(path.join(vaultDir, 'NODE_INDEX.json'),
    JSON.stringify({ schemaVersion: 1, godNodes: [], communities: [] }));
  fs.writeFileSync(path.join(vaultDir, 'GRAPH_REPORT.md'), '## God Nodes\n| stale | table |\n');
  const g = textOf(tool('god_nodes')(ctx));
  assert.match(g, /No god nodes in the current index/);
  assert.ok(!g.includes('stale'));
  const c = textOf(tool('communities')(ctx));
  assert.match(c, /No communities in the current index/);
});

test('practices refuses a path-traversal area (no reading .md outside the vault)', () => {
  const { root, vaultDir, ctx } = makeWorkspace();
  // a secret .md sitting above the vault, reachable only via ../
  fs.writeFileSync(path.join(root, 'secret.md'), 'TOP SECRET CONTENTS');
  const depth = path.relative(path.join(vaultDir, 'practices'), root).split(path.sep).length;
  const escape = `${'../'.repeat(depth + 2)}secret`;
  const out = textOf(tool('practices')(ctx, { area: escape }));
  assert.match(out, /Invalid practice area/);
  assert.ok(!out.includes('TOP SECRET'), 'must not leak the out-of-vault file');
});

test('god_nodes & communities read NODE_INDEX.json when present', () => {
  const { vaultDir, ctx } = makeWorkspace();
  fs.writeFileSync(path.join(vaultDir, 'NODE_INDEX.json'), JSON.stringify({
    schemaVersion: 1,
    corpus: { symbols: 3, communities: 1, godNodes: 1, bridges: 0, gaps: 0, repos: ['r'] },
    godNodes: [{ name: 'runInit', repo: 'r', file: 'src/init.js', edges: 36, crossCommunities: 7, bc: 0.005, community: 'lib' }],
    communities: [{ id: '1', name: 'lib', repo: 'r', size: 3, cohesion: 0.7, hubs: ['runInit', 'runJoin'] }],
    bridges: [], gaps: [], symbols: [], decisions: [],
  }));
  const gn = textOf(tool('god_nodes')(ctx));
  assert.match(gn, /runInit/);
  assert.match(gn, /0\.005/);
  const cm = textOf(tool('communities')(ctx));
  assert.match(cm, /\blib\b/);
  assert.match(cm, /runInit, runJoin/);
});

test('tools degrade gracefully with no workspace', async () => {
  const out = textOf(await tool('vault_context')(null));
  assert.match(out, /No devnexus workspace/);
});

test('writeMcpConfig writes project-scoped JSON for claude + cursor and merges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devnexus-cfg-'));
  const res = writeMcpConfig(root, ['claude', 'cursor']);
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8'));
  assert.deepEqual(claude.mcpServers.devnexus, { command: 'devnexus', args: ['mcp'] });
  const cursor = JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'mcp.json'), 'utf-8'));
  assert.ok(cursor.mcpServers.devnexus);
  assert.ok(res.written.find(w => w.agent === 'claude'));

  // merge: pre-existing server is preserved
  fs.writeFileSync(path.join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  writeMcpConfig(root, ['claude']);
  const merged = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8'));
  assert.ok(merged.mcpServers.other, 'existing server preserved');
  assert.ok(merged.mcpServers.devnexus, 'devnexus added alongside');
});
