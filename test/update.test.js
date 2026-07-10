import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MANAGED_RULE_FILES, preserveUserRules, restoreUserRules, migrateDecisions } from '../src/commands/update.js';

describe('update: user rule preservation', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnx-rules-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('preserves user-authored rule files across a dir wipe, drops devnexus-owned ones', () => {
    const rulesDir = path.join(dir, '.ai-rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    // devnexus-owned (current + legacy) — must NOT be carried over (update rewrites them)
    fs.writeFileSync(path.join(rulesDir, '01-session-start.md'), 'devnexus v1');
    fs.writeFileSync(path.join(rulesDir, '05-vault-brain-mcp.md'), 'legacy devnexus');
    fs.writeFileSync(path.join(rulesDir, 'version.txt'), '3.0\n');
    // user-authored — MUST survive
    fs.writeFileSync(path.join(rulesDir, '05-team-conventions.md'), 'our team rules');
    fs.writeFileSync(path.join(rulesDir, '99-notes.md'), 'scratch');

    const kept = preserveUserRules(rulesDir);
    assert.deepEqual(Object.keys(kept).sort(), ['05-team-conventions.md', '99-notes.md']);
    assert.ok(!('01-session-start.md' in kept));
    assert.ok(!('05-vault-brain-mcp.md' in kept));

    // simulate update's rm + recreate
    fs.rmSync(rulesDir, { recursive: true });
    fs.mkdirSync(rulesDir, { recursive: true });
    restoreUserRules(rulesDir, kept);

    assert.equal(fs.readFileSync(path.join(rulesDir, '05-team-conventions.md'), 'utf-8'), 'our team rules');
    assert.equal(fs.readFileSync(path.join(rulesDir, '99-notes.md'), 'utf-8'), 'scratch');
    assert.ok(!fs.existsSync(path.join(rulesDir, '01-session-start.md')));
  });

  it('restore never clobbers a freshly written managed file', () => {
    const rulesDir = path.join(dir, '.ai-rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, '01-session-start.md'), 'new template');
    // a stale kept-map that happens to include a now-managed name must not overwrite it
    restoreUserRules(rulesDir, { '01-session-start.md': 'STALE' });
    assert.equal(fs.readFileSync(path.join(rulesDir, '01-session-start.md'), 'utf-8'), 'new template');
  });

  it('preserveUserRules on a missing dir returns empty', () => {
    assert.deepEqual(preserveUserRules(path.join(dir, 'nope')), {});
  });

  it('MANAGED_RULE_FILES covers current + legacy devnexus rule names', () => {
    for (const n of ['00-gate.md', '04-vault-brain-mcp.md', '04-code-intelligence.md',
      '05-vault-brain-mcp.md', '04-operator-profile.md', 'version.txt']) {
      assert.ok(MANAGED_RULE_FILES.has(n), `${n} should be managed`);
    }
  });
});

describe('writeAgentPointer: inline agents get rules, pointer agents get stubs', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnx-ptr-'));
    fs.mkdirSync(path.join(dir, '.ai-rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ai-rules', '01-source-of-truth.md'), '# Rule One\nBody.');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('cursor (inline) gets the concatenated rules in managed fences, not a stub', async () => {
    const { writeAgentPointer } = await import('../src/lib/fs-helpers.js');
    writeAgentPointer({ dir, filename: '.cursorrules', agent: 'cursor', pointerContent: 'READ .ai-rules/' });
    const out = fs.readFileSync(path.join(dir, '.cursorrules'), 'utf-8');
    assert.match(out, /Rule One/); // real rules, inline
    assert.ok(!out.includes('READ .ai-rules/'), 'no pointer stub for an inline agent');
  });

  it('claude (pointer) gets the stub, existing file kept', async () => {
    const { writeAgentPointer } = await import('../src/lib/fs-helpers.js');
    const created = writeAgentPointer({ dir, filename: 'CLAUDE.md', agent: 'claude', pointerContent: 'READ .ai-rules/' });
    assert.equal(created, true);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8'), 'READ .ai-rules/');
  });
});

describe('update: migrateDecisions is non-destructive', () => {
  let vault;
  beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), 'dnx-dec-')); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  const write = (body) => fs.writeFileSync(path.join(vault, 'DECISIONS.md'), body);
  const read = () => fs.readFileSync(path.join(vault, 'DECISIONS.md'), 'utf-8');

  it('keeps hyphen-format entries + prose above the first entry; migrates only symbol entries', () => {
    write([
      '# Decisions', '',
      '> Reverse-chronological log of non-obvious decisions', '',
      '---', '',
      'A freeform note the team added above their first entry.', '',
      '## 2026-01-05 - Chose Postgres over Mongo', '',
      'Relational fit. Plain hyphen separator.', '',
      '## 2026-01-04 — Refactor buildIndex for streaming', '',
      'buildIndex now streams. References a code symbol.', '',
      '## 2026-01-03 - Adopt trunk-based flow', '',
      'Team process, no symbols.',
    ].join('\n'));

    const migrated = migrateDecisions(vault);
    assert.equal(migrated, 1); // only the buildIndex (symbol) entry
    const after = read();
    // hyphen entries survive verbatim
    assert.match(after, /Chose Postgres over Mongo/);
    assert.match(after, /Relational fit\./);
    assert.match(after, /Adopt trunk-based flow/);
    // prose above the first entry survives (the exact loss the old rewrite caused)
    assert.match(after, /freeform note the team added/);
    // symbol entry is gone from DECISIONS.md and now a file
    assert.ok(!after.includes('Refactor buildIndex'));
    const files = fs.readdirSync(path.join(vault, 'decisions'));
    assert.ok(files.some(f => f.includes('buildindex') || f.includes('refactor')));
  });

  it('does not corrupt a DECISIONS.md that has no --- separator', () => {
    write([
      '# Decisions', '',
      '## 2026-01-05 — Adopt useMemo caching', '',
      'Body mentioning useMemo, a symbol.', '',
      '## 2026-01-04 — Weekly planning cadence', '',
      'No code here, just process.',
    ].join('\n'));

    migrateDecisions(vault);
    const after = read();
    assert.match(after, /# Decisions/); // header intact, not sliced to 2 chars
    assert.match(after, /Weekly planning cadence/); // non-symbol entry kept
    assert.ok(!after.includes('Adopt useMemo caching')); // symbol entry migrated out
  });
});
