import fs from 'fs';
import path from 'path';
import {
  DEVNEXUS_DIR,
  DEFAULT_VAULT_SYNC,
  WATCH_DEBOUNCE_MS,
  WATCH_PULL_INTERVAL_MS,
  WATCH_LEASE_HEARTBEAT_MS,
} from '../constants.js';
import { isGitRepo } from '../lib/git.js';
import { syncDirty, syncRead, acquireLease, refreshLease, releaseLease } from '../lib/vault-sync.js';

// Never react to git internals or our own runtime state (lock/lease/status live
// in .devnexus/, which is also gitignored — reacting to them would loop).
const IGNORED_TOP = new Set(['.git', DEVNEXUS_DIR]);

function isIgnored(filename) {
  if (!filename) return true;
  const top = filename.split(path.sep)[0];
  return IGNORED_TOP.has(top);
}

/**
 * Start the embedded vault watcher: commit+push human/tool edits (debounced) and
 * periodically pull others' changes. Singleton per vault via a lease — if another
 * process already watches, this returns null and does nothing.
 *
 * Returns { stop } or null. Caller must call stop() on shutdown.
 */
export async function startWatcher(ctx, { log = () => {} } = {}) {
  const { vaultDir, config } = ctx;
  const sync = config.vaultSync || DEFAULT_VAULT_SYNC;

  if (sync === 'off') { log('watcher: sync is off — not watching'); return null; }
  if (config.vaultWatch === false) { log('watcher: disabled by config'); return null; }
  if (!isGitRepo(vaultDir)) { log('watcher: vault is not a git repo — not watching'); return null; }

  if (!acquireLease(vaultDir)) {
    log('watcher: another process holds the lease — not watching');
    return null;
  }

  let stopped = false;
  let debounceTimer = null;

  const flush = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (stopped) return;
      try {
        const r = await syncDirty(vaultDir, { sync, message: 'vault: sync edits' });
        if (r.committed || r.synced) log(`watcher: ${r.note}`);
      } catch (err) {
        log(`watcher: sync error — ${err.message}`);
      }
    }, WATCH_DEBOUNCE_MS);
  };

  let watcher;
  try {
    watcher = fs.watch(vaultDir, { recursive: true }, (_evt, filename) => {
      if (stopped || isIgnored(filename)) return;
      flush();
    });
  } catch (err) {
    // Recursive fs.watch isn't available everywhere (older Linux). Fail soft —
    // the per-write MCP sync still works; only background human-edit sync is lost.
    log(`watcher: fs.watch unavailable (${err.message}) — falling back to interval pull only`);
    watcher = null;
  }

  // Catch-up: edits made while NO agent was running (so no watcher was live)
  // are still sitting dirty / unpushed. The next launch reconciles them — push
  // what piled up offline, pull what others changed. Fire-and-forget so server
  // startup isn't blocked on the network.
  (async () => {
    try {
      const d = await syncDirty(vaultDir, { sync, message: 'vault: catch-up (offline edits)' });
      if (d.committed || d.synced) log(`watcher: catch-up — ${d.note}`);
      await syncRead(vaultDir, { sync });
    } catch (err) {
      log(`watcher: catch-up error — ${err.message}`);
    }
  })();

  const pullTimer = setInterval(() => { if (!stopped) syncRead(vaultDir, { sync }); }, WATCH_PULL_INTERVAL_MS);
  const heartbeat = setInterval(() => { if (!stopped) refreshLease(vaultDir); }, WATCH_LEASE_HEARTBEAT_MS);
  // Don't let our timers keep the process alive past the MCP server's lifetime.
  pullTimer.unref?.();
  heartbeat.unref?.();

  log(watcher ? 'watcher: started' : 'watcher: started (interval-pull only)');

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(debounceTimer);
      clearInterval(pullTimer);
      clearInterval(heartbeat);
      try { watcher?.close(); } catch { /* already closed */ }
      releaseLease(vaultDir);
    },
  };
}
