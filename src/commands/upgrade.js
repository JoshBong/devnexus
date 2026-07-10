import { Command } from 'commander';
import { execSync } from 'child_process';
import { log } from '../lib/output.js';

export function upgradeCommand() {
  const cmd = new Command('upgrade')
    .description('Update devnexus to latest version and regenerate workspace rules')
    .option('--skip-rules', 'Only update the package, skip rule regeneration')
    .action(async (opts) => {
      try {
        await runUpgrade(opts);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runUpgrade(opts) {
  log.info('Updating devnexus...');

  try {
    const output = execSync('npm update -g devnexus', { encoding: 'utf-8', stdio: 'pipe' });
    if (output.trim()) console.log(output.trim());
    log.success('Package updated.');
  } catch (err) {
    log.error('Failed to update package. Try running: npm update -g devnexus');
    throw err;
  }

  if (opts.skipRules) {
    log.info('Skipping rule regeneration (--skip-rules).');
    return;
  }

  // Run devnexus update if inside a workspace
  const { readConfig } = await import('../lib/config.js');
  const config = readConfig();
  if (!config) {
    log.info('Not inside a workspace — package updated, no rules to regenerate.');
    return;
  }

  log.info('Regenerating workspace rules...');
  // Must run in a FRESH process. This process statically imported the OLD update.js at
  // startup, so a dynamic import('./update.js') here hits the ESM module cache and would
  // regenerate rules with the pre-upgrade templates/TEMPLATE_VERSION — a silent no-op for
  // the one case upgrade exists for. Shelling the just-installed `devnexus` binary loads
  // the new code.
  try {
    execSync('devnexus update --force', { stdio: 'inherit' });
  } catch {
    log.error("Rules not regenerated. Run 'devnexus update --force' in your workspace.");
  }
}
