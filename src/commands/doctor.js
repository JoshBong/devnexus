import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { log } from '../lib/output.js';
import { requireConfig, writeConfig } from '../lib/config.js';
import { getPointerFilename, getAgentDisplay } from '../lib/agents.js';
import { isGitRepo, gitHasRemote } from '../lib/git.js';
import { ensureDir, addToGitignore, writeFile, writeAgentPointer } from '../lib/fs-helpers.js';
import { detectStack } from '../lib/detect-stack.js';
import { TEMPLATE_VERSION, GITIGNORE_ENTRIES, DRIFT_DAYS_THRESHOLD, NODES_DIR, NODE_INDEX_FILE } from '../constants.js';
import { hasIndex, readMeta } from '../lib/gitnexus-query.js';
import * as repoRules from '../templates/repo-rules.js';
import * as pointerTemplates from '../templates/pointers.js';

export function doctorCommand() {
  const cmd = new Command('doctor')
    .description('Diagnose workspace problems')
    .option('--fix', 'Auto-fix problems that have safe solutions')
    .action(async (opts) => {
      try {
        runDoctor(opts);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

function runDoctor(opts) {
  log.header('Workspace Doctor');

  const config = requireConfig();
  const { projectName, vaultName, repos = [], agents = [] } = config;
  // A config with no vaultName is broken (partial legacy parse, hand-edited file) —
  // report it instead of crashing on path.resolve(undefined) further down.
  if (!vaultName) {
    log.error('.workspace-config has no vaultName — the file is incomplete or corrupt.');
    log.plain('Fix it by hand or restore it from git.');
    process.exit(1);
  }

  let passes = 0;
  let warns = 0;
  let fails = 0;
  const fixes = [];

  function pass(msg) { log.pass(msg); passes++; }
  function warn(msg, fix) { log.warnCheck(msg); if (fix) log.fix(fix); warns++; }
  function fail(msg, fix, fixFn) {
    log.fail(msg);
    if (fix) log.fix(fix);
    fails++;
    if (fixFn) fixes.push({ msg, fn: fixFn });
  }

  // 1. Config
  console.log('');
  if (config.version) {
    pass('.workspace-config found and valid (JSON format)');
  } else if (config.migrated) {
    warn('.workspace-config is in legacy bash format', 'devnexus doctor --fix will migrate it to JSON');
    fixes.push({
      msg: 'Migrate config to JSON',
      fn: () => {
        delete config.migrated;
        writeConfig(config);
      },
    });
  }

  // 2. Vault
  const vaultDir = path.resolve(vaultName);
  if (fs.existsSync(vaultDir)) {
    // Support both old (ARCHITECTURE.md) and new (ARCHITECTURE_OVERVIEW.md + MOC.md) layouts
    const hasNewLayout = fs.existsSync(path.join(vaultDir, 'MOC.md'));
    // GRAPH_REPORT.md is deliberately NOT expected: it's v3-derived (local, per-branch,
    // gitignored) — a teammate who just cloned the vault legitimately has none until
    // `devnexus index`, and warning on it was a false alarm. (verify.js already excludes it.)
    const expectedFiles = hasNewLayout
      ? ['MOC.md', 'ARCHITECTURE_OVERVIEW.md', 'API_CONTRACTS.md', 'DECISIONS.md', 'SESSION_LOG.md']
      : ['ARCHITECTURE.md', 'API_CONTRACTS.md', 'DECISIONS.md', 'SESSION_LOG.md'];
    const missingVault = expectedFiles.filter(f => !fs.existsSync(path.join(vaultDir, f)));

    if (missingVault.length === 0) {
      pass('Vault exists with all expected files');
    } else {
      warn(`Vault missing: ${missingVault.join(', ')}`);
    }

    if (isGitRepo(vaultDir)) {
      if (gitHasRemote(vaultDir)) {
        pass('Vault has git remote configured');
      } else {
        warn('Vault has no git remote (sync will not work)', `cd ${vaultName} && git remote add origin <url>`);
      }
    } else {
      warn('Vault is not a git repository', `cd ${vaultName} && git init`);
    }
  } else {
    fail(`Vault directory '${vaultName}' not found`, 'devnexus init');
  }

  // 5. Workspace .ai-rules/
  const wsRulesDir = path.resolve('.ai-rules');
  if (fs.existsSync(wsRulesDir)) {
    const versionFile = path.join(wsRulesDir, 'version.txt');
    const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf-8').trim() : null;

    if (version === TEMPLATE_VERSION) {
      pass(`Workspace .ai-rules/ at v${TEMPLATE_VERSION}`);
    } else {
      fail(
        `.ai-rules/ at v${version || '?'} (latest: v${TEMPLATE_VERSION})`,
        'devnexus update'
      );
    }

    // Check expected files
    const expectedRules = ['01-session-start.md', '02-vault-rules.md', '03-contract-drift.md', '04-vault-brain-mcp.md'];
    const missingRules = expectedRules.filter(f => !fs.existsSync(path.join(wsRulesDir, f)));
    if (missingRules.length > 0) {
      fail(`Workspace .ai-rules/ missing: ${missingRules.join(', ')}`, 'devnexus update');
    }
  } else {
    fail('Workspace .ai-rules/ not found', 'devnexus update');
  }

  // 6. Workspace pointer files
  for (const agent of agents) {
    const filename = getPointerFilename(agent);
    const filePath = path.resolve(filename);
    if (fs.existsSync(filePath)) {
      pass(`${filename} exists (${getAgentDisplay(agent)})`);
    } else {
      fail(`${filename} missing (${getAgentDisplay(agent)})`, `devnexus agent add ${agent}`, () => {
        // inline agents get real rules, pointer agents get the stub (shared branch)
        writeAgentPointer({
          dir: process.cwd(), filename, agent,
          pointerContent: pointerTemplates.workspacePointer({ projectName, vaultName, repos }),
        });
      });
    }
  }

  // 7. Each repo
  for (const repoDir of repos) {
    const absDir = path.resolve(repoDir);
    console.log('');
    log.bold(`  ${repoDir}/`);

    if (!fs.existsSync(absDir)) {
      fail(`Directory not found`, `devnexus remove ${repoDir}`);
      continue;
    }

    // .ai-rules/
    const repoRulesDir = path.join(absDir, '.ai-rules');
    if (fs.existsSync(repoRulesDir)) {
      const vFile = path.join(repoRulesDir, 'version.txt');
      const v = fs.existsSync(vFile) ? fs.readFileSync(vFile, 'utf-8').trim() : null;
      if (v === TEMPLATE_VERSION) {
        pass(`.ai-rules/ at v${TEMPLATE_VERSION}`);
      } else {
        fail(`.ai-rules/ at v${v || '?'} (latest: v${TEMPLATE_VERSION})`, 'devnexus update');
      }
    } else {
      fail('.ai-rules/ not found', `devnexus update --repo ${repoDir}`, () => {
        const repoStack = detectStack(absDir);
        ensureDir(repoRulesDir);
        writeFile(path.join(repoRulesDir, '00-gate.md'), repoRules.gate());
        writeFile(path.join(repoRulesDir, '01-source-of-truth.md'), repoRules.sourceOfTruth({ projectName, repoStack, vaultName }));
        writeFile(path.join(repoRulesDir, '02-decision-logic.md'), repoRules.decisionLogic({ vaultName }));
        writeFile(path.join(repoRulesDir, '03-contract-drift.md'), repoRules.contractDrift({ vaultName }));
        writeFile(path.join(repoRulesDir, '04-code-intelligence.md'), repoRules.codeIntelligence());
        writeFile(path.join(repoRulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');
      });
    }

    // Pointer files
    for (const agent of agents) {
      const filename = getPointerFilename(agent);
      const filePath = path.join(absDir, filename);
      if (fs.existsSync(filePath)) {
        pass(`${filename} exists`);
      } else {
        const repoStack = detectStack(absDir);
        fail(`${filename} missing`, `devnexus agent add ${agent} --repo ${repoDir}`, () => {
          writeAgentPointer({
            dir: absDir, filename, agent,
            pointerContent: pointerTemplates.repoPointer({ repoDir, repoStack }),
          });
        });
      }
    }

    // .gitignore entries
    if (fs.existsSync(path.join(absDir, '.gitignore'))) {
      const gitignore = fs.readFileSync(path.join(absDir, '.gitignore'), 'utf-8');
      const missingEntries = GITIGNORE_ENTRIES.filter(e => !gitignore.includes(e));
      if (missingEntries.length === 0) {
        pass('.gitignore has all required entries');
      } else {
        warn(`.gitignore missing: ${missingEntries.join(', ')}`, 'devnexus doctor --fix');
        fixes.push({
          msg: `Add ${missingEntries.join(', ')} to ${repoDir}/.gitignore`,
          fn: () => {
            addToGitignore(absDir, missingEntries);
          },
        });
      }
    }

    // GitNexus index
    const gitNexusDir = path.join(absDir, '.gitnexus');
    const gitNexusMeta = path.join(gitNexusDir, 'meta.json');
    if (fs.existsSync(gitNexusMeta)) {
      try {
        const meta = JSON.parse(fs.readFileSync(gitNexusMeta, 'utf-8'));
        const { nodes = 0, relationships = 0 } = meta.stats || {};
        pass(`GitNexus index: ${nodes} nodes, ${relationships} edges`);
      } catch {
        warn('GitNexus index exists but meta.json is unreadable', `cd ${repoDir} && npx gitnexus analyze`);
      }
    } else {
      warn('No GitNexus index — agents lack blast-radius analysis', `cd ${repoDir} && npx gitnexus analyze`);
    }
  }

  // 8. Code graph index
  console.log('');
  log.bold('  Code Graph Index');

  if (config.lastIndexed) {
    const lastIndexed = new Date(config.lastIndexed);
    const daysSince = Math.floor((Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60 * 24));
    const stats = config.indexStats || {};

    if (daysSince <= DRIFT_DAYS_THRESHOLD) {
      pass(`Index built ${daysSince}d ago (${stats.symbols || '?'} symbols, ${stats.communities || '?'} communities)`);
    } else {
      warn(`Index is ${daysSince} days old — may be stale`, 'devnexus index');
    }

    // Check NODE_INDEX.md exists
    const nodeIndexPath = path.join(path.resolve(vaultName), NODE_INDEX_FILE);
    if (fs.existsSync(nodeIndexPath)) {
      pass('NODE_INDEX.md exists in vault');
    } else {
      fail('NODE_INDEX.md missing from vault', 'devnexus index');
    }

    // Check nodes/ directory
    const nodesPath = path.join(path.resolve(vaultName), NODES_DIR);
    if (fs.existsSync(nodesPath)) {
      const communityDirs = fs.readdirSync(nodesPath).filter(f => fs.statSync(path.join(nodesPath, f)).isDirectory());
      pass(`nodes/ has ${communityDirs.length} community directories`);
    } else {
      fail('nodes/ directory missing from vault', 'devnexus index');
    }

    // Check symbol count drift per repo
    if (stats.symbols) {
      for (const repoDir of repos) {
        const absDir = path.resolve(repoDir);
        if (!hasIndex(absDir)) continue;
        const meta = readMeta(absDir);
        if (!meta || !meta.stats) continue;
        const currentSymbols = meta.stats.nodes || 0;
        // Compare against last indexed (rough — total vs per-repo)
        // Just flag if GitNexus index is newer than our index
        if (meta.indexedAt && new Date(meta.indexedAt) > lastIndexed) {
          warn(`${repoDir}: GitNexus re-analyzed since last index`, 'devnexus index');
        }
      }
    }
  } else {
    warn('Code graph index not built yet', 'devnexus index');
  }

  // Vault-map.json registration
  console.log('');
  log.bold('  vault-map.json');
  const vaultMapPath = path.join(os.homedir(), '.claude', 'vault-map.json');
  if (fs.existsSync(vaultMapPath)) {
    try {
      const vaultMap = JSON.parse(fs.readFileSync(vaultMapPath, 'utf-8'));
      if (vaultMap[vaultName]) {
        pass(`${vaultName} registered in ~/.claude/vault-map.json`);
      } else {
        warn(`${vaultName} not in vault-map.json — vault-encoder hook won't inject context`, `Add to ~/.claude/vault-map.json: "${vaultName}": "${path.resolve(vaultName)}"`);
      }
    } catch {
      warn('vault-map.json exists but is not valid JSON');
    }
  } else {
    warn('~/.claude/vault-map.json not found — vault-encoder hook disabled');
  }

  // Summary
  console.log('');
  console.log(chalk.bold('Summary:'));
  console.log(`  ${chalk.green(passes + ' passed')}  ${chalk.yellow(warns + ' warnings')}  ${chalk.red(fails + ' failures')}`);

  // Auto-fix
  if (opts.fix && fixes.length > 0) {
    console.log('');
    log.bold('  Applying fixes...');
    for (const { msg, fn } of fixes) {
      try {
        fn();
        log.success(`Fixed: ${msg}`);
      } catch (err) {
        log.error(`Failed to fix: ${msg} — ${err.message}`);
      }
    }
  } else if (fixes.length > 0) {
    console.log('');
    log.plain(`${fixes.length} issue(s) can be auto-fixed. Run: devnexus doctor --fix`);
  }

  console.log('');
}
