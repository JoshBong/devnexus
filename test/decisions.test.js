import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildIndex } from '../src/lib/index-builder.js';
import { REPO_ROOT, SKIP_NO_GRAPH } from './helpers.js';

// Symlink to real devnexus repo for GitNexus index (same pattern as index-builder.test.js)
const tmpDir = path.join(os.tmpdir(), `devnexus-decision-test-${Date.now()}`);
const vaultDir = path.join(tmpDir, 'test-vault');
const decisionsDir = path.join(vaultDir, 'decisions');
const repoLink = path.join(tmpDir, 'devnexus');

function setup() {
  fs.mkdirSync(decisionsDir, { recursive: true });
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

describe('decision system', { skip: SKIP_NO_GRAPH }, () => {
  before(setup);
  after(cleanup);

  it('creates DECISION_INDEX.md when decisions exist', () => {
    fs.writeFileSync(path.join(decisionsDir, '2026-04-16-test-decision.md'), `# Test decision about buildIndex

Date: 2026-04-16
Author: Josh
Status: ACTIVE
Refs: [[buildIndex]]
Depends:

---

Decided not to split buildIndex because it would fragment the pipeline.
`);

    const result = buildIndex(tmpDir, 'test-vault', ['devnexus'], null);

    assert.ok(result.decisions >= 1, `Expected at least 1 decision, got ${result.decisions}`);

    const indexPath = path.join(decisionsDir, 'DECISION_INDEX.md');
    assert.ok(fs.existsSync(indexPath), 'DECISION_INDEX.md should exist');

    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    assert.ok(indexContent.includes('Test decision about buildIndex'), 'Index should contain decision title');
    assert.ok(indexContent.includes('2026-04-16'), 'Index should contain decision date');
    assert.ok(indexContent.includes('[[buildIndex]]'), 'Index should contain symbol ref');
    assert.ok(indexContent.includes('ACTIVE'), 'Index should show ACTIVE status');
  });

  it('injects ## Decisions section into symbol node files', () => {
    const nodesDir = path.join(vaultDir, 'nodes');
    assert.ok(fs.existsSync(nodesDir), 'nodes/ directory should exist');

    let found = false;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name));
        } else if (entry.name === 'buildIndex.md') {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          assert.ok(content.includes('## Why'), 'buildIndex.md should lead with the ## Why (decisions) section');
          assert.ok(content.includes('Test decision about buildIndex'), 'Should link to the test decision');
          assert.ok(content.includes('ACTIVE'), 'Should show ACTIVE status');
          found = true;
        }
      }
    };
    walk(nodesDir);
    assert.ok(found, 'Should find buildIndex.md in nodes/');
  });

  it('marks decisions as STALE when refs dont exist in graph', () => {
    fs.writeFileSync(path.join(decisionsDir, '2026-04-15-fake-symbol.md'), `# Rejected FakeSymbolThatDoesNotExist refactor

Date: 2026-04-15
Author: Josh
Status: ACTIVE
Refs: [[FakeSymbolThatDoesNotExist]]
Depends:

---

This symbol doesn't exist so this decision should be flagged STALE.
`);

    const result = buildIndex(tmpDir, 'test-vault', ['devnexus'], null);

    assert.ok(result.staleDecisions >= 1, `Expected at least 1 stale decision, got ${result.staleDecisions}`);

    const staleContent = fs.readFileSync(path.join(decisionsDir, '2026-04-15-fake-symbol.md'), 'utf-8');
    assert.ok(staleContent.includes('Status: STALE'), 'Decision file should be updated to STALE');

    const indexContent = fs.readFileSync(path.join(decisionsDir, 'DECISION_INDEX.md'), 'utf-8');
    assert.ok(indexContent.includes('STALE'), 'Index should show STALE status');
  });

  it('parses decision files with multiple refs', () => {
    fs.writeFileSync(path.join(decisionsDir, '2026-04-17-multi-ref.md'), `# Multi-ref decision

Date: 2026-04-17
Author: Josh
Status: ACTIVE
Refs: [[buildIndex]], [[writeCommunityDirs]], [[computeGodNodes]]
Depends: 2026-04-16-test-decision.md

---

Testing that multiple refs all get backlinks.
`);

    buildIndex(tmpDir, 'test-vault', ['devnexus'], null);

    const nodesDir = path.join(vaultDir, 'nodes');
    let refsFound = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name));
        } else if (['buildIndex.md', 'writeCommunityDirs.md', 'computeGodNodes.md'].includes(entry.name)) {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          if (content.includes('Multi-ref decision')) refsFound++;
        }
      }
    };
    walk(nodesDir);
    assert.ok(refsFound >= 2, `Expected at least 2 node files with multi-ref backlink, got ${refsFound}`);
  });
});

describe('decision system - edge cases', { skip: SKIP_NO_GRAPH }, () => {
  it('handles empty decisions directory gracefully', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devnexus-empty-dec-'));
    const vault = path.join(tmp, 'test-vault');
    fs.mkdirSync(path.join(vault, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), '# Arch\n\n## Known Gaps\n');
    fs.symlinkSync(REPO_ROOT, path.join(tmp, 'devnexus'));

    const result = buildIndex(tmp, 'test-vault', ['devnexus'], null);
    assert.equal(result.decisions, 0);
    assert.equal(result.staleDecisions, 0);
    assert.ok(!fs.existsSync(path.join(vault, 'decisions', 'DECISION_INDEX.md')));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('handles no decisions directory gracefully', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devnexus-no-dec-'));
    const vault = path.join(tmp, 'test-vault');
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, 'ARCHITECTURE_OVERVIEW.md'), '# Arch\n\n## Known Gaps\n');
    fs.symlinkSync(REPO_ROOT, path.join(tmp, 'devnexus'));

    const result = buildIndex(tmp, 'test-vault', ['devnexus'], null);
    assert.equal(result.decisions, 0);
    assert.equal(result.staleDecisions, 0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
