import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { log, createSpinner } from '../lib/output.js';
import { verifyBuild, applyFixes } from '../lib/verify.js';
import { writeConfig, readConfig } from '../lib/config.js';
import { detectStack } from '../lib/detect-stack.js';
import { validateAgents, getPointerFilename, getAgentDisplay, isInlineAgent } from '../lib/agents.js';
import { gitClone, gitInit, gitAddAll, gitCommit, isGitRepo, isGitUrl, repoDirFromUrl } from '../lib/git.js';
import { ensureDir, addToGitignore, writeFile, writeFileIfNotExists, migrateExistingPointer, concatenateRules, extractGitNexusBlock, writeManagedPointer } from '../lib/fs-helpers.js';
import { promptProjectInfo, promptRepos, promptAgents, promptExistingVault } from '../lib/prompts.js';
import { TEMPLATE_VERSION, GITIGNORE_ENTRIES, DECISIONS_DIR, PRACTICES_DIR, HANDOFFS_DIR, DEFAULT_VAULT_SYNC, DEFAULT_VAULT_WATCH } from '../constants.js';
import { writeMcpConfig } from '../lib/mcp-config.js';
import * as vaultTemplates from '../templates/vault.js';
import * as obsidianTemplates from '../templates/obsidian.js';
import * as workspaceRules from '../templates/workspace-rules.js';
import * as repoRules from '../templates/repo-rules.js';
import * as pointers from '../templates/pointers.js';
import { installContractHook, installGitNexusHook, installGitNexusPostMergeHook } from '../lib/hooks.js';

