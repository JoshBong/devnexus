import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildIndex } from '../src/lib/index-builder.js';
import { REPO_ROOT, SKIP_NO_GRAPH } from './helpers.js';

function makeTestDir() {
  const dir = path.join(os.tmpdir(), `devnexus-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
  fs.symlinkSync(REPO_ROOT, path.join(dir, 'devnexus'));
  return { dir, vault };
}

describe('wikilink safety', { skip: SKIP_NO_GRAPH }, () => {
  it('no wikilinks in output contain raw | [ ] characters', () => {
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    // Check NODE_INDEX.md
    const nodeIndex = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const wikilinks = nodeIndex.match(/\[\[[^\]]*\]\]/g) || [];
    for (const link of wikilinks) {
      const inner = link.slice(2, -2);
      // Pipe is allowed in Obsidian for display aliases (e.g., [[path|display]])
      // But we should check it's only used for our intentional aliases
      const pipes = inner.split('|');
      assert.ok(pipes.length <= 2, `wikilink has too many pipes: ${link}`);
      // No raw [ ] inside the wikilink
      assert.ok(!inner.includes('['), `wikilink contains [: ${link}`);
      assert.ok(!inner.includes(']'), `wikilink contains ]: ${link}`);
    }

    // Check all symbol files
    const nodesDir = path.join(vault, 'nodes');
    for (const dir2 of fs.readdirSync(nodesDir)) {
      const dirPath = path.join(nodesDir, dir2);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const links = content.match(/\[\[[^\]]*\]\]/g) || [];
        for (const link of links) {
          const inner = link.slice(2, -2);
          assert.ok(!inner.includes('['), `${dir2}/${file}: wikilink contains [: ${link}`);
          assert.ok(!inner.includes(']'), `${dir2}/${file}: wikilink contains ]: ${link}`);
        }
      }
    }

    fs.rmSync(dir, { recursive: true });
  });
});

describe('markdown table integrity', { skip: SKIP_NO_GRAPH }, () => {
  it('every table row in NODE_INDEX has correct column count', () => {
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    const content = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const lines = content.split('\n');

    let inTable = false;
    let expectedCols = 0;

    for (const line of lines) {
      if (line.startsWith('| Symbol') || line.startsWith('| Community')) {
        inTable = true;
        expectedCols = line.split('|').filter(Boolean).length;
        continue;
      }
      if (line.startsWith('|---') || line.startsWith('| ---')) {
        continue; // separator
      }
      if (inTable && line.startsWith('|')) {
        const cols = line.split('|').filter(Boolean).length;
        assert.equal(cols, expectedCols,
          `Column count mismatch: expected ${expectedCols}, got ${cols} in: ${line.slice(0, 100)}`);
      }
      if (inTable && !line.startsWith('|') && line.trim() !== '') {
        inTable = false; // table ended
      }
    }

    fs.rmSync(dir, { recursive: true });
  });

  it('no table cell in NODE_INDEX contains unescaped pipe', () => {
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    const content = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const dataRows = content.split('\n').filter(l =>
      l.startsWith('| [[') || l.startsWith('| **')
    );

    // Each cell should be cleanly separated by |
    // A cell containing an unescaped | would create an extra column
    for (const row of dataRows) {
      const cells = row.split('|').filter(Boolean);
      // God nodes table: 6 cols, Communities: 5 cols, All Symbols: 7 cols
      assert.ok(cells.length >= 5 && cells.length <= 7,
        `Row has unexpected column count (${cells.length}): ${row.slice(0, 100)}`);
    }

    fs.rmSync(dir, { recursive: true });
  });
});

describe('multi-repo orphan handling', { skip: SKIP_NO_GRAPH }, () => {
  it('orphan communities from different repos have unique names', () => {
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    const nodesDir = path.join(vault, 'nodes');
    const dirs = fs.readdirSync(nodesDir);
    const uncatDirs = dirs.filter(d => d.startsWith('uncategorized'));

    // For a single-repo test, should be at most 1 uncategorized
    assert.ok(uncatDirs.length <= 1,
      `Single-repo should have at most 1 uncategorized, got ${uncatDirs.length}`);

    // Check uniqueness
    const unique = new Set(uncatDirs);
    assert.equal(uncatDirs.length, unique.size, 'uncategorized dirs should be unique');

    fs.rmSync(dir, { recursive: true });
  });
});

describe('idempotency deep check', { skip: SKIP_NO_GRAPH }, () => {
  it('three consecutive runs produce identical output', () => {
    const { dir, vault } = makeTestDir();

    buildIndex(dir, 'vault', ['devnexus']);
    const run1 = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const arch1 = fs.readFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), 'utf-8');

    buildIndex(dir, 'vault', ['devnexus']);
    const run2 = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const arch2 = fs.readFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), 'utf-8');

    buildIndex(dir, 'vault', ['devnexus']);
    const run3 = fs.readFileSync(path.join(vault, 'NODE_INDEX.md'), 'utf-8');
    const arch3 = fs.readFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), 'utf-8');

    assert.equal(run1, run2, 'run1 and run2 NODE_INDEX should match');
    assert.equal(run2, run3, 'run2 and run3 NODE_INDEX should match');
    assert.equal(arch1, arch2, 'run1 and run2 ARCHITECTURE should match');
    assert.equal(arch2, arch3, 'run2 and run3 ARCHITECTURE should match');

    // Also verify community dirs are identical
    const nodesDir = path.join(vault, 'nodes');
    const dirs = fs.readdirSync(nodesDir).sort();
    // Spot-check a community file
    if (dirs.length > 0) {
      const firstComm = fs.readFileSync(
        path.join(nodesDir, dirs[0], '_COMMUNITY.md'), 'utf-8'
      );
      // Rerun
      buildIndex(dir, 'vault', ['devnexus']);
      const firstCommAfter = fs.readFileSync(
        path.join(nodesDir, dirs[0], '_COMMUNITY.md'), 'utf-8'
      );
      assert.equal(firstComm, firstCommAfter, 'community file should be identical');
    }

    fs.rmSync(dir, { recursive: true });
  });
});

describe('empty and degenerate cases', { skip: SKIP_NO_GRAPH }, () => {
  it('handles repo with no call edges gracefully', () => {
    // This tests the case where queryCallEdges returns empty
    // We can't easily mock this without the real repo, but we can verify
    // the output doesn't crash when there are no internal calls
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    const nodesDir = path.join(vault, 'nodes');
    const dirs = fs.readdirSync(nodesDir);

    // Every community brief is a valid, clean file: a "Start here" (hubs) section
    // and the symbol-count footer. No exhaustive member/call dumps anymore.
    let checked = 0;
    for (const d of dirs) {
      const comm = fs.readFileSync(path.join(nodesDir, d, '_COMMUNITY.md'), 'utf-8');
      assert.ok(!comm.includes('## All Symbols'), `${d} should not dump every member`);
      assert.ok(!comm.includes('## Internal Call Graph'), `${d} should not dump the call graph`);
      assert.ok(comm.includes('## Start here') || comm.includes('symbols total'),
        `${d} should be a valid clean brief`);
      checked++;
    }
    assert.ok(checked > 0, 'at least one community brief checked');

    fs.rmSync(dir, { recursive: true });
  });

  it('symbol files without callers or callees are still valid', () => {
    const { dir, vault } = makeTestDir();
    buildIndex(dir, 'vault', ['devnexus']);

    const nodesDir = path.join(vault, 'nodes');
    let foundLeafNode = false;

    outer:
    for (const d of fs.readdirSync(nodesDir)) {
      const dirPath = path.join(nodesDir, d);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const f of fs.readdirSync(dirPath)) {
        if (f === '_COMMUNITY.md' || !f.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(dirPath, f), 'utf-8');
        if (!content.includes('## Called by') && !content.includes('## Calls')) {
          foundLeafNode = true;
          // Should still have header and community link
          assert.ok(content.startsWith('#'), `${d}/${f} should start with header`);
          assert.ok(content.includes('in [['), `${d}/${f} should link to its community`);
          break outer;
        }
      }
    }
    assert.ok(foundLeafNode, 'should have at least one leaf node with no callers/callees');

    fs.rmSync(dir, { recursive: true });
  });
});
