import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  DEVNEXUS_DIR,
  SYNC_LOCK_FILE,
  SYNC_STATUS_FILE,
  SYNC_LOCK_TTL_MS,
  SYNC_LOCK_WAIT_MS,
  SYNC_GIT_TIMEOUT_MS,
  WATCH_LEASE_FILE,
  WATCH_LEASE_TTL_MS,
} from '../constants.js';
import { isGitRepo, gitHasRemote } from './git.js';

// --- git plumbing ----------------------------------------------------------

// Run a git command, never prompting and never throwing. Returns
// { ok, stdout, stderr }. GIT_TERMINAL_PROMPT=0 makes auth failures fail fast
// instead of hanging the tool call waiting on a password.
function git(cwd, args) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: SYNC_GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return { ok: true, stdout: (stdout || '').trim(), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || err.message || '').toString().trim(),
    };
  }
}

function hasUpstream(cwd) {
  return git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok;
}

function pendingCount(cwd) {
  if (!hasUpstream(cwd)) {
    const r = git(cwd, ['rev-list', '--count', 'HEAD']);
    return r.ok ? Number(r.stdout) || 0 : 0;
  }
  const r = git(cwd, ['rev-list', '--count', '@{u}..HEAD']);
  return r.ok ? Number(r.stdout) || 0 : 0;
}

// Classify a failed push: contention (someone pushed first) vs offline/auth.
function isContention(stderr) {
  return /\b(rejected|non-fast-forward|fetch first|behind)\b/i.test(stderr);
}

// --- lock ------------------------------------------------------------------

function devnexusDir(vaultDir) {
  const d = path.join(vaultDir, DEVNEXUS_DIR);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function lockPath(vaultDir) {
  return path.join(devnexusDir(vaultDir), SYNC_LOCK_FILE);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but not ours
  }
}

function writeLock(file) {
  const fd = fs.openSync(file, 'wx'); // atomic create-or-fail
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), ts: Date.now() }));
  fs.closeSync(fd);
}

function isStale(file) {
  try {
    const lock = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - lock.ts > SYNC_LOCK_TTL_MS) return true;
    if (lock.host === os.hostname() && !pidAlive(lock.pid)) return true;
    return false;
  } catch {
    return true; // unparseable lock — treat as stale
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Try to acquire the lock. waitMs=0 -> single attempt (reads). Returns bool.
async function acquireLock(vaultDir, waitMs) {
  const file = lockPath(vaultDir);
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      writeLock(file);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (isStale(file)) {
        try { fs.unlinkSync(file); } catch { /* another process stole it first */ }
        continue;
      }
      if (Date.now() >= deadline) return false;
      await sleep(150);
    }
  }
}

function releaseLock(vaultDir) {
  const file = lockPath(vaultDir);
  try {
    const lock = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (lock.pid === process.pid && lock.host === os.hostname()) fs.unlinkSync(file);
  } catch { /* gone already / not ours */ }
}

// --- watcher lease (long-held singleton, distinct from the per-op lock) -----

function leasePath(vaultDir) {
  return path.join(devnexusDir(vaultDir), WATCH_LEASE_FILE);
}

function writeOwner(file) {
  const fd = fs.openSync(file, 'wx');
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), ts: Date.now() }));
  fs.closeSync(fd);
}

function leaseStale(file) {
  try {
    const l = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - l.ts > WATCH_LEASE_TTL_MS) return true;
    if (l.host === os.hostname() && !pidAlive(l.pid)) return true;
    return false;
  } catch {
    return true;
  }
}

/** Try to become the sole watcher for this vault. Returns bool. */
export function acquireLease(vaultDir) {
  const file = leasePath(vaultDir);
  try {
    writeOwner(file);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') return false;
    if (leaseStale(file)) {
      try { fs.unlinkSync(file); } catch { /* lost the race */ }
      try { writeOwner(file); return true; } catch { return false; }
    }
    return false;
  }
}

/** Keep the lease fresh so other processes don't steal it as stale. */
export function refreshLease(vaultDir) {
  const file = path.join(vaultDir, DEVNEXUS_DIR, WATCH_LEASE_FILE);
  try {
    const l = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (l.pid === process.pid && l.host === os.hostname()) {
      l.ts = Date.now();
      fs.writeFileSync(file, JSON.stringify(l));
      return true;
    }
  } catch { /* not ours / gone */ }
  return false;
}

export function releaseLease(vaultDir) {
  const file = path.join(vaultDir, DEVNEXUS_DIR, WATCH_LEASE_FILE);
  try {
    const l = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (l.pid === process.pid && l.host === os.hostname()) fs.unlinkSync(file);
  } catch { /* gone already / not ours */ }
}

