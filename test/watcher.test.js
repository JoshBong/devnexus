import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { startWatcher } from '../src/mcp/watcher.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@devnexus.dev']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('watcher commits + pushes a human edit (debounced)', async () => {
  const bare = tmp('w-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  const dir = tmp('w-vault-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'DECISIONS.md'), '# Decisions\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);

  const w = await startWatcher({ vaultDir: dir, config: { vaultSync: 'mcp' } });
  assert.ok(w, 'watcher started');

  try {
    // human writes a file directly
    fs.writeFileSync(path.join(dir, 'NOTES.md'), '# Notes\nwatched edit\n');

    // poll the bare remote for the change (debounce 1.5s + push time)
    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) {
      await sleep(500);
      const verify = tmp('w-verify-');
      git(path.dirname(verify), ['clone', '-q', bare, verify]);
      landed = fs.existsSync(path.join(verify, 'NOTES.md'));
      fs.rmSync(verify, { recursive: true, force: true });
    }
    assert.ok(landed, 'watched edit was committed and pushed within timeout');
  } finally {
    w.stop();
  }
});

test('catch-up: an edit made BEFORE the watcher starts gets pushed on launch', async () => {
  const bare = tmp('wc-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  const dir = tmp('wc-vault-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.devnexus/\n');
  fs.writeFileSync(path.join(dir, 'DECISIONS.md'), '# Decisions\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);

  // simulate an offline edit: written while NO watcher/agent was running
  fs.writeFileSync(path.join(dir, 'OFFLINE.md'), '# Offline\nedited with no agent running\n');

  const w = await startWatcher({ vaultDir: dir, config: { vaultSync: 'mcp' } });
  assert.ok(w, 'watcher started');
  try {
    let landed = false;
    for (let i = 0; i < 16 && !landed; i++) {
      await sleep(500);
      const verify = tmp('wc-verify-');
      git(path.dirname(verify), ['clone', '-q', bare, verify]);
      landed = fs.existsSync(path.join(verify, 'OFFLINE.md'));
      fs.rmSync(verify, { recursive: true, force: true });
    }
    assert.ok(landed, 'pre-existing offline edit was caught up and pushed on launch');
  } finally {
    w.stop();
  }
});

test('second watcher on the same vault is a no-op (lease held)', async () => {
  const dir = tmp('w-lease-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'DECISIONS.md'), '# Decisions\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);

  const first = await startWatcher({ vaultDir: dir, config: { vaultSync: 'mcp' } });
  assert.ok(first, 'first watcher acquired the lease');
  try {
    const second = await startWatcher({ vaultDir: dir, config: { vaultSync: 'mcp' } });
    assert.equal(second, null, 'second watcher backs off');
  } finally {
    first.stop();
  }
});

test('watcher does not start when sync is off', async () => {
  const dir = tmp('w-off-');
  initRepo(dir);
  const w = await startWatcher({ vaultDir: dir, config: { vaultSync: 'off' } });
  assert.equal(w, null);
});
