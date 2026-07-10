import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { readDecisions, decisionsForSymbol } from '../src/lib/decisions.js';
import { explainSymbol } from '../src/lib/why.js';
import { TOOLS } from '../src/mcp/tools.js';
import { resolveWorkspace } from '../src/mcp/vault.js';

const tool = (n) => TOOLS.find(t => t.name === n).handler;
const textOf = (r) => r.content.map(c => c.text).join('\n');

function makeVault(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'why-'));
  const vaultName = 'v';
  const vaultDir = path.join(root, vaultName);
  fs.mkdirSync(path.join(vaultDir, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, '.workspace-config'),
    JSON.stringify({ version: '2.0', projectName: 'p', vaultName, author: 'Tester', repos: [], agents: ['claude'], vaultSync: 'off', ...extra }));
  return { root, vaultDir };
}

function writeDecision(vaultDir, name, body) {
  fs.writeFileSync(path.join(vaultDir, 'decisions', name), body);
}

function writeIndex(vaultDir, idx) {
  fs.writeFileSync(path.join(vaultDir, 'NODE_INDEX.json'), JSON.stringify(idx));
}

test('readDecisions parses refs, commits, status, body', () => {
  const { vaultDir } = makeVault();
  writeDecision(vaultDir, '2026-01-01-retry.md',
    '# Retry over websockets\n\nDate: 2026-01-01\nAuthor: A\nStatus: ACTIVE\nRefs: [[retryFetch]], [[Client]]\nCommits: app@abc1234, web@def5678\nDepends:\n\n---\n\nWebsockets were flaky under load, so we poll.\n');
  const ds = readDecisions(vaultDir);
  assert.equal(ds.length, 1);
  assert.deepEqual(ds[0].refs, ['retryFetch', 'Client']);
  assert.deepEqual(ds[0].commits, ['app@abc1234', 'web@def5678']);
  assert.equal(ds[0].status, 'ACTIVE');
  assert.match(ds[0].body, /Websockets were flaky/);
  assert.equal(decisionsForSymbol(vaultDir, 'retryFetch').length, 1);
  assert.equal(decisionsForSymbol(vaultDir, 'nope').length, 0);
});

test('explainSymbol surfaces identity, god status, and decisions', () => {
  const { vaultDir } = makeVault();
  writeIndex(vaultDir, {
    schemaVersion: 1, corpus: { symbols: 2 },
    godNodes: [{ name: 'runInit', repo: 'r', file: 'src/init.js', edges: 36, community: 'lib' }],
    communities: [], bridges: [], gaps: [],
    symbols: [{ name: 'runInit', repo: 'r', file: 'src/init.js', community: 'lib', edges: 36, bc: 0.01 },
              { name: 'helper', repo: 'r', file: 'src/util.js', community: 'lib', edges: 2, bc: 0 }],
    decisions: [],
  });
  writeDecision(vaultDir, '2026-01-02-init.md',
    '# Init flow\n\nDate: 2026-01-02\nAuthor: A\nStatus: ACTIVE\nRefs: [[runInit]]\nCommits: r@aaa1111\nDepends:\n\n---\n\nWhy init is shaped this way.\n');

  const god = explainSymbol(vaultDir, 'runInit');
  assert.equal(god.found, true);
  assert.equal(god.isGod, true);
  assert.equal(god.file, 'src/init.js');
  assert.equal(god.decisions.length, 1);
  assert.deepEqual(god.decisions[0].commits, ['r@aaa1111']);

  const plain = explainSymbol(vaultDir, 'helper');
  assert.equal(plain.found, true);
  assert.equal(plain.isGod, false);

  const ghost = explainSymbol(vaultDir, 'ghost');
  assert.equal(ghost.found, false);
  assert.equal(ghost.indexed, true);
});

test('explainSymbol reports no index gracefully', () => {
  const { vaultDir } = makeVault();
  const r = explainSymbol(vaultDir, 'whatever');
  assert.equal(r.indexed, false);
  assert.equal(r.found, false);
});

test('log_decision (symbol) captures repo HEADs as Commits', async () => {
  const { root, vaultDir } = makeVault();
  // a real git repo in the workspace with one commit
  const repo = path.join(root, 'app');
  fs.mkdirSync(repo);
  const git = (a) => execFileSync('git', a, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t.dev']); git(['config', 'user.name', 'T']); git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  git(['add', '-A']); git(['commit', '-q', '-m', 'first']);
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();

  // point the config at the repo
  fs.writeFileSync(path.join(root, '.workspace-config'),
    JSON.stringify({ version: '2.0', projectName: 'p', vaultName: 'v', author: 'T', repos: ['app'], agents: ['claude'], vaultSync: 'off' }));
  const ctx = resolveWorkspace(root);

  await tool('log_decision')(ctx, { title: 'Shape of app', body: 'because reasons', scope: 'symbol', refs: ['runApp'] });
  const file = fs.readdirSync(path.join(vaultDir, 'decisions')).find(f => f.includes('shape-of-app'));
  const content = fs.readFileSync(path.join(vaultDir, 'decisions', file), 'utf-8');
  assert.match(content, new RegExp(`Commits: app@${sha}`));
});

test('why tool renders decisions + commits + risk', () => {
  const { root, vaultDir } = makeVault();
  writeIndex(vaultDir, {
    schemaVersion: 1, corpus: {},
    godNodes: [{ name: 'runInit', repo: 'r', file: 'src/init.js', community: 'lib' }],
    communities: [], bridges: [], gaps: [], symbols: [], decisions: [],
  });
  writeDecision(vaultDir, '2026-01-03-x.md',
    '# Chose stdio\n\nDate: 2026-01-03\nAuthor: A\nStatus: ACTIVE\nRefs: [[runInit]]\nCommits: r@beef999\nDepends:\n\n---\n\nLocal and simple.\n');
  const ctx = resolveWorkspace(root);
  const out = textOf(tool('why')(ctx, { symbol: 'runInit' }));
  assert.match(out, /Why: runInit/);
  assert.match(out, /god node/i);
  assert.match(out, /Chose stdio/);
  assert.match(out, /r@beef999/);

  const none = textOf(tool('why')(ctx, { symbol: 'helper' }));
  assert.match(none, /No decisions logged/);
});
