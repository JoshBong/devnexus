import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { log, createSpinner } from '../lib/output.js';
import { requireConfig, writeConfig } from '../lib/config.js';
import { detectStack } from '../lib/detect-stack.js';
import { getPointerFilename, getAgentDisplay } from '../lib/agents.js';
import { gitClone, isGitUrl, repoDirFromUrl } from '../lib/git.js';
import { ensureDir, addToGitignore, writeFile, writeAgentPointer } from '../lib/fs-helpers.js';
import { TEMPLATE_VERSION, GITIGNORE_ENTRIES } from '../constants.js';
import { installContractHook, installGitNexusHook, installGitNexusPostMergeHook } from '../lib/hooks.js';
import * as repoRules from '../templates/repo-rules.js';
import * as pointerTemplates from '../templates/pointers.js';

export function addCommand() {
  const cmd = new Command('add')
    .description('Add repo(s) to an existing workspace (HTTPS, SSH, or local folder)')
    .argument('<repos...>', 'Repo URLs or folder names to add')
    .option('--no-clone', 'Skip git clone, just configure existing directories')
    .action(async (repos, opts) => {
      try {
        await runAdd(repos, opts);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runAdd(repos, opts) {
  const config = requireConfig();
  const { projectName, vaultName, agents = [], repos: existingRepos = [] } = config;
  const workspaceDir = process.cwd();
  let added = 0;

  // Warn early if vault is missing
  const vaultDir = path.join(workspaceDir, vaultName);
  if (!fs.existsSync(vaultDir)) {
    log.warn(`Vault '${vaultName}' not found — MOC.md and SESSION_LOG.md will not be updated.`);
    log.warn(`Run 'devnexus init' first if this is a new workspace.`);
  }

  for (const repo of repos) {
    const isUrl = isGitUrl(repo);
    const isAbsPath = path.isAbsolute(repo);
    const dirName = isUrl ? repoDirFromUrl(repo) : isAbsPath ? path.basename(repo) : repo;

    // Check if already tracked
    if (existingRepos.includes(dirName)) {
      log.warn(`${dirName} is already in the workspace config — skipping`);
      continue;
    }

    // Clone if URL
    if (isUrl && opts.clone !== false) {
      const targetPath = path.join(workspaceDir, dirName);
      if (!fs.existsSync(targetPath)) {
        const cs = createSpinner(`Cloning ${dirName}...`).start();
        try {
          gitClone(repo, workspaceDir);
          cs.succeed(`Cloned ${dirName}`);
        } catch (err) {
          cs.fail(`Failed to clone ${repo}: ${err.message}`);
          continue;
        }
      }
    }

    // For absolute paths, symlink into workspace if not already present
    if (isAbsPath) {
      if (!fs.existsSync(repo)) {
        log.error(`Path '${repo}' not found — skipping`);
        continue;
      }
      const targetPath = path.join(workspaceDir, dirName);
      if (!fs.existsSync(targetPath)) {
        fs.symlinkSync(repo, targetPath, 'dir');
      }
    }

    // Validate directory exists
    const absDir = path.join(workspaceDir, dirName);
    if (!fs.existsSync(absDir)) {
      log.error(`Directory '${dirName}' not found — skipping`);
      continue;
    }

    // Configure repo
    const s = createSpinner(`Configuring ${dirName}...`).start();
    const repoStack = detectStack(absDir);

    const rulesDir = path.join(absDir, '.ai-rules');
    ensureDir(rulesDir);
    writeFile(path.join(rulesDir, '00-gate.md'), repoRules.gate());
    writeFile(path.join(rulesDir, '01-source-of-truth.md'), repoRules.sourceOfTruth({ projectName, repoStack, vaultName }));
    writeFile(path.join(rulesDir, '02-decision-logic.md'), repoRules.decisionLogic({ vaultName }));
    writeFile(path.join(rulesDir, '03-contract-drift.md'), repoRules.contractDrift({ vaultName }));
    writeFile(path.join(rulesDir, '04-code-intelligence.md'), repoRules.codeIntelligence());
    writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');

    installContractHook(absDir, vaultName);
    installGitNexusHook(absDir);
    installGitNexusPostMergeHook(absDir);

    for (const agent of agents) {
      // Inline agents (cursor/windsurf/generic) get the concatenated rules in managed
      // fences, not a pointer stub they don't follow — same branch init/update take.
      writeAgentPointer({
        dir: absDir,
        filename: getPointerFilename(agent),
        agent,
        pointerContent: pointerTemplates.repoPointer({ repoDir: dirName, repoStack }),
      });
    }

    addToGitignore(absDir, GITIGNORE_ENTRIES);
    s.succeed(`Configured ${dirName}`);

    // Run GitNexus if available
    try {
      execSync('npx gitnexus --version', { stdio: 'pipe', timeout: 5000 });
      const gs = createSpinner(`Indexing ${dirName}...`).start();
      try {
        execSync('npx gitnexus analyze', { cwd: absDir, stdio: 'pipe', timeout: 120000 });
        gs.succeed(`Indexed ${dirName}`);
      } catch {
        gs.fail(`GitNexus indexing failed for ${dirName} — run manually: npx gitnexus analyze`);
      }
    } catch { /* not installed, skip silently */ }

    // Update MOC.md
    const mocPath = path.join(workspaceDir, vaultName, 'MOC.md');
    if (fs.existsSync(mocPath)) {
      let moc = fs.readFileSync(mocPath, 'utf-8');
      const newRow = `| [[${dirName}]] | Active | |`;
      if (moc.includes('| (add repos) | Active | |')) {
        moc = moc.replace('| (add repos) | Active | |', `${newRow}\n| (add repos) | Active | |`);
      } else {
        moc = moc.replace(/(## Active Repos[\s\S]*?\|[-| ]+\|)\n/, `$1\n${newRow}\n`);
      }
      fs.writeFileSync(mocPath, moc, 'utf-8');
    }

    // Update SESSION_LOG.md
    const sessionLogPath = path.join(workspaceDir, vaultName, 'SESSION_LOG.md');
    if (fs.existsSync(sessionLogPath)) {
      const date = new Date().toISOString().split('T')[0];
      const entry = `\n## ${date} — Added repo: ${dirName}\n\nAdded ${dirName} to workspace. Configured .ai-rules/, contract drift hook, and agent pointer files.\n`;
      let sessionLog = fs.readFileSync(sessionLogPath, 'utf-8');
      sessionLog = sessionLog.replace('\n(No sessions logged yet.)', '');
      fs.writeFileSync(sessionLogPath, sessionLog.trimEnd() + '\n' + entry, 'utf-8');
    }

    existingRepos.push(dirName);
    added++;
  }

  if (added > 0) {
    config.repos = existingRepos;
    writeConfig(config);
    console.log('');
    console.log(chalk.green.bold(`  ✔ Added ${added} repo${added !== 1 ? 's' : ''}`));
    console.log('');
  }

}
