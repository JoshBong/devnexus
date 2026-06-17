import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { log } from '../lib/output.js';
import { requireConfig } from '../lib/config.js';
import { detectStack } from '../lib/detect-stack.js';
import { getPointerFilename, pointerExists } from '../lib/agents.js';
import { gitStatus, gitHasRemote, gitLastCommitTime, isGitRepo } from '../lib/git.js';
import { readSyncStatus } from '../lib/vault-sync.js';
import { TEMPLATE_VERSION, DRIFT_DAYS_THRESHOLD, DEFAULT_VAULT_SYNC } from '../constants.js';

export function statusCommand() {
  const cmd = new Command('status')
    .description('Show workspace health dashboard')
    .action(async () => {
      try {
        runStatus();
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

function runStatus() {
  const config = requireConfig();
  const { projectName, vaultName, repos = [], agents = [], templateVersion } = config;
  const issues = [];

  // Header
  console.log('');
  console.log(chalk.bold(`devnexus`) + chalk.dim(` | templates v${TEMPLATE_VERSION}`));
  console.log('');

  // Project info
  console.log(chalk.bold('Project: ') + projectName);

  // Vault status
  const vaultDir = path.resolve(vaultName);
  if (fs.existsSync(vaultDir)) {
    const status = isGitRepo(vaultDir) ? gitStatus(vaultDir) : 'no git';
    const hasRemote = isGitRepo(vaultDir) && gitHasRemote(vaultDir);
    const lastSync = isGitRepo(vaultDir) ? gitLastCommitTime(vaultDir) : null;

    let vaultInfo = `(git: ${status}`;
    if (hasRemote) vaultInfo += ', has remote';
    else issues.push({ msg: 'Vault has no git remote', fix: `cd ${vaultName} && git remote add origin <url>` });
    if (lastSync) vaultInfo += `, last commit: ${lastSync}`;
    vaultInfo += ')';

    console.log(chalk.bold('Vault:   ') + `${vaultName}/  ${chalk.dim(vaultInfo)}`);

    // devnexus-owned sync status
    const mode = config.vaultSync || DEFAULT_VAULT_SYNC;
    const sync = readSyncStatus(vaultDir);
    if (mode === 'off') {
      console.log(chalk.bold('Sync:    ') + chalk.dim('off (Obsidian Git / manual)'));
    } else if (sync) {
      let line;
      if (sync.conflict) line = chalk.red('conflict — needs manual resolution');
      else if (sync.offline || sync.pending > 0) line = chalk.yellow(`${sync.pending || 0} commit(s) pending push${sync.offline ? ' (offline)' : ''}`);
      else line = chalk.green('up to date');
      const when = sync.lastPush || sync.lastCommit;
      console.log(chalk.bold('Sync:    ') + line + (when ? chalk.dim(`  last: ${new Date(when).toLocaleString()}`) : ''));
      if (sync.conflict) issues.push({ msg: 'Vault has a sync conflict', fix: `cd ${vaultName} && git status` });
    } else {
      console.log(chalk.bold('Sync:    ') + chalk.dim('mcp (no activity yet)'));
    }
  } else {
    console.log(chalk.bold('Vault:   ') + chalk.red(`${vaultName}/ (MISSING)`));
    issues.push({ msg: `Vault directory '${vaultName}' not found`, fix: `devnexus init` });
  }

  // Workspace .ai-rules version
  const wsVersionFile = path.resolve('.ai-rules', 'version.txt');
  const wsVersion = fs.existsSync(wsVersionFile) ? fs.readFileSync(wsVersionFile, 'utf-8').trim() : null;
  if (!wsVersion) {
    issues.push({ msg: 'Workspace .ai-rules/ not found', fix: 'devnexus update' });
  } else if (wsVersion !== TEMPLATE_VERSION) {
    issues.push({ msg: `.ai-rules/ is at v${wsVersion} (latest: v${TEMPLATE_VERSION})`, fix: 'devnexus update' });
  }

  // Repos table
  console.log('');
  console.log(chalk.bold('Repos:'));

  if (repos.length === 0) {
    log.dim('  (no repos configured)');
  }

  for (const repoDir of repos) {
    const absDir = path.resolve(repoDir);

    if (!fs.existsSync(absDir)) {
      console.log(`  ${chalk.red(repoDir.padEnd(20))} ${chalk.red('MISSING')}`);
      issues.push({ msg: `Repo '${repoDir}' not found`, fix: `devnexus remove ${repoDir}` });
      continue;
    }

    // Version
    const versionFile = path.join(absDir, '.ai-rules', 'version.txt');
    const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf-8').trim() : null;
    const versionStr = version ? `v${version}` : chalk.red('no rules');

    if (!version) {
      issues.push({ msg: `${repoDir}/.ai-rules/ not found`, fix: 'devnexus update' });
    } else if (version !== TEMPLATE_VERSION) {
      issues.push({ msg: `${repoDir}/.ai-rules/ is at v${version} (latest: v${TEMPLATE_VERSION})`, fix: 'devnexus update' });
    }

    // Agent pointers
    const agentStatuses = agents.map(agent => {
      if (pointerExists(absDir, agent)) {
        return chalk.green(agent);
      } else {
        issues.push({
          msg: `${repoDir}/${getPointerFilename(agent)} missing`,
          fix: `devnexus agent add ${agent} --repo ${repoDir}`,
        });
        return chalk.red(`${agent}[missing]`);
      }
    });

    // Stack
    const stack = detectStack(absDir);

    console.log(
      `  ${repoDir.padEnd(20)} .ai-rules/ ${versionStr.padEnd(12)} ${agentStatuses.join(' ').padEnd(40)} ${chalk.dim(stack)}`
    );
  }

  // Index status
  if (config.lastIndexed) {
    const lastIndexed = new Date(config.lastIndexed);
    const daysSince = Math.floor((Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60 * 24));
    const stats = config.indexStats || {};
    let indexInfo = `last: ${lastIndexed.toLocaleDateString()}`;
    if (stats.symbols) indexInfo += `, ${stats.symbols} symbols, ${stats.communities} communities, ${stats.godNodes} god nodes`;
    if (daysSince > DRIFT_DAYS_THRESHOLD) {
      indexInfo += chalk.yellow(` (${daysSince}d ago — consider reindexing)`);
      issues.push({ msg: `Code graph index is ${daysSince} days old`, fix: 'devnexus index' });
    }
    console.log(chalk.bold('Index:   ') + chalk.dim(indexInfo));
  } else {
    console.log(chalk.bold('Index:   ') + chalk.dim('not built yet'));
    issues.push({ msg: 'No code graph index', fix: 'devnexus index' });
  }

  // Issues
  if (issues.length > 0) {
    console.log('');
    console.log(chalk.bold('Issues:'));
    for (const { msg, fix } of issues) {
      console.log(chalk.yellow(`  ! ${msg}`));
      if (fix) console.log(chalk.dim(`    Fix: ${fix}`));
    }
  } else {
    console.log('');
    console.log(chalk.green('  No issues found. Workspace is healthy.'));
  }

  console.log('');
}
