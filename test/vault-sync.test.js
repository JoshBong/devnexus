import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { syncedWrite, syncRead, syncDirty, readSyncStatus, acquireLease, releaseLease } from '../src/lib/vault-sync.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@devnexus.dev']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function seedVault(dir) {
  fs.writeFileSync(path.join(dir, 'DECISIONS.md'), '# Decisions\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const append = (vaultDir, text) => () => {
  fs.appendFileSync(path.join(vaultDir, 'DECISIONS.md'), text);
  return ['DECISIONS.md'];
};

test('sync=off writes the file but does no git', async () => {
  const dir = tmp('vs-off-');
  initRepo(dir);
  seedVault(dir);
  const before = git(dir, ['rev-list', '--count', 'HEAD']);
  const res = await syncedWrite(dir, { message: 'decision: x', sync: 'off' }, append(dir, '\n## x\n'));
  assert.equal(res.committed, false);
  assert.equal(res.synced, false);
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), before, 'no new commit');
  assert.match(fs.readFileSync(path.join(dir, 'DECISIONS.md'), 'utf-8'), /## x/);
});

test('no remote -> commits locally, reports pending', async () => {
  const dir = tmp('vs-local-');
  initRepo(dir);
  seedVault(dir);
  const res = await syncedWrite(dir, { message: 'decision: local', sync: 'mcp' }, append(dir, '\n## local\n'));
  assert.equal(res.committed, true);
  assert.equal(res.synced, false);
  assert.match(git(dir, ['log', '-1', '--pretty=%s']), /decision: local/);
});

