import { Command } from 'commander';
import path from 'path';
import { log } from '../lib/output.js';
import { requireConfig } from '../lib/config.js';
import { syncDirty } from '../lib/vault-sync.js';
import { DEFAULT_VAULT_SYNC } from '../constants.js';

export function syncCommand() {
  const cmd = new Command('sync')
    .description('Commit & push vault changes — one-shot by default, or --watch')
    .option('--watch', 'watch the vault and sync on every change (foreground)')
    .action(async (opts) => {
      try {
        const config = requireConfig();
        const vaultDir = path.resolve(config.vaultName);
        const sync = config.vaultSync || DEFAULT_VAULT_SYNC;

        if (opts.watch) {
          const { startWatcher } = await import('../mcp/watcher.js');
          const w = await startWatcher({ vaultDir, config }, { log: (m) => log.dim(m) });
          if (!w) {
            log.warn('Watcher not started (sync off, lease already held, or vault is not a git repo).');
            return;
          }
          log.success('Watching vault for changes — Ctrl-C to stop.');
          const stop = () => { w.stop(); process.exit(0); };
          process.on('SIGINT', stop);
          process.on('SIGTERM', stop);
          await new Promise(() => {}); // run until interrupted
        } else {
          const r = await syncDirty(vaultDir, { sync, message: 'vault: manual sync' });
          log.success(`Sync: ${r.note || (r.committed ? 'committed' : 'nothing to sync')}`);
        }
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}