// --- shared commit/push ----------------------------------------------------

// Best-effort pre-write pull. CRITICAL: if the rebase hits a conflict it must be
// ABORTED before we hand control to writeFn — otherwise the vault is left mid-rebase
// with conflict markers and unmerged index entries, the subsequent `add`/`commit`
// bakes those markers in, and every later sync repeats the failure. This is the exact
// scenario the module promises never to produce (see the syncedWrite docstring), and it
// was reachable whenever an earlier conflict left a local commit that the next pre-pull
// replays. On any failure we abort, leave the tree clean on our local HEAD, and let the
// downstream push path report the conflict/offline state. Returns { ok, conflict }.
function safePull(vaultDir) {
  const rb = git(vaultDir, ['pull', '--rebase', '--autostash', '--no-edit']);
  if (rb.ok) return { ok: true, conflict: false };
  // A rebase may be in progress (real conflict) or not (network/auth failed before it
  // started). `rebase --abort` errors harmlessly in the latter case; either way the tree
  // must be clean before writeFn. --quit as a fallback detaches any lingering rebase state.
  const abort = git(vaultDir, ['rebase', '--abort']);
  if (!abort.ok) git(vaultDir, ['rebase', '--quit']);
  return { ok: false, conflict: isContention(rb.stderr) || /conflict/i.test(rb.stderr) };
}

// Push current commits, retrying through contention. Assumes a commit exists.
function pushWithRetry(vaultDir) {
  let pushed = false, conflict = false, offline = false, lastErr = '';
  for (let attempt = 0; attempt < 3 && !pushed; attempt++) {
    const push = git(vaultDir, hasUpstream(vaultDir) ? ['push'] : ['push', '-u', 'origin', 'HEAD']);
    if (push.ok) { pushed = true; break; }
    lastErr = push.stderr;
    if (isContention(push.stderr)) {
      const rb = git(vaultDir, ['pull', '--rebase', '--autostash', '--no-edit']);
      if (!rb.ok) {
        // Leave the tree clean on our local commit. --quit if --abort itself fails, so we
        // never return with a rebase still in progress.
        if (!git(vaultDir, ['rebase', '--abort']).ok) git(vaultDir, ['rebase', '--quit']);
        conflict = true;
        break;
      }
      continue; // rebased cleanly — retry push
    }
    offline = true; // network/auth — committed locally, will sync later
    break;
  }
  return { pushed, conflict, offline, lastErr };
}

function finishStatus(vaultDir, { pushed, conflict, offline, lastErr, remote }) {
  return writeStatus(vaultDir, {
    lastCommit: new Date().toISOString(),
    lastPush: pushed ? new Date().toISOString() : undefined,
    pending: pendingCount(vaultDir),
    offline: offline || undefined,
    conflict: conflict || undefined,
    hasRemote: remote,
    lastError: pushed ? undefined : (lastErr || '').slice(0, 200),
  });
}

// --- status ----------------------------------------------------------------

function writeStatus(vaultDir, patch) {
  const file = path.join(devnexusDir(vaultDir), SYNC_STATUS_FILE);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* fresh */ }
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); } catch { /* non-fatal */ }
  return next;
}

