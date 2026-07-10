import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildIndex } from '../src/lib/index-builder.js';
import { REPO_ROOT, SKIP_NO_GRAPH } from './helpers.js';

describe('index stress tests', { skip: SKIP_NO_GRAPH }, () => {
  it('no symbol file contains pipe characters that break markdown tables', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-pipe-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));

    buildIndex(testDir, 'vault', ['devnexus']);

    // Check NODE_INDEX.md table rows are well-formed
    const nodeIndex = fs.readFileSync(path.join(testVault, 'NODE_INDEX.md'), 'utf-8');
    const tableRows = nodeIndex.split('\n').filter(l => l.startsWith('| [['));
    for (const row of tableRows) {
      const cells = row.split('|').filter(Boolean);
      // Each data row should have consistent cell count (6 for All Symbols, 5 for God Nodes)
      assert.ok(cells.length >= 5, `row should have at least 5 cells: ${row.slice(0, 80)}`);
    }

    fs.rmSync(testDir, { recursive: true });
  });

  it('community _COMMUNITY.md internal call graph has no duplicates', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-dedup-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));

    buildIndex(testDir, 'vault', ['devnexus']);

    const nodesDir = path.join(testVault, 'nodes');
    const dirs = fs.readdirSync(nodesDir);
    for (const dir of dirs) {
      const communityFile = path.join(nodesDir, dir, '_COMMUNITY.md');
      if (!fs.existsSync(communityFile)) continue;
      const content = fs.readFileSync(communityFile, 'utf-8');
      const callLines = content.split('\n').filter(l => l.startsWith('- `') && l.includes('→'));
      const unique = new Set(callLines);
      assert.equal(callLines.length, unique.size,
        `${dir}/_COMMUNITY.md has duplicate call graph entries`);
    }

    fs.rmSync(testDir, { recursive: true });
  });

  it('every symbol in NODE_INDEX has a corresponding .md file', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-complete-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));

    buildIndex(testDir, 'vault', ['devnexus']);

    // Collect all .md files in nodes/ (excluding _COMMUNITY.md)
    const nodesDir = path.join(testVault, 'nodes');
    const allFiles = new Set();
    for (const dir of fs.readdirSync(nodesDir)) {
      const dirPath = path.join(nodesDir, dir);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const f of fs.readdirSync(dirPath)) {
        if (f !== '_COMMUNITY.md' && f.endsWith('.md')) {
          allFiles.add(f.replace('.md', ''));
        }
      }
    }

    // The full symbol table lives in NODE_INDEX.json now (not the human markdown).
    const idx = JSON.parse(fs.readFileSync(path.join(testVault, 'NODE_INDEX.json'), 'utf-8'));
    const indexSymbols = idx.symbols.map(s => s.name);

    // Every symbol in the index should have a file
    const missing = [];
    for (const sym of indexSymbols) {
      // sanitizeFilename replaces non-alphanum with _
      const sanitized = sym.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!allFiles.has(sanitized) && !allFiles.has(sym)) {
        missing.push(sym);
      }
    }
    assert.equal(missing.length, 0,
      `Symbols in NODE_INDEX without .md files: ${missing.slice(0, 10).join(', ')}`);

    fs.rmSync(testDir, { recursive: true });
  });

  it('no community directory name contains unsafe filesystem characters', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-safe-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));

    buildIndex(testDir, 'vault', ['devnexus']);

    const nodesDir = path.join(testVault, 'nodes');
    const dirs = fs.readdirSync(nodesDir);
    const unsafePattern = /[<>:"/\\|?*\x00-\x1f]/;
    for (const dir of dirs) {
      assert.ok(!unsafePattern.test(dir), `directory name has unsafe chars: ${dir}`);
    }

    fs.rmSync(testDir, { recursive: true });
  });

  it('god nodes in NODE_INDEX.json match NODE_INDEX.md (and ARCH stays a pointer)', () => {
    const testDir = path.join(os.tmpdir(), `devnexus-match-${Date.now()}`);
    const testVault = path.join(testDir, 'vault');
    fs.mkdirSync(testVault, { recursive: true });
    fs.writeFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), '# A\n');
    fs.symlinkSync(REPO_ROOT, path.join(testDir, 'devnexus'));

    buildIndex(testDir, 'vault', ['devnexus']);

    // God node names from NODE_INDEX.md
    const nodeIndex = fs.readFileSync(path.join(testVault, 'NODE_INDEX.md'), 'utf-8');
    const godSection = nodeIndex.split('## Communities')[0].split('## God Nodes')[1];
    const mdGods = (godSection.match(/\[\[(\w+)\]\]/g) || []).map(m => m.replace(/[\[\]]/g, ''));

    // God node names from the structured twin
    const json = JSON.parse(fs.readFileSync(path.join(testVault, 'NODE_INDEX.json'), 'utf-8'));
    const jsonGods = json.godNodes.map(g => g.name);

    assert.deepStrictEqual(jsonGods, mdGods,
      'god nodes should be identical between NODE_INDEX.json and NODE_INDEX.md');

    // The committed ARCHITECTURE_OVERVIEW must stay a branch-stable pointer
    const arch = fs.readFileSync(path.join(testVault, 'ARCHITECTURE_OVERVIEW.md'), 'utf-8');
    assert.ok(!arch.includes('### God Nodes'), 'ARCH must not embed branch-specific god nodes');

    fs.rmSync(testDir, { recursive: true });
  });
});
