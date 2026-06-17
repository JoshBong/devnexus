import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { log } from '../lib/output.js';
import { requireConfig } from '../lib/config.js';
import { explainSymbol } from '../lib/why.js';

export function whyCommand() {
  const cmd = new Command('why')
    .description('Explain why a symbol exists — the decisions and commits behind it')
    .argument('<symbol>', 'symbol name (function, class, or type)')
    .action((symbol) => {
      try {
        const config = requireConfig();
        const vaultDir = path.resolve(config.vaultName);
        printWhy(explainSymbol(vaultDir, symbol), symbol);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

function printWhy(r, symbol) {
  console.log('');
  console.log(chalk.bold(`Why: ${symbol}`));

  if (r.found) {
    let line = chalk.dim(`  ${r.file || '?'}`);
    if (r.community) line += chalk.dim(`  ·  ${r.community}`);
    console.log(line);
    if (r.isGod) console.log(chalk.yellow('  ⚠ god node — changes ripple widely'));
  } else if (r.indexed) {
    console.log(chalk.dim('  not found in the current index — check the name or run `devnexus index`'));
  } else {
    console.log(chalk.dim('  no code graph yet — run `devnexus index` for identity/risk context'));
  }

  console.log('');
  if (r.decisions.length === 0) {
    console.log(chalk.dim(`  No decisions logged for ${symbol} yet.`));
    console.log('');
    return;
  }

  console.log(chalk.bold(`  Decisions (${r.decisions.length}):`));
  for (const d of r.decisions) {
    console.log('');
    console.log(`  ${chalk.cyan(d.title)}  ${chalk.dim(`${d.date} · ${d.author} · ${d.status}`)}`);
    if (d.commits.length) console.log(chalk.dim(`    commits: ${d.commits.join(', ')}`));
    const snippet = (d.body || '').split('\n').filter(Boolean).slice(0, 2).join(' ');
    if (snippet) console.log(`    ${snippet.slice(0, 160)}`);
    console.log(chalk.dim(`    → ${d.file}`));
  }
  console.log('');
  console.log(chalk.dim('  For live callers/blast radius: gitnexus impact'));
  console.log('');
}