test('with a bare remote -> commits and pushes', async () => {
  const bare = tmp('vs-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  const dir = tmp('vs-clone-');
  initRepo(dir);
  seedVault(dir);
  git(dir, ['remote', 'add', 'origin', bare]);

  const res = await syncedWrite(dir, { message: 'decision: pushed', sync: 'mcp' }, append(dir, '\n## pushed\n'));
  assert.equal(res.synced, true, res.note);

  // verify it landed in the bare remote
  const check = tmp('vs-verify-');
  git(path.dirname(check), ['clone', '-q', bare, check]);
  assert.match(fs.readFileSync(path.join(check, 'DECISIONS.md'), 'utf-8'), /## pushed/);

  const status = readSyncStatus(dir);
  assert.ok(status.lastPush);
});

test('two clones converge (pull-before-write); both entries land', async () => {
  const bare = tmp('vs2-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);

  const a = tmp('vs2-a-');
  initRepo(a);
  seedVault(a);
  git(a, ['remote', 'add', 'origin', bare]);
  await syncedWrite(a, { message: 'decision: a1', sync: 'mcp' }, append(a, '\n## a1\n'));

  // b clones AFTER a's first push, then both keep writing
  const b = tmp('vs2-b-');
  git(path.dirname(b), ['clone', '-q', bare, b]);
  git(b, ['config', 'user.email', 'b@devnexus.dev']);
  git(b, ['config', 'user.name', 'B']);
  git(b, ['config', 'commit.gpgsign', 'false']);

  await syncedWrite(a, { message: 'decision: a2', sync: 'mcp' }, append(a, '\n## a2\n'));
  // b is now behind by a2 — its pre-write pull must pick it up before appending b1
  const rb = await syncedWrite(b, { message: 'decision: b1', sync: 'mcp' }, append(b, '\n## b1\n'));
  assert.equal(rb.synced, true, rb.note);

  const final = tmp('vs2-final-');
  git(path.dirname(final), ['clone', '-q', bare, final]);
  const text = fs.readFileSync(path.join(final, 'DECISIONS.md'), 'utf-8');
  assert.match(text, /## a1/);
  assert.match(text, /## a2/);
  assert.match(text, /## b1/);
});

test('offline (bad remote) -> committed locally, push deferred', async () => {
  const dir = tmp('vs-offline-');
  initRepo(dir);
  seedVault(dir);
  git(dir, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'definitely-not-a-repo-xyz')]);
  const res = await syncedWrite(dir, { message: 'decision: deferred', sync: 'mcp' }, append(dir, '\n## deferred\n'));
  assert.equal(res.committed, true);
  assert.equal(res.synced, false);
  assert.match(git(dir, ['log', '-1', '--pretty=%s']), /decision: deferred/);
  const status = readSyncStatus(dir);
  assert.ok(status.pending >= 1, 'pending commits tracked');
});

test('a write on a clone diverged (same-line conflict) leaves NO conflict markers mid-rebase', async () => {
  const bare = tmp('vsc-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);

  // base with a shared line both sides will fight over
  const a = tmp('vsc-a-');
  initRepo(a);
  fs.writeFileSync(path.join(a, 'DECISIONS.md'), '# Decisions\nSHARED-LINE\n');
  git(a, ['add', '-A']); git(a, ['commit', '-q', '-m', 'base']);
  git(a, ['remote', 'add', 'origin', bare]);
  git(a, ['push', '-q', '-u', 'origin', 'main']);

  const b = tmp('vsc-b-');
  git(path.dirname(b), ['clone', '-q', bare, b]);
  git(b, ['config', 'user.email', 'b@devnexus.dev']);
  git(b, ['config', 'user.name', 'B']);
  git(b, ['config', 'commit.gpgsign', 'false']);

  // a changes the shared line and pushes
  fs.writeFileSync(path.join(a, 'DECISIONS.md'), '# Decisions\nA-VERSION\n');
  git(a, ['commit', '-qam', 'a edit']);
  git(a, ['push', '-q']);

  // b changes the SAME line and commits locally (no push) — now diverged + conflicting,
  // the exact state a prior lost push race leaves behind.
  fs.writeFileSync(path.join(b, 'DECISIONS.md'), '# Decisions\nB-VERSION\n');
  git(b, ['commit', '-qam', 'b edit']);

  // a fresh write on b: pre-pull will conflict and MUST abort before writeFn runs.
  const res = await syncedWrite(b, { message: 'decision: b2', sync: 'mcp' }, append(b, '\n## b2\n'));

  const text = fs.readFileSync(path.join(b, 'DECISIONS.md'), 'utf-8');
  assert.ok(!/[<>=]{7}/.test(text), 'no conflict markers written into the vault');
  assert.match(text, /B-VERSION/, "b's local work preserved");
  assert.match(text, /## b2/, 'the new write landed');
  // no rebase left in progress
  assert.ok(!fs.existsSync(path.join(b, '.git', 'rebase-merge')), 'no rebase-merge state');
  assert.ok(!fs.existsSync(path.join(b, '.git', 'rebase-apply')), 'no rebase-apply state');
  assert.equal(res.committed, true);
  assert.ok(res.conflict, 'conflict honestly reported');
});

test('lock serializes: a held lock makes a waiting write fall back to local', async () => {
  const dir = tmp('vs-lock-');
  initRepo(dir);
  seedVault(dir);
  // simulate a live foreign lock held by this very process (pid alive, fresh ts)
  fs.mkdirSync(path.join(dir, '.devnexus'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.devnexus', 'sync.lock'),
    JSON.stringify({ pid: process.pid, host: os.hostname(), ts: Date.now() }));

  const res = await syncedWrite(dir, { message: 'decision: blocked', sync: 'mcp' }, append(dir, '\n## blocked\n'));
  assert.match(res.note, /busy/);
  assert.match(fs.readFileSync(path.join(dir, 'DECISIONS.md'), 'utf-8'), /## blocked/, 'write still happened');
});

test('stale lock semantics: dead-pid and dead-host stolen; a LIVE same-host holder is not', async () => {
  const { execFileSync } = await import('child_process');
  // a pid that definitely exited (spawned child), so same-host + dead-pid = stale
  const deadPid = Number(execFileSync('sh', ['-c', 'echo $$'], { encoding: 'utf-8' }).trim());

  // (a) same host, dead pid, FRESH ts → still stolen (pid check is authoritative)
  const a = tmp('vs-stale-a-');
  initRepo(a); seedVault(a);
  fs.mkdirSync(path.join(a, '.devnexus'), { recursive: true });
  fs.writeFileSync(path.join(a, '.devnexus', 'sync.lock'),
    JSON.stringify({ pid: deadPid, host: os.hostname(), ts: Date.now() }));
  const ra = await syncedWrite(a, { message: 'decision: stolen', sync: 'mcp' }, append(a, '\n## stolen\n'));
  assert.equal(ra.committed, true, 'dead-pid lock stolen even with fresh ts');

  // (b) other host, ts older than TTL → stolen (pid unknowable, TTL decides)
  const b = tmp('vs-stale-b-');
  initRepo(b); seedVault(b);
  fs.mkdirSync(path.join(b, '.devnexus'), { recursive: true });
  fs.writeFileSync(path.join(b, '.devnexus', 'sync.lock'),
    JSON.stringify({ pid: 1234, host: 'some-other-machine', ts: Date.now() - 60_000 }));
  const rb = await syncedWrite(b, { message: 'decision: xhost', sync: 'mcp' }, append(b, '\n## xhost\n'));
  assert.equal(rb.committed, true, 'cross-host expired lock stolen');

  // (c) same host, LIVE pid, ts older than TTL → NOT stolen. A long push exceeds any
  // TTL and the holder never refreshes ts mid-op; stealing a live lock = concurrent git.
  const c = tmp('vs-stale-c-');
  initRepo(c); seedVault(c);
  fs.mkdirSync(path.join(c, '.devnexus'), { recursive: true });
  fs.writeFileSync(path.join(c, '.devnexus', 'sync.lock'),
    JSON.stringify({ pid: process.pid, host: os.hostname(), ts: Date.now() - 60_000 }));
  const rc = await syncedWrite(c, { message: 'decision: held', sync: 'mcp' }, append(c, '\n## held\n'));
  assert.match(rc.note, /busy/, 'live same-host lock is respected regardless of ts');
  assert.match(fs.readFileSync(path.join(c, 'DECISIONS.md'), 'utf-8'), /## held/, 'write still lands locally');
});

test('syncRead is a no-op without a remote', async () => {
  const dir = tmp('vs-read-');
  initRepo(dir);
  seedVault(dir);
  const res = await syncRead(dir, { sync: 'mcp' });
  assert.equal(res.pulled, false);
});

test('syncDirty commits all dirty files and pushes to the remote', async () => {
  const bare = tmp('sd-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  const dir = tmp('sd-clone-');
  initRepo(dir);
  seedVault(dir);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);

  // simulate a human editing a file directly (not via a tool)
  fs.writeFileSync(path.join(dir, 'ARCHITECTURE.md'), '# Arch\nhuman edit\n');
  const res = await syncDirty(dir, { sync: 'mcp', message: 'vault: edits' });
  assert.equal(res.synced, true, res.note);

  const verify = tmp('sd-verify-');
  git(path.dirname(verify), ['clone', '-q', bare, verify]);
  assert.match(fs.readFileSync(path.join(verify, 'ARCHITECTURE.md'), 'utf-8'), /human edit/);
});

test('syncDirty with nothing dirty does not commit', async () => {
  const dir = tmp('sd-clean-');
  initRepo(dir);
  seedVault(dir);
  const before = git(dir, ['rev-list', '--count', 'HEAD']);
  const res = await syncDirty(dir, { sync: 'mcp' });
  assert.equal(res.committed, false);
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), before);
});

test('watcher lease is a singleton and releasable', () => {
  const dir = tmp('lease-');
  initRepo(dir);
  seedVault(dir);
  assert.equal(acquireLease(dir), true, 'first acquire wins');
  assert.equal(acquireLease(dir), false, 'second acquire blocked while held');
  releaseLease(dir);
  assert.equal(acquireLease(dir), true, 'acquire again after release');
  releaseLease(dir);
});
