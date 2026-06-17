import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { log, createSpinner } from '../lib/output.js';
import { requireConfig, writeConfig } from '../lib/config.js';
import { detectStack } from '../lib/detect-stack.js';
import { ensureDir, writeFile, writeFileIfNotExists, migrateExistingPointer, concatenateRules, extractGitNexusBlock, writeManagedPointer } from '../lib/fs-helpers.js';
import { getPointerFilename, getAgentDisplay, isInlineAgent } from '../lib/agents.js';
import { isGitRepo } from '../lib/git.js';
import * as pointerTemplates from '../templates/pointers.js';
import { TEMPLATE_VERSION, DECISIONS_DIR, PRACTICES_DIR, HANDOFFS_DIR, DEFAULT_VAULT_SYNC, DEFAULT_VAULT_WATCH } from '../constants.js';
import * as vaultTemplates from '../templates/vault.js';
import * as obsidianTemplates from '../templates/obsidian.js';
import { installContractHook, installGitNexusHook, installGitNexusPostMergeHook } from '../lib/hooks.js';
import * as workspaceRules from '../templates/workspace-rules.js';
import * as repoRules from '../templates/repo-rules.js';
import { writeMcpConfig } from '../lib/mcp-config.js';

export function updateCommand() {
  const cmd = new Command('update')
    .description('Regenerate .ai-rules/ with the latest templates')
    .option('--repo <name>', 'Update only a specific repo')
    .option('--force', 'Skip version check')
    .option('--dry-run', 'Show what would change without changing it')
    .action(async (opts) => {
      try {
        await runUpdate(opts);
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runUpdate(opts) {
  log.header('AI Workspace Update');

  const config = requireConfig();
  const { projectName, vaultName, repos = [], agents = [] } = config;

  // Backfill new config keys for workspaces created before v3.
  if (config.vaultSync === undefined) config.vaultSync = DEFAULT_VAULT_SYNC;
  if (config.vaultWatch === undefined) config.vaultWatch = DEFAULT_VAULT_WATCH;

  log.success(`Project: ${projectName}`);
  log.success(`Vault: ${vaultName}`);
  log.success(`Repos: ${repos.join(', ') || '(none)'}`);
  log.success(`Agents: ${agents.join(', ')}`);
  console.log('');

  // Version check
  const currentVersion = getCurrentVersion();
  if (currentVersion === TEMPLATE_VERSION && !opts.force) {
    log.warn(`Agent rules are already at v${TEMPLATE_VERSION}.`);
    log.warn("Use --force to regenerate anyway.");
    return;
  }

  const targetRepos = opts.repo ? [opts.repo] : repos;

  if (opts.dryRun) {
    log.bold('Dry run — nothing will be changed:\n');
    if (!opts.repo) log.plain('Would update: .ai-rules/ (workspace)');
    for (const repo of targetRepos) {
      log.plain(`Would update: ${repo}/.ai-rules/`);
    }
    log.plain(`\nFrom v${currentVersion || '?'} -> v${TEMPLATE_VERSION}`);
    return;
  }

  console.log('');
  const updated = [];

  if (!opts.repo) {
    let s = createSpinner('Updating workspace rules...').start();
    updateWorkspaceRules(vaultName);
    syncInlinePointers(path.resolve('.'), agents);
    s.succeed('Updating workspace rules...');
    updated.push('.ai-rules/ (workspace)');

    const { written, instructions } = writeMcpConfig(path.resolve('.'), agents);
    for (const w of written) log.success(`MCP registered for ${getAgentDisplay(w.agent)} → ${w.file} (${w.status})`);
    for (const ins of instructions) {
      log.warn(`MCP for ${getAgentDisplay(ins.agent)} needs manual setup:`);
      log.dim(ins.text);
    }

    const vaultMigrated = backfillVault(vaultName);
    if (vaultMigrated.length > 0) {
      log.success(`Vault migrated to v3: ${vaultMigrated.join(', ')}`);
      log.dim('Review and commit the vault: cd ' + vaultName + ' && git add -A && git commit -m "devnexus: migrate to v3"');
    }

    const migrated = migrateDecisions(vaultName);
    if (migrated > 0) {
      log.success(`Migrated ${migrated} decision${migrated === 1 ? '' : 's'} to decisions/`);
    }
  }

  for (const repoDir of targetRepos) {
    const absDir = path.resolve(repoDir);
    if (!fs.existsSync(absDir)) {
      log.warn(`Skipping ${repoDir} (not found)`);
      continue;
    }

    const s = createSpinner(`Updating ${repoDir}...`).start();
    const repoStack = detectStack(absDir);
    updateRepoRules(absDir, { projectName, vaultName, repoStack, agents });
    syncInlinePointers(absDir, agents);
    s.succeed(`Updating ${repoDir}...`);
    updated.push(`${repoDir}/.ai-rules/`);
  }

  const s = createSpinner('Saving config...').start();
  config.templateVersion = TEMPLATE_VERSION;
  writeConfig(config);
  s.succeed('Saving config...');

  console.log('');
  console.log(chalk.green.bold(`  ✔ Updated to v${TEMPLATE_VERSION}`));
  console.log('');
  for (const item of updated) {
    console.log(`    ${item}`);
  }
  const inlineAgents = agents.filter(a => isInlineAgent(a));
  if (inlineAgents.length > 0) {
    for (const agent of inlineAgents) {
      console.log(`    ${getPointerFilename(agent)} (${getAgentDisplay(agent)}) — synced`);
    }
  }
  console.log('');
}

// Bring a pre-v3 vault up to date: scaffold practices/ + handoffs/, gitignore the
// derived layer (now local + per-branch), flip Obsidian Git to mcp-sync mode, and
// untrack the derived files that used to be committed. Returns what changed.
function backfillVault(vaultName) {
  const vaultDir = path.resolve(vaultName);
  if (!fs.existsSync(vaultDir)) return [];
  const changed = [];

  // practices/ (+ starters) and handoffs/
  const pdir = path.join(vaultDir, PRACTICES_DIR);
  if (!fs.existsSync(pdir)) {
    ensureDir(pdir);
    writeFile(path.join(pdir, 'README.md'), vaultTemplates.practicesReadme());
    for (const a of ['frontend', 'auth', 'api']) {
      writeFileIfNotExists(path.join(pdir, `${a}.md`), vaultTemplates.practiceStarter(a));
    }
    changed.push('practices/');
  }
  if (!fs.existsSync(path.join(vaultDir, HANDOFFS_DIR))) {
    ensureDir(path.join(vaultDir, HANDOFFS_DIR));
    changed.push('handoffs/');
  }

  // gitignore the derived layer + runtime dir
  const giPath = path.join(vaultDir, '.gitignore');
  let gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf-8') : '';
  const lines = new Set(gi.split('\n').map(l => l.trim()));
  const entries = ['.devnexus/', 'NODE_INDEX.md', 'NODE_INDEX.json', 'GRAPH_REPORT.md', 'decisions/DECISION_INDEX.md', 'nodes/'];
  const missing = entries.filter(e => !lines.has(e));
  if (missing.length > 0) {
    if (gi && !gi.endsWith('\n')) gi += '\n';
    gi += '\n# Derived code graph — regenerated locally per branch (v3)\n' + missing.join('\n') + '\n';
    fs.writeFileSync(giPath, gi);
    changed.push('.gitignore');
  }

  // Obsidian Git → mcp-sync mode (auto-commit off; auto-pull stays on for viewing)
  const ogData = path.join(vaultDir, '.obsidian', 'plugins', 'obsidian-git', 'data.json');
  if (fs.existsSync(ogData)) {
    writeFile(ogData, obsidianTemplates.gitPluginData({ mcpSync: true }));
  }

  // Untrack derived files that were committed pre-v3 (kept on disk via --cached)
  if (isGitRepo(vaultDir)) {
    let untracked = false;
    for (const p of ['NODE_INDEX.md', 'NODE_INDEX.json', 'GRAPH_REPORT.md', 'decisions/DECISION_INDEX.md', 'nodes']) {
      try {
        execSync(`git rm -r --cached --quiet --ignore-unmatch "${p}"`, { cwd: vaultDir, stdio: 'pipe' });
        untracked = true;
      } catch { /* not tracked — fine */ }
    }
    if (untracked) changed.push('untracked derived files');
  }

  return changed;
}

function getCurrentVersion() {
  const versionFile = path.resolve('.ai-rules', 'version.txt');
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf-8').trim();
  }
  return null;
}

function updateWorkspaceRules(vaultName) {
  const rulesDir = path.resolve('.ai-rules');
  const existingRules = preserveExistingRules(rulesDir);

  if (fs.existsSync(rulesDir)) {
    fs.rmSync(rulesDir, { recursive: true });
  }
  ensureDir(rulesDir);

  if (existingRules) writeFile(path.join(rulesDir, '00-existing-rules.md'), existingRules);
  writeFile(path.join(rulesDir, '01-session-start.md'), workspaceRules.sessionStart({ vaultName }));
  writeFile(path.join(rulesDir, '02-vault-rules.md'), workspaceRules.vaultRules({ vaultName }));
  writeFile(path.join(rulesDir, '03-contract-drift.md'), workspaceRules.contractDrift({ vaultName }));
  writeFile(path.join(rulesDir, '04-profile-rules.md'), workspaceRules.profileRules());
  writeFile(path.join(rulesDir, '05-vault-brain-mcp.md'), workspaceRules.mcpRules());
  writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');
}

function updateRepoRules(absRepoDir, { projectName, vaultName, repoStack, agents }) {
  const rulesDir = path.join(absRepoDir, '.ai-rules');
  const existingRules = preserveExistingRules(rulesDir);

  if (fs.existsSync(rulesDir)) {
    fs.rmSync(rulesDir, { recursive: true });
  }
  ensureDir(rulesDir);

  // Migrate pointer files that don't reference .ai-rules/
  for (const agent of agents) {
    const filename = getPointerFilename(agent);
    const filePath = path.join(absRepoDir, filename);
    if (migrateExistingPointer(filePath, rulesDir)) {
      const content = pointerTemplates.repoPointer({ repoDir: path.basename(absRepoDir), repoStack });
      writeFile(filePath, content);
    }
  }

  if (existingRules && !fs.existsSync(path.join(rulesDir, '00-existing-rules.md'))) {
    writeFile(path.join(rulesDir, '00-existing-rules.md'), existingRules);
  }
  writeFile(path.join(rulesDir, '00-gate.md'), repoRules.gate());
  writeFile(path.join(rulesDir, '01-source-of-truth.md'), repoRules.sourceOfTruth({ projectName, repoStack, vaultName }));
  writeFile(path.join(rulesDir, '02-decision-logic.md'), repoRules.decisionLogic({ vaultName }));
  writeFile(path.join(rulesDir, '03-contract-drift.md'), repoRules.contractDrift({ vaultName }));
  writeFile(path.join(rulesDir, '04-operator-profile.md'), repoRules.operatorProfile());
  writeFile(path.join(rulesDir, '05-code-intelligence.md'), repoRules.codeIntelligence());
  writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');

  installContractHook(absRepoDir, vaultName);
  installGitNexusHook(absRepoDir);
  installGitNexusPostMergeHook(absRepoDir);
}

function syncInlinePointers(dir, agents) {
  const rulesDir = path.join(dir, '.ai-rules');
  const rules = concatenateRules(rulesDir);

  // Mirror GitNexus block from CLAUDE.md if it exists
  const gnBlock = extractGitNexusBlock(path.join(dir, 'CLAUDE.md'));
  const fullContent = gnBlock ? `${rules}\n\n${gnBlock}` : rules;

  for (const agent of agents) {
    if (!isInlineAgent(agent)) continue;
    const filename = getPointerFilename(agent);
    const filePath = path.join(dir, filename);
    writeManagedPointer(filePath, fullContent);
  }
}

function preserveExistingRules(rulesDir) {
  const existingPath = path.join(rulesDir, '00-existing-rules.md');
  if (fs.existsSync(existingPath)) {
    return fs.readFileSync(existingPath, 'utf-8');
  }
  return null;
}

function migrateDecisions(vaultName) {
  const vaultDir = path.resolve(vaultName);
  const decisionsDir = path.join(vaultDir, DECISIONS_DIR);
  const decisionsFile = path.join(vaultDir, 'DECISIONS.md');

  if (!fs.existsSync(decisionsFile)) return 0;
  if (fs.existsSync(decisionsDir)) return 0;

  const content = fs.readFileSync(decisionsFile, 'utf-8');
  const entryPattern = /^## (\d{4}-\d{2}-\d{2}) — (.+?)(?:\s+\(by (.+?)\))?$/gm;
  const entries = [];
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const [, date, title, author] = match;
    const startIdx = match.index + match[0].length;
    entries.push({ date, title, author: author || 'unknown', startIdx });
  }

  // Extract body for each entry
  for (let i = 0; i < entries.length; i++) {
    const end = i + 1 < entries.length ? entries[i + 1].startIdx - entries[i + 1].date.length - entries[i + 1].title.length - 20 : content.length;
    const nextMatch = i + 1 < entries.length
      ? content.lastIndexOf(`## ${entries[i + 1].date}`, end + 50)
      : content.length;
    entries[i].body = content.slice(entries[i].startIdx, nextMatch).trim();
  }

  // Heuristic: does the body reference code symbols?
  // Require camelCase (buildIndex) or PascalCase with mixed case after first char (DealState)
  // Filters out common English words like "Set", "Vault", "Obsidian"
  const codeRefPattern = /\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*)\b/;
  const symbolEntries = entries.filter(e => codeRefPattern.test(e.body) || codeRefPattern.test(e.title));

  if (symbolEntries.length === 0) {
    // Still create decisions/ dir with README for future use
    ensureDir(decisionsDir);
    writeFile(path.join(decisionsDir, 'README.md'), vaultTemplates.decisionsReadme());
    return 0;
  }

  ensureDir(decisionsDir);
  writeFile(path.join(decisionsDir, 'README.md'), vaultTemplates.decisionsReadme());

  let migrated = 0;
  for (const entry of symbolEntries) {
    const slug = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${entry.date}-${slug}.md`;

    // Best-effort ref extraction: find camelCase/PascalCase identifiers that look like code symbols
    const refs = [];
    const refMatches = (entry.body + ' ' + entry.title).matchAll(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*)\b/g);
    for (const m of refMatches) {
      if (!refs.includes(m[1])) refs.push(m[1]);
    }

    const refsLine = refs.length > 0 ? refs.map(r => `[[${r}]]`).join(', ') : '';
    let md = `# ${entry.title}\n\n`;
    md += `Date: ${entry.date}\n`;
    md += `Author: ${entry.author}\n`;
    md += `Status: ACTIVE\n`;
    md += `Refs: ${refsLine}\n`;
    md += `Depends:\n`;
    md += `\n---\n\n`;
    md += entry.body + '\n';

    writeFile(path.join(decisionsDir, filename), md);
    migrated++;
  }

  // Rewrite DECISIONS.md keeping only non-symbol entries
  const nonSymbolEntries = entries.filter(e => !symbolEntries.includes(e));
  const header = content.slice(0, content.indexOf('---') + 3);
  let newContent = header.replace(
    /^> Reverse-chronological log of non-obvious decisions.*$/m,
    '> Append-only log for **project-level** decisions that don\'t reference specific code symbols.'
  ).replace(
    /^> When you reject an approach.*$/m,
    '> Examples: license choices, tooling picks, infra decisions, team process choices.'
  ).replace(
    /^> Format:.*$/m,
    '> For decisions about specific functions/classes/symbols, use `decisions/` instead.'
  ).replace(
    /^> Agents read this.*$/m,
    '> Format: ## YYYY-MM-DD — Title (by [name]) followed by two sentences.'
  );

  for (const entry of nonSymbolEntries) {
    newContent += `\n\n## ${entry.date} — ${entry.title}${entry.author !== 'unknown' ? ` (by ${entry.author})` : ''}\n\n${entry.body}`;
  }
  newContent += '\n';

  fs.writeFileSync(decisionsFile, newContent);

  return migrated;
}