export function initCommand() {
  const cmd = new Command('init')
    .description('Set up a new AI-augmented workspace')
    .option('--name <name>', 'Project name')
    .option('--repos <repos...>', 'Repo URLs or folder names')
    .option('--agents <agents...>', 'AI agents to configure (claude, cursor, codex, windsurf)')
    .option('--desc <description>', 'Project description')
    .option('--stack <stack>', 'Tech stack description')
    .option('--author <name>', 'Your name (for attribution)')
    .option('--no-clone', 'Skip git clone, just configure existing directories')
    .option('--dry-run', 'Show what would be created without creating it')
    .action(async (opts) => {
      try {
        await runInit(opts);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runInit(opts) {
  log.header('AI-Augmented Workspace Setup');

  const existing = readConfig();
  if (existing) {
    log.warn('This directory already has a .workspace-config.');
    log.warn("Use 'devnexus update' to refresh rules, or 'devnexus add' to add repos.");
    process.exit(1);
  }

  const isInteractive = !opts.name;
  const workspaceDir = process.cwd();

  // Check for existing vault (join flow)
  if (isInteractive) {
    const vaultSource = await promptExistingVault();
    if (vaultSource) {
      // --dry-run must not mutate: runJoin clones repos, writes rules/pointers/config and
      // installs hooks. The dryRun check further down only guards the fresh-workspace flow,
      // so gate the join here too.
      if (opts.dryRun) {
        log.info(`[dry run] Would JOIN the existing vault at ${vaultSource}:`);
        log.info('  clone its repos, write .ai-rules/ + agent pointers, .workspace-config, MCP config, and git hooks.');
        return;
      }
      await runJoin(vaultSource, workspaceDir, opts);
      return;
    }
  }

  // Fresh workspace flow
  let projectName, description, techStack, author, repoInputs, agents;

  if (isInteractive) {
    const info = await promptProjectInfo();
    projectName = info.projectName;
    description = opts.desc || `${projectName} workspace`;
    author = info.author;

    repoInputs = await promptRepos();
    agents = await promptAgents();

    // Auto-detect tech stack from repos
    techStack = autoDetectTechStack(repoInputs, workspaceDir);
  } else {
    projectName = opts.name;
    description = opts.desc || 'A software project.';
    author = opts.author || 'Engineer';
    repoInputs = opts.repos || [];
    techStack = opts.stack || autoDetectTechStack(repoInputs, workspaceDir);

    const agentInput = opts.agents || ['claude'];
    const { valid, invalid } = validateAgents(agentInput);
    for (const inv of invalid) log.warn(`Unknown agent '${inv}' — skipping`);
    agents = valid.length > 0 ? valid : ['claude'];
  }

  const vaultName = `${projectName}-vault`;
  const date = new Date().toISOString().split('T')[0];

  if (opts.dryRun) {
    printDryRun({ projectName, vaultName, repoInputs, agents, workspaceDir });
    return;
  }

  console.log('');

  // Phase 1: Vault
  let s = createSpinner('Creating vault...').start();
  createVault({ vaultName, projectName, description, techStack, author, date, workspaceDir, repos: [] });
  s.succeed('Creating vault...');

  // Phase 2: Repos
  s = createSpinner('Setting up repos...').start();
  const repoDirs = [];
  for (const repo of repoInputs) {
    const dir = await setupRepo(repo, workspaceDir, opts.clone);
    if (dir) repoDirs.push(dir);
  }
  s.succeed('Setting up repos...');

  // Phase 3: Rules
  s = createSpinner('Writing workspace rules...').start();
  createWorkspaceRules(vaultName, workspaceDir);
  createWorkspacePointers({ projectName, vaultName, repoDirs, agents, workspaceDir });
  for (const repoDir of repoDirs) {
    setupRepoFiles({ repoDir, projectName, vaultName, agents, workspaceDir });
  }
  s.succeed('Writing workspace rules...');

  // Phase 4: Agents
  s = createSpinner('Configuring agents...').start();
  writeConfig({
    projectName,
    vaultName,
    repos: repoDirs,
    agents,
    techStack,
    description,
    author,
    templateVersion: TEMPLATE_VERSION,
    vaultSync: DEFAULT_VAULT_SYNC,
    vaultWatch: DEFAULT_VAULT_WATCH,
  });
  s.succeed('Configuring agents...');
  setupMcp(workspaceDir, agents);

  // Phase 5: Nexus registration
  s = createSpinner('Engaging nexus...').start();
  registerVaultMap(vaultName, path.join(workspaceDir, vaultName));
  s.succeed('Engaging nexus...');

  // Phase 6: GitNexus (interactive — stays verbose)
  await checkGitNexus(repoDirs, workspaceDir);

  // Workspace ready
  console.log('');
  console.log(chalk.green.bold('  ✔ Workspace ready'));
  console.log('');
  console.log(`    Project:  ${projectName}`);
  console.log(`    Vault:    ${vaultName}/`);
  console.log(`    Repos:    ${repoDirs.length > 0 ? repoDirs.join(', ') : '(none)'}`);
  console.log(`    Agents:   ${agents.map(a => getAgentDisplay(a)).join(', ')}`);

  // Phase 7: Verify
  console.log('');
  s = createSpinner('Verifying build...').start();
  const results = verifyBuild({
    projectName, vaultName, repos: repoDirs, agents,
  });

  if (results.fixes.length > 0) {
    const { fixed, failed } = applyFixes(results);
    if (failed.length === 0) {
      s.succeed(`Build verified — ${fixed} issue${fixed !== 1 ? 's' : ''} auto-fixed`);
      for (const fix of results.fixes) {
        console.log(chalk.green(`    ✔ Fixed: ${fix.msg}`));
      }
    } else {
      s.fail(`Build incomplete — ${failed.length} issue${failed.length !== 1 ? 's' : ''} need${failed.length === 1 ? 's' : ''} attention`);
      for (const f of failed) {
        console.log(chalk.red(`    ✘ ${f.msg} — ${f.error}`));
      }
    }
  } else if (results.fails > 0) {
    s.fail(`Build incomplete — ${results.fails} issue${results.fails !== 1 ? 's' : ''} need${results.fails === 1 ? 's' : ''} attention`);
    for (const issue of results.issues.filter(i => i.level === 'fail')) {
      console.log(chalk.red(`    ✘ ${issue.msg}`));
    }
    console.log('');
    console.log(`    After fixing, run: ${chalk.cyan('devnexus doctor')}`);
  } else {
    s.succeed(`Build verified — 0 issues`);
  }

  // Next steps
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Open ${chalk.bold(vaultName + '/')} in Obsidian`);
  console.log('    2. Start your AI agent — it reads the vault automatically');
  console.log('');
  console.log(chalk.dim('    Docs: https://github.com/JoshBong/devnexus/tree/main/docs'));
  console.log('');
}

async function runJoin(vaultSource, workspaceDir, opts) {
  log.header('Joining Existing Workspace');

  const isUrl = isGitUrl(vaultSource);
  let vaultName;

  if (isUrl) {
    vaultName = repoDirFromUrl(vaultSource);
    const targetPath = path.join(workspaceDir, vaultName);

    if (!fs.existsSync(targetPath)) {
      try {
        gitClone(vaultSource, workspaceDir);
      } catch (err) {
        log.error(`Failed to clone vault: ${err.message}`);
        process.exit(1);
      }
    }
  } else {
    vaultName = vaultSource;
    if (!fs.existsSync(path.join(workspaceDir, vaultName))) {
      log.error(`Vault folder '${vaultName}' not found in ${workspaceDir}`);
      process.exit(1);
    }
  }

  // Verify it's actually a vault (has MOC.md)
  const vaultDir = path.join(workspaceDir, vaultName);
  if (!fs.existsSync(path.join(vaultDir, 'MOC.md'))) {
    log.error(`${vaultName} doesn't look like a devnexus vault (no MOC.md found)`);
    process.exit(1);
  }

  // Derive project name from vault name (strip -vault suffix)
  const projectName = vaultName.endsWith('-vault')
    ? vaultName.slice(0, -6)
    : vaultName;

  const { author } = await inquirer.prompt([
    {
      type: 'input',
      name: 'author',
      message: "What's your name? (for decision log attribution)",
      default: 'Engineer',
    },
  ]);

  const repoInputs = await promptRepos();
  const repoDirs = [];
  for (const repo of repoInputs) {
    const dir = await setupRepo(repo, workspaceDir, opts.clone);
    if (dir) repoDirs.push(dir);
  }

  if (repoDirs.length === 0 && repoInputs.length > 0) {
    log.warn('No repos were set up successfully.');
  }

  const agents = await promptAgents();

  console.log('');

  // Phase: Rules + agents
  let s = createSpinner('Writing workspace rules...').start();
  createWorkspaceRules(vaultName, workspaceDir);
  createWorkspacePointers({ projectName, vaultName, repoDirs, agents, workspaceDir });
  for (const repoDir of repoDirs) {
    setupRepoFiles({ repoDir, projectName, vaultName, agents, workspaceDir });
  }
  s.succeed('Writing workspace rules...');

  s = createSpinner('Configuring agents...').start();
  const techStack = autoDetectTechStack(repoDirs, workspaceDir);
  writeConfig({
    projectName,
    vaultName,
    repos: repoDirs,
    agents,
    techStack,
    description: `Joined ${projectName} workspace`,
    author,
    templateVersion: TEMPLATE_VERSION,
    vaultSync: DEFAULT_VAULT_SYNC,
    vaultWatch: DEFAULT_VAULT_WATCH,
  });
  s.succeed('Configuring agents...');
  setupMcp(workspaceDir, agents);

  s = createSpinner('Engaging nexus...').start();
  registerVaultMap(vaultName, vaultDir);
  s.succeed('Engaging nexus...');

  await checkGitNexus(repoDirs, workspaceDir);

  // Summary
  console.log('');
  console.log(chalk.green.bold('  ✔ Workspace ready'));
  console.log('');
  console.log(`    Project:  ${projectName}`);
  console.log(`    Vault:    ${vaultName}/ (existing — not modified)`);
  console.log(`    Repos:    ${repoDirs.length > 0 ? repoDirs.join(', ') : '(none)'}`);
  console.log(`    Agents:   ${agents.map(a => getAgentDisplay(a)).join(', ')}`);

  // Verify
  console.log('');
  s = createSpinner('Verifying build...').start();
  const results = verifyBuild({ projectName, vaultName, repos: repoDirs, agents });

  if (results.fixes.length > 0) {
    const { fixed, failed } = applyFixes(results);
    if (failed.length === 0) {
      s.succeed(`Build verified — ${fixed} issue${fixed !== 1 ? 's' : ''} auto-fixed`);
      for (const fix of results.fixes) {
        console.log(chalk.green(`    ✔ Fixed: ${fix.msg}`));
      }
    } else {
      s.fail(`Build incomplete — ${failed.length} issue${failed.length !== 1 ? 's' : ''} need${failed.length === 1 ? 's' : ''} attention`);
      for (const f of failed) {
        console.log(chalk.red(`    ✘ ${f.msg} — ${f.error}`));
      }
    }
  } else if (results.fails > 0) {
    s.fail(`Build incomplete — ${results.fails} issue${results.fails !== 1 ? 's' : ''} need${results.fails === 1 ? 's' : ''} attention`);
    for (const issue of results.issues.filter(i => i.level === 'fail')) {
      console.log(chalk.red(`    ✘ ${issue.msg}`));
    }
    console.log('');
    console.log(`    After fixing, run: ${chalk.cyan('devnexus doctor')}`);
  } else {
    s.succeed('Build verified — 0 issues');
  }

  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Open ${chalk.bold(vaultName + '/')} in Obsidian`);
  console.log('    2. Start your AI agent — it reads the vault automatically');
  console.log('');
  console.log(chalk.dim('    Docs: https://github.com/JoshBong/devnexus/tree/main/docs'));
  console.log('');
}

function autoDetectTechStack(repoInputs, workspaceDir) {
  const stacks = new Set();
  for (const repo of repoInputs) {
    const dirName = isGitUrl(repo) ? repoDirFromUrl(repo) : path.basename(repo);
    const absPath = path.join(workspaceDir, dirName);
    if (fs.existsSync(absPath)) {
      const detected = detectStack(absPath);
      if (detected !== 'a software project') {
        stacks.add(detected);
      }
    }
  }
  return stacks.size > 0 ? [...stacks].join(', ') : 'Not detected';
}

async function setupRepo(repo, workspaceDir, shouldClone) {
  const isUrl = isGitUrl(repo);

  if (isUrl && shouldClone !== false) {
    const dirName = repoDirFromUrl(repo);
    const targetPath = path.join(workspaceDir, dirName);

    if (fs.existsSync(targetPath)) return dirName;

    try {
      gitClone(repo, workspaceDir);
      return dirName;
    } catch {
      return null;
    }
  } else {
    const dirName = isUrl ? repoDirFromUrl(repo) : repo;
    if (fs.existsSync(path.join(workspaceDir, dirName))) return dirName;
    return null;
  }
}

function createVault({ vaultName, projectName, description, techStack, author, date, workspaceDir, repos }) {
  const vaultDir = path.join(workspaceDir, vaultName);

  ensureDir(vaultDir);
  ensureDir(path.join(vaultDir, '.obsidian'));
  ensureDir(path.join(vaultDir, '.obsidian', 'plugins', 'obsidian-git'));
  ensureDir(path.join(vaultDir, 'archive'));

  // Obsidian config
  writeFile(path.join(vaultDir, '.obsidian', 'app.json'), obsidianTemplates.appJson());
  writeFile(path.join(vaultDir, '.obsidian', 'core-plugins.json'), obsidianTemplates.corePlugins());
  writeFile(path.join(vaultDir, '.obsidian', 'community-plugins.json'), obsidianTemplates.communityPlugins());
  writeFile(path.join(vaultDir, '.obsidian', 'plugins', 'obsidian-git', 'data.json'), obsidianTemplates.gitPluginData({ mcpSync: true }));
  writeFile(path.join(vaultDir, '.obsidian', 'appearance.json'), obsidianTemplates.appearance());
  writeFile(path.join(vaultDir, '.gitignore'), obsidianTemplates.vaultGitignore());

  // Vault content
  writeFile(path.join(vaultDir, 'MOC.md'), vaultTemplates.moc({ projectName, vaultName, repos: repos || [], date }));
  writeFile(path.join(vaultDir, 'ARCHITECTURE_OVERVIEW.md'), vaultTemplates.architecture({ projectName, description, techStack, date }));
  writeFile(path.join(vaultDir, 'API_CONTRACTS.md'), vaultTemplates.apiContracts({ date }));
  writeFile(path.join(vaultDir, 'DECISIONS.md'), vaultTemplates.decisions({ date, author }));
  ensureDir(path.join(vaultDir, DECISIONS_DIR));
  writeFile(path.join(vaultDir, DECISIONS_DIR, 'README.md'), vaultTemplates.decisionsReadme());
  writeFile(path.join(vaultDir, 'SESSION_LOG.md'), vaultTemplates.sessionLog());

  // Practices — code conventions served to agents via the MCP `practices` tool
  ensureDir(path.join(vaultDir, PRACTICES_DIR));
  writeFile(path.join(vaultDir, PRACTICES_DIR, 'README.md'), vaultTemplates.practicesReadme());
  for (const area of ['frontend', 'auth', 'api']) {
    writeFileIfNotExists(path.join(vaultDir, PRACTICES_DIR, `${area}.md`), vaultTemplates.practiceStarter(area));
  }
  // Handoffs — structured session handoffs (MCP `log_handoff` also appends to SESSION_LOG)
  ensureDir(path.join(vaultDir, HANDOFFS_DIR));
  writeFile(path.join(vaultDir, 'GRAPH_REPORT.md'), vaultTemplates.graphReport({ projectName, date }));

  // Init git in vault
  if (!isGitRepo(vaultDir)) {
    gitInit(vaultDir);
    gitAddAll(vaultDir);
    try {
      gitCommit(vaultDir, 'vault: initial setup');
    } catch { /* git signing may not be configured — non-fatal */ }
  }
}

function createWorkspaceRules(vaultName, workspaceDir) {
  const rulesDir = path.join(workspaceDir, '.ai-rules');
  ensureDir(rulesDir);

  writeFile(path.join(rulesDir, '01-session-start.md'), workspaceRules.sessionStart({ vaultName }));
  writeFile(path.join(rulesDir, '02-vault-rules.md'), workspaceRules.vaultRules({ vaultName }));
  writeFile(path.join(rulesDir, '03-contract-drift.md'), workspaceRules.contractDrift({ vaultName }));
  writeFile(path.join(rulesDir, '04-vault-brain-mcp.md'), workspaceRules.mcpRules());
  writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');
}

function setupMcp(workspaceDir, agents) {
  const { written, instructions } = writeMcpConfig(workspaceDir, agents);
  for (const w of written) {
    log.success(`MCP registered for ${getAgentDisplay(w.agent)} → ${w.file} (${w.status})`);
  }
  for (const ins of instructions) {
    log.warn(`MCP for ${getAgentDisplay(ins.agent)} needs manual setup:`);
    log.dim(ins.text);
  }
}

function createWorkspacePointers({ projectName, vaultName, repoDirs, agents, workspaceDir }) {
  const rulesDir = path.join(workspaceDir, '.ai-rules');

  for (const agent of agents) {
    const filename = getPointerFilename(agent);
    const filePath = path.join(workspaceDir, filename);

    if (isInlineAgent(agent)) {
      const rules = concatenateRules(rulesDir);
      writeManagedPointer(filePath, rules);
    } else {
      const content = pointers.workspacePointer({ projectName, vaultName, repos: repoDirs });
      if (!writeFileIfNotExists(filePath, content)) {
        if (migrateExistingPointer(filePath, rulesDir)) {
          writeFile(filePath, content);
        }
      }
    }
  }
}

function setupRepoFiles({ repoDir, projectName, vaultName, agents, workspaceDir }) {
  const absRepoDir = path.join(workspaceDir, repoDir);
  if (!fs.existsSync(absRepoDir)) return;

  const repoStack = detectStack(absRepoDir);

  const rulesDir = path.join(absRepoDir, '.ai-rules');
  ensureDir(rulesDir);

  writeFile(path.join(rulesDir, '00-gate.md'), repoRules.gate());
  writeFile(path.join(rulesDir, '01-source-of-truth.md'), repoRules.sourceOfTruth({ projectName, repoStack, vaultName }));
  writeFile(path.join(rulesDir, '02-decision-logic.md'), repoRules.decisionLogic({ vaultName }));
  writeFile(path.join(rulesDir, '03-contract-drift.md'), repoRules.contractDrift({ vaultName }));
  writeFile(path.join(rulesDir, '04-code-intelligence.md'), repoRules.codeIntelligence());
  writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');

  // Install contract drift pre-push hook
  installContractHook(absRepoDir, vaultName);
  installGitNexusHook(absRepoDir);
  installGitNexusPostMergeHook(absRepoDir);

  const repoRulesDir = path.join(absRepoDir, '.ai-rules');
  for (const agent of agents) {
    const filename = getPointerFilename(agent);
    const filePath = path.join(absRepoDir, filename);

    if (isInlineAgent(agent)) {
      const rules = concatenateRules(repoRulesDir);
      const gnBlock = extractGitNexusBlock(path.join(absRepoDir, 'CLAUDE.md'));
      const fullContent = gnBlock ? `${rules}\n\n${gnBlock}` : rules;
      writeManagedPointer(filePath, fullContent);
    } else {
      const content = pointers.repoPointer({ repoDir, repoStack });
      if (!writeFileIfNotExists(filePath, content)) {
        if (migrateExistingPointer(filePath, repoRulesDir)) {
          writeFile(filePath, content);
        }
      }
    }
  }

  addToGitignore(absRepoDir, GITIGNORE_ENTRIES);
}

async function checkGitNexus(repoDirs, workspaceDir) {
  console.log('');
  let hasGitNexus = false;
  try {
    execSync('npx gitnexus --version', { stdio: 'pipe', timeout: 10000 });
    hasGitNexus = true;
  } catch { /* not available */ }

  if (!hasGitNexus) {
    console.log('');
    log.plain('GitNexus is required — it powers the code graph (blast radius, flows, safe renames, god nodes).');
    // Non-TTY (CI / flag-driven scripting): don't hang on a confirm no one can answer —
    // and by this point the vault/rules are already written, so a hang here strands a
    // half-initialized workspace. Fail fast with the fix.
    if (!process.stdin.isTTY) {
      log.error('GitNexus not found and this session is non-interactive. Install it and re-run:');
      log.plain('  npm install -g gitnexus');
      process.exit(1);
    }
    const { install } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'install',
        message: 'GitNexus not found. Install it now? (required)',
        default: true,
      },
    ]);

    if (!install) {
      log.error('GitNexus is required to use devnexus. Install it and re-run:');
      log.plain('  npm install -g gitnexus');
      process.exit(1);
    }

    const is = createSpinner('Installing GitNexus...').start();
    try {
      execSync('npm install -g gitnexus', { stdio: 'pipe', timeout: 120000 });
      is.succeed('GitNexus installed');
      hasGitNexus = true;
    } catch {
      is.fail('GitNexus install failed');
      log.error('GitNexus is required. Install it manually and re-run: npm install -g gitnexus');
      process.exit(1);
    }
  }

  if (hasGitNexus) {
    for (const repoDir of repoDirs) {
      const abs = path.join(workspaceDir, repoDir);
      if (fs.existsSync(abs)) {
        const gs = createSpinner(`Indexing ${repoDir}...`).start();
        try {
          execSync('npx gitnexus analyze', { cwd: abs, stdio: 'pipe', timeout: 120000 });
          gs.succeed(`Indexed ${repoDir}`);
        } catch { gs.fail(`GitNexus indexing failed for ${repoDir} — run manually: npx gitnexus analyze`); }
      }
    }
  }
}

function registerVaultMap(vaultName, vaultAbsPath) {
  const vaultMapPath = path.join(os.homedir(), '.claude', 'vault-map.json');
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(vaultMapPath, 'utf-8'));
  } catch { /* create fresh */ }

  if (map[vaultName]) return;

  map[vaultName] = vaultAbsPath;
  try {
    fs.mkdirSync(path.dirname(vaultMapPath), { recursive: true });
    fs.writeFileSync(vaultMapPath, JSON.stringify(map, null, 2) + '\n');
  } catch { /* non-fatal */ }
}


function printDryRun({ projectName, vaultName, repoInputs, agents, workspaceDir }) {
  log.bold('Dry run — nothing will be created:\n');
  log.plain(`Project:    ${projectName}`);
  log.plain(`Vault:      ${vaultName}/`);
  log.plain(`Repos:      ${repoInputs.length > 0 ? repoInputs.join(', ') : '(none)'}`);
  log.plain(`Agents:     ${agents.join(', ')}`);
  log.plain(`Directory:  ${workspaceDir}`);
  console.log('');
  log.plain('Would create:');
  log.plain(`  ${vaultName}/ (Obsidian vault)`);
  log.plain('  .ai-rules/ (workspace rules)');
  log.plain('  .workspace-config');
  if (agents.includes('claude')) log.plain('  .mcp.json (devnexus MCP)');
  if (agents.includes('cursor')) log.plain('  .cursor/mcp.json (devnexus MCP)');
  for (const agent of agents) {
    log.plain(`  ${getPointerFilename(agent)}`);
  }
  for (const repo of repoInputs) {
    const dir = isGitUrl(repo) ? repoDirFromUrl(repo) : path.basename(repo);
    log.plain(`  ${dir}/.ai-rules/`);
    for (const agent of agents) {
      log.plain(`  ${dir}/${getPointerFilename(agent)}`);
    }
  }
}

