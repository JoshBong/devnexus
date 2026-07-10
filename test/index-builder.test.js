import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildIndex } from '../src/lib/index-builder.js';
import { REPO_ROOT, SKIP_NO_GRAPH } from './helpers.js';

// These tests need a real GitNexus index to query against.
// devnexus itself is indexed, so we symlink it into a temp workspace.

const tmpDir = path.join(os.tmpdir(), `devnexus-test-${Date.now()}`);
const vaultDir = path.join(tmpDir, 'test-vault');
const repoLink = path.join(tmpDir, 'devnexus');

function setup() {
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(vaultDir, 'ARCHITECTURE_OVERVIEW.md'),
    '# Test\n\nContent.\n\n## Known Gaps\n\nNone.\n'
  );
  if (!fs.existsSync(repoLink)) {
    fs.symlinkSync(REPO_ROOT, repoLink);
  }
}

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

describe('buildIndex', { skip: SKIP_NO_GRAPH }, () => {
  before(setup);
  after(cleanup);

  it('returns correct stats', () => {
    const result = buildIndex(tmpDir, 'test-vault', ['devnexus']);
    assert.ok(result.totalSymbols > 0, 'should have symbols');
    assert.ok(result.communities > 0, 'should have communities');
    assert.ok(result.godNodes > 0, 'should have god nodes');
    assert.ok(result.godNodes <= 15, 'god nodes capped at 15');
  });

  it('creates NODE_INDEX.md (clean human map)', () => {
    const indexPath = path.join(vaultDir, 'NODE_INDEX.md');
    assert.ok(fs.existsSync(indexPath), 'NODE_INDEX.md should exist');
    const content = fs.readFileSync(indexPath, 'utf-8');
    assert.ok(content.includes('# Code Map'), 'should have title');
    assert.ok(content.includes('## God Nodes'), 'should keep god nodes heading (MCP fallback)');
    assert.ok(content.includes('## Communities'), 'should keep communities heading (MCP fallback)');
    assert.ok(!content.includes('## All Symbols'), 'should NOT dump every symbol');
    assert.ok(content.includes('connections'), 'god nodes in plain language');
  });

  it('creates nodes/ directory with community subdirs', () => {
    const nodesPath = path.join(vaultDir, 'nodes');
    assert.ok(fs.existsSync(nodesPath), 'nodes/ should exist');
    const dirs = fs.readdirSync(nodesPath).filter(
      f => fs.statSync(path.join(nodesPath, f)).isDirectory()
    );
    assert.ok(dirs.length > 0, 'should have community directories');
  });

  it('each community dir has _COMMUNITY.md', () => {
    const nodesPath = path.join(vaultDir, 'nodes');
    const dirs = fs.readdirSync(nodesPath).filter(
      f => fs.statSync(path.join(nodesPath, f)).isDirectory()
    );
    for (const dir of dirs) {
      const communityFile = path.join(nodesPath, dir, '_COMMUNITY.md');
      assert.ok(fs.existsSync(communityFile), `${dir}/_COMMUNITY.md should exist`);
      const content = fs.readFileSync(communityFile, 'utf-8');
      assert.ok(content.includes('## Start here'), `${dir} should have a "Start here" (hubs) section`);
      assert.ok(!content.includes('## All Symbols'), `${dir} should NOT dump every member`);
    }
  });

  it('community directories are uniquely named', () => {
    const nodesPath = path.join(vaultDir, 'nodes');
    const dirs = fs.readdirSync(nodesPath);
    const unique = new Set(dirs);
    assert.equal(dirs.length, unique.size, 'all directory names should be unique');
  });

  it('injects a static (branch-stable) pointer into ARCHITECTURE_OVERVIEW.md', () => {
    const archPath = path.join(vaultDir, 'ARCHITECTURE_OVERVIEW.md');
    const content = fs.readFileSync(archPath, 'utf-8');
    assert.ok(content.includes('<!-- devnexus:index:start -->'), 'should have start marker');
    assert.ok(content.includes('<!-- devnexus:index:end -->'), 'should have end marker');
    assert.ok(content.includes('## Code Graph Summary'), 'should have summary section');
    // The committed file must NOT embed branch-specific graph data — only a pointer.
    assert.ok(content.includes('regenerated locally per branch'), 'should be a static pointer');
    assert.ok(!content.includes('### God Nodes'), 'must not embed branch-specific god nodes');
  });

  it('creates NODE_INDEX.json with structured aggregates', () => {
    const jsonPath = path.join(vaultDir, 'NODE_INDEX.json');
    assert.ok(fs.existsSync(jsonPath), 'NODE_INDEX.json should exist');
    const idx = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    assert.equal(idx.schemaVersion, 1);
    assert.ok(idx.corpus.symbols > 0 && idx.corpus.communities > 0);
    assert.ok(Array.isArray(idx.godNodes) && idx.godNodes.length > 0);
    assert.ok(idx.godNodes[0].name && typeof idx.godNodes[0].bc === 'number');
    assert.ok(Array.isArray(idx.communities) && idx.communities[0].hubs.length > 0);
    assert.ok(Array.isArray(idx.symbols) && idx.symbols.length === idx.corpus.symbols);
    assert.ok(Array.isArray(idx.decisions), 'decisions array present');
  });

  it('preserves content before and after injection', () => {
    const archPath = path.join(vaultDir, 'ARCHITECTURE_OVERVIEW.md');
    const content = fs.readFileSync(archPath, 'utf-8');
    assert.ok(content.startsWith('# Test\n'), 'should preserve original header');
    assert.ok(content.includes('## Known Gaps'), 'should preserve Known Gaps section');
    assert.ok(content.includes('None.'), 'should preserve Known Gaps content');
  });

  it('is idempotent — rerun produces same output', () => {
    const archPath = path.join(vaultDir, 'ARCHITECTURE_OVERVIEW.md');
    const before = fs.readFileSync(archPath, 'utf-8');
    buildIndex(tmpDir, 'test-vault', ['devnexus']);
    const after = fs.readFileSync(archPath, 'utf-8');
    assert.equal(before, after, 'architecture file should be identical after rerun');

    // Also check only one set of markers
    const startCount = (after.match(/devnexus:index:start/g) || []).length;
    assert.equal(startCount, 1, 'should have exactly one start marker');
  });

  it('god nodes are sorted by betweenness centrality then cross-community', () => {
    // Assert against the structured source (NODE_INDEX.json), not the human markdown.
    const idx = JSON.parse(fs.readFileSync(path.join(vaultDir, 'NODE_INDEX.json'), 'utf-8'));
    const bcScores = idx.godNodes.map(g => g.bc);
    assert.ok(bcScores.length > 1, 'should have multiple god nodes');

    for (let i = 1; i < bcScores.length; i++) {
      assert.ok(bcScores[i] <= bcScores[i - 1] + 0.001,
        `god nodes should be sorted descending by BC: ${bcScores[i]} > ${bcScores[i - 1]} at index ${i}`);
    }
  });

  it('symbol files have wikilinks for callers and callees', () => {
    const nodesPath = path.join(vaultDir, 'nodes');
    const dirs = fs.readdirSync(nodesPath).filter(
      f => fs.statSync(path.join(nodesPath, f)).isDirectory()
    );
    // Find a symbol file that should have callers (not _COMMUNITY.md)
    let foundCallerLink = false;
    let foundCalleeLink = false;
    for (const dir of dirs) {
      const files = fs.readdirSync(path.join(nodesPath, dir)).filter(f => f !== '_COMMUNITY.md');
      for (const file of files) {
        const content = fs.readFileSync(path.join(nodesPath, dir, file), 'utf-8');
        if (content.includes('## Called by')) foundCallerLink = true;
        if (content.includes('## Calls')) foundCalleeLink = true;
        // Verify wikilinks exist when sections exist
        if (content.includes('## Called by') || content.includes('## Calls')) {
          assert.ok(content.includes('[['), `${dir}/${file} should have wikilinks`);
        }
        if (foundCallerLink && foundCalleeLink) break;
      }
      if (foundCallerLink && foundCalleeLink) break;
    }
    assert.ok(foundCallerLink, 'at least one symbol should have callers');
    assert.ok(foundCalleeLink, 'at least one symbol should have callees');
  });

  it('NODE_INDEX.json carries the full symbol table with tier signals', () => {
    // The flat per-symbol table moved out of the human markdown into the JSON.
    const idx = JSON.parse(fs.readFileSync(path.join(vaultDir, 'NODE_INDEX.json'), 'utf-8'));
    assert.equal(idx.symbols.length, idx.corpus.symbols, 'all symbols present in JSON');
    assert.ok(idx.godNodes.length > 0, 'god nodes listed separately');
    assert.ok(idx.communities.every(c => Array.isArray(c.hubs)), 'communities carry hubs');
  });
});

