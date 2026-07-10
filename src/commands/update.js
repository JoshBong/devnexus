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

  // Remove the legacy operator-profile symlink (feature removed in v3.1).
  const profileLink = path.resolve('ai-profile');
  try {
    if (fs.lstatSync(profileLink).isSymbolicLink()) {
      fs.unlinkSync(profileLink);
      changed.push('removed ai-profile symlink');
    }
  } catch { /* not present — fine */ }

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

  // Obsidian Git → mcp-sync mode (auto-commit off; auto-pull stays on for viewing).
  // Write it ONCE — the migration marker is autoCommit still being on. Rewriting on
  // every update clobbered any settings the user had customized since, silently.
  const ogData = path.join(vaultDir, '.obsidian', 'plugins', 'obsidian-git', 'data.json');
  if (fs.existsSync(ogData)) {
    let needsFlip = true;
    try {
      const cur = JSON.parse(fs.readFileSync(ogData, 'utf-8'));
      // autoSaveInterval > 0 = Obsidian Git still auto-commits (pre-v3); mcp-sync mode
      // sets it to 0. Already 0 → user's file is left alone.
      needsFlip = (cur.autoSaveInterval || 0) > 0;
    } catch { /* unreadable — rewrite it */ }
    if (needsFlip) {
      writeFile(ogData, obsidianTemplates.gitPluginData({ mcpSync: true }));
      changed.push('obsidian-git → mcp-sync mode');
    }
  }

  // Untrack derived files that were committed pre-v3 (kept on disk via --cached).
  // -f forces past staged-content differences (pre-v3 Obsidian Git auto-staged these;
  // without -f git rm refuses, the catch swallowed it, and the file stayed tracked +
  // churning forever). `untracked` is only claimed when something was ACTUALLY
  // untracked — --ignore-unmatch exits 0 on a no-op, which used to make every single
  // update print the v3 migration banner.
  if (isGitRepo(vaultDir)) {
    let untracked = false;
    for (const p of ['NODE_INDEX.md', 'NODE_INDEX.json', 'GRAPH_REPORT.md', 'decisions/DECISION_INDEX.md', 'nodes']) {
      try {
        const wasTracked = execSync(`git ls-files -- "${p}"`, { cwd: vaultDir, stdio: 'pipe', encoding: 'utf-8' }).trim().length > 0;
        if (!wasTracked) continue;
        execSync(`git rm -r -f --cached --quiet --ignore-unmatch "${p}"`, { cwd: vaultDir, stdio: 'pipe' });
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
  const userRules = preserveUserRules(rulesDir);

  if (fs.existsSync(rulesDir)) {
    fs.rmSync(rulesDir, { recursive: true });
  }
  ensureDir(rulesDir);

  if (existingRules) writeFile(path.join(rulesDir, '00-existing-rules.md'), existingRules);
  restoreUserRules(rulesDir, userRules);
  writeFile(path.join(rulesDir, '01-session-start.md'), workspaceRules.sessionStart({ vaultName }));
  writeFile(path.join(rulesDir, '02-vault-rules.md'), workspaceRules.vaultRules({ vaultName }));
  writeFile(path.join(rulesDir, '03-contract-drift.md'), workspaceRules.contractDrift({ vaultName }));
  writeFile(path.join(rulesDir, '04-vault-brain-mcp.md'), workspaceRules.mcpRules());
  writeFile(path.join(rulesDir, 'version.txt'), TEMPLATE_VERSION + '\n');
}

function updateRepoRules(absRepoDir, { projectName, vaultName, repoStack, agents }) {
  const rulesDir = path.join(absRepoDir, '.ai-rules');
  const existingRules = preserveExistingRules(rulesDir);
  const userRules = preserveUserRules(rulesDir);

  if (fs.existsSync(rulesDir)) {
    fs.rmSync(rulesDir, { recursive: true });
  }
  ensureDir(rulesDir);
  restoreUserRules(rulesDir, userRules);

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
  writeFile(path.join(rulesDir, '04-code-intelligence.md'), repoRules.codeIntelligence());
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

// The rule files devnexus itself writes — current names plus every legacy name a past
// template version shipped (so a renumber like the v3.1 ai-profile removal doesn't leave
// an orphan behind). Anything in .ai-rules/ NOT on this list is user-authored, and since
// concatenateRules() reads EVERY .md as a live rule, those must survive `update`. Before,
// update rm -rf'd the whole dir and restored only 00-existing-rules.md, silently deleting
// a team's own 05-conventions.md et al.
export const MANAGED_RULE_FILES = new Set([
  '00-existing-rules.md', '00-gate.md',
  '01-session-start.md', '01-source-of-truth.md',
  '02-vault-rules.md', '02-decision-logic.md',
  '03-contract-drift.md',
  '04-vault-brain-mcp.md', '04-code-intelligence.md',
  // legacy (pre-v3.1 numbering / removed ai-profile feature)
  '04-operator-profile.md', '04-profile-rules.md',
  '05-vault-brain-mcp.md', '05-code-intelligence.md',
  'version.txt',
]);

// Snapshot user-authored rule files (anything devnexus doesn't own) so the dir can be
// safely wiped and rebuilt without losing them. Returns { relPath: content }.
export function preserveUserRules(rulesDir) {
  const kept = {};
  if (!fs.existsSync(rulesDir)) return kept;
  for (const name of fs.readdirSync(rulesDir)) {
    if (MANAGED_RULE_FILES.has(name)) continue;
    const full = path.join(rulesDir, name);
    try {
      if (fs.statSync(full).isFile()) kept[name] = fs.readFileSync(full, 'utf-8');
    } catch { /* skip unreadable */ }
  }
  return kept;
}

export function restoreUserRules(rulesDir, kept) {
  for (const [name, content] of Object.entries(kept || {})) {
    const dest = path.join(rulesDir, name);
    if (!fs.existsSync(dest)) writeFile(dest, content);
  }
}

export function migrateDecisions(vaultName) {
  const vaultDir = path.resolve(vaultName);
  const decisionsDir = path.join(vaultDir, DECISIONS_DIR);
  const decisionsFile = path.join(vaultDir, 'DECISIONS.md');

  if (!fs.existsSync(decisionsFile)) return 0;
  if (fs.existsSync(decisionsDir)) return 0;

  const content = fs.readFileSync(decisionsFile, 'utf-8');
  // Accept BOTH an em-dash and a plain hyphen separator — pre-v3 vaults were hand-written
  // and many entries use `## DATE - Title`. The old em-dash-only regex silently skipped
  // those, and the rewrite (which reconstructed the file from matched entries) then
  // DROPPED them entirely. headingStart/bodyEnd let the rewrite below excise only the
  // migrated blocks and keep everything else — matched or not — verbatim.
  const entryPattern = /^## (\d{4}-\d{2}-\d{2}) [—-] (.+?)(?:\s+\(by (.+?)\))?$/gm;
  const entries = [];
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const [, date, title, author] = match;
    entries.push({
      date, title, author: author || 'unknown',
      headingStart: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  // Body runs from the end of this heading to the start of the next entry heading (or EOF).
  for (let i = 0; i < entries.length; i++) {
    const bodyEnd = i + 1 < entries.length ? entries[i + 1].headingStart : content.length;
    entries[i].bodyEnd = bodyEnd;
    entries[i].body = content.slice(entries[i].bodyStart, bodyEnd).trim();
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

  // Rewrite DECISIONS.md by EXCISING only the migrated symbol-entry blocks from the
  // original text — preserving the header, free prose, and every non-migrated entry
  // (including hyphen-format and any the parser didn't recognize) exactly as authored.
  // Remove back-to-front so earlier spans' indices stay valid.
  const migratedSpans = symbolEntries
    .map(e => ({ start: e.headingStart, end: e.bodyEnd }))
    .sort((a, b) => b.start - a.start);
  let stripped = content;
  for (const { start, end } of migratedSpans) {
    stripped = stripped.slice(0, start) + stripped.slice(end);
  }

  const newContent = stripped.replace(
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
  ).replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');

  fs.writeFileSync(decisionsFile, newContent);

  return migrated;
}