export function readSyncStatus(vaultDir) {
  const file = path.join(vaultDir, DEVNEXUS_DIR, SYNC_STATUS_FILE);
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

// --- public API ------------------------------------------------------------

/**
 * Refresh the vault from its remote (best-effort, fail-soft). Fast-forward only
 * so a read never creates a messy merge. Skips if sync is off, no remote, no
 * upstream, or the lock is busy. Returns a short status object.
 */
export async function syncRead(vaultDir, { sync } = {}) {
  if (sync === 'off' || !isGitRepo(vaultDir) || !gitHasRemote(vaultDir)) {
    return { pulled: false };
  }
  const got = await acquireLock(vaultDir, 0); // don't wait for reads
  if (!got) return { pulled: false, busy: true };
  try {
    const fetched = git(vaultDir, ['fetch', '--quiet']);
    if (!fetched.ok) {
      writeStatus(vaultDir, { offline: true, lastError: fetched.stderr.slice(0, 200) });
      return { pulled: false, offline: true };
    }
    const ff = git(vaultDir, ['merge', '--ff-only', '@{u}']);
    writeStatus(vaultDir, { lastPull: new Date().toISOString(), offline: false });
    return { pulled: ff.ok, diverged: !ff.ok };
  } finally {
    releaseLock(vaultDir);
  }
}

/**
 * Write to the vault under devnexus-owned sync.
 *
 * `writeFn()` performs the actual file change and returns the relative paths it
 * wrote. It must be safe to run after a reset to current remote state (it reads
 * the current tree and applies its change) so it can be replayed on a retry.
 *
 * Flow: lock -> pull --rebase --autostash -> writeFn -> commit (only its paths)
 * -> push with retry. On an unresolvable rebase we --abort, keep the local
 * commit, and report it — never leaving conflict markers in the tree.
 *
 * Always fail-soft: the local write succeeds even if git/push fails.
 */
export async function syncedWrite(vaultDir, { message, sync }, writeFn) {
  // Sync off or not a git repo -> plain write, today's behavior.
  if (sync === 'off' || !isGitRepo(vaultDir)) {
    const paths = writeFn() || [];
    return { paths, synced: false, committed: false, note: 'sync off' };
  }

  const got = await acquireLock(vaultDir, SYNC_LOCK_WAIT_MS);
  if (!got) {
    // Another syncer holds the lock — don't lose the write, just don't sync it.
    const paths = writeFn() || [];
    return { paths, synced: false, committed: false, note: 'sync busy — wrote locally' };
  }

  try {
    const remote = gitHasRemote(vaultDir);
    if (remote) safePull(vaultDir); // never leaves a conflicted rebase in the tree

    const paths = writeFn() || [];
    if (paths.length === 0) return { paths, synced: false, committed: false };

    git(vaultDir, ['add', '--', ...paths]);
    const commit = git(vaultDir, ['commit', '-m', message]);
    const committed = commit.ok || /nothing to commit/i.test(commit.stdout + commit.stderr);
    if (!commit.ok && !committed) {
      return { paths, synced: false, committed: false, note: commit.stderr.slice(0, 200) };
    }

    if (!remote) {
      writeStatus(vaultDir, { lastCommit: new Date().toISOString(), pending: pendingCount(vaultDir), hasRemote: false });
      return { paths, synced: false, committed: true, note: 'committed (no vault remote)' };
    }

    const r = pushWithRetry(vaultDir);
    const status = finishStatus(vaultDir, { ...r, remote: true });
    const note = r.pushed ? 'pushed'
      : r.conflict ? 'committed locally — vault conflict needs manual resolution'
      : 'committed locally — push deferred (offline/auth)';
    return { paths, synced: r.pushed, committed: true, conflict: r.conflict, offline: r.offline, note, pending: status.pending };
  } finally {
    releaseLock(vaultDir);
  }
}

/**
 * Commit and push whatever is currently dirty in the vault (the watcher path —
 * the file change already happened, e.g. a human saved in their editor).
 * Stages all changes (`.devnexus/` is gitignored, so lock/status files are
 * never committed). Same lock + pull + retry + fail-soft as syncedWrite.
 */
export async function syncDirty(vaultDir, { sync, message } = {}) {
  if (sync === 'off' || !isGitRepo(vaultDir)) return { committed: false, note: 'sync off' };

  const got = await acquireLock(vaultDir, SYNC_LOCK_WAIT_MS);
  if (!got) return { committed: false, busy: true, note: 'sync busy' };

  try {
    const remote = gitHasRemote(vaultDir);
    if (remote) safePull(vaultDir); // never leaves a conflicted rebase in the tree

    // Stage everything EXCEPT our own runtime state. .devnexus/ is gitignored in
    // real vaults, but exclude it explicitly so sync never commits the lock/lease/status.
    git(vaultDir, ['add', '-A', '--', '.', `:(exclude)${DEVNEXUS_DIR}`]);
    const clean = git(vaultDir, ['diff', '--cached', '--quiet']).ok; // ok => nothing staged

    if (clean) {
      // No new edits — but we may still have local commits to push (e.g. from an
      // earlier offline window).
      if (remote && pendingCount(vaultDir) > 0) {
        const r = pushWithRetry(vaultDir);
        finishStatus(vaultDir, { ...r, remote });
        return { committed: false, synced: r.pushed, note: r.pushed ? 'pushed pending commits' : 'nothing new' };
      }
      return { committed: false, clean: true, note: 'nothing to sync' };
    }

    const commit = git(vaultDir, ['commit', '-m', message || 'vault: sync edits']);
    if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      return { committed: false, note: commit.stderr.slice(0, 200) };
    }

    if (!remote) {
      finishStatus(vaultDir, { pushed: false, remote: false });
      return { committed: true, synced: false, note: 'committed (no vault remote)' };
    }

    const r = pushWithRetry(vaultDir);
    const status = finishStatus(vaultDir, { ...r, remote });
    const note = r.pushed ? 'pushed'
      : r.conflict ? 'committed locally — vault conflict needs manual resolution'
      : 'committed locally — push deferred (offline/auth)';
    return { committed: true, synced: r.pushed, conflict: r.conflict, offline: r.offline, note, pending: status.pending };
  } finally {
    releaseLock(vaultDir);
  }
}