describe('buildIndex edge cases', { skip: SKIP_NO_GRAPH }, () => {
  it('throws when repo has no GitNexus index', () => {
    const badDir = path.join(os.tmpdir(), `devnexus-bad-${Date.now()}`);
    const badVault = path.join(badDir, 'vault');
    fs.mkdirSync(path.join(badDir, 'fake-repo'), { recursive: true });
    fs.mkdirSync(badVault, { recursive: true });

    assert.throws(
      () => buildIndex(badDir, 'vault', ['fake-repo']),
      /has no GitNexus index/
    );

    fs.rmSync(badDir, { recursive: true });
  });

  it('handles ARCHITECTURE_OVERVIEW.md without Known Gaps section', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-nogaps-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# Arch\n\nSome content.\n');
    if (!fs.existsSync(path.join(testDir, 'devnexus'))) {
      fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));
    }

    buildIndex(testDir, 'vault', ['devnexus']);

    const content = fs.readFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), 'utf-8');
    assert.ok(content.includes('<!-- devnexus:index:start -->'), 'should inject at end when no Known Gaps');
    assert.ok(content.startsWith('# Arch'), 'should preserve original content');

    fs.rmSync(testDir, { recursive: true });
  });

  it('handles missing ARCHITECTURE_OVERVIEW.md gracefully', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-noarch-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    // No ARCHITECTURE_OVERVIEW.md
    if (!fs.existsSync(path.join(testDir, 'devnexus'))) {
      fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));
    }

    // Should not throw
    const result = buildIndex(testDir, 'vault', ['devnexus']);
    assert.ok(result.totalSymbols > 0);

    // NODE_INDEX.md should still be created
    assert.ok(fs.existsSync(path.join(testVault, 'NODE_INDEX.md')));

    fs.rmSync(testDir, { recursive: true });
  });

  it('wipes nodes/ on reindex — no leftover files', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-wipe-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    const nodesDir = path.join(testVault, 'nodes');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    if (!fs.existsSync(path.join(testDir, 'devnexus'))) {
      fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));
    }

    // First run
    buildIndex(testDir, 'vault', ['devnexus']);
    const firstDirs = fs.readdirSync(nodesDir);

    // Plant a fake leftover
    fs.mkdirSync(path.join(nodesDir, 'should-be-wiped'));
    fs.writeFileSync(path.join(nodesDir, 'should-be-wiped', 'stale.md'), 'old');

    // Second run
    buildIndex(testDir, 'vault', ['devnexus']);
    const secondDirs = fs.readdirSync(nodesDir);

    assert.ok(!secondDirs.includes('should-be-wiped'), 'leftover directory should be wiped');
    assert.deepStrictEqual(firstDirs.sort(), secondDirs.sort(), 'should produce same dirs');

    fs.rmSync(testDir, { recursive: true });
  });
});
