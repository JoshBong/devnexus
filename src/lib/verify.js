import fs from 'fs';
import path from 'path';
import os from 'os';
import { getPointerFilename, getAgentDisplay } from './agents.js';
import { isGitRepo, gitHasRemote } from './git.js';
import { ensureDir, addToGitignore, writeFile, writeFileIfNotExists } from './fs-helpers.js';
import { detectStack } from './detect-stack.js';
import { TEMPLATE_VERSION, GITIGNORE_ENTRIES } from '../constants.js';
import * as repoRules from '../templates/repo-rules.js';
import * as pointerTemplates from '../templates/pointers.js';

export function verifyBuild(config) {
  const { projectName, vaultName, repos = [], agents = [] } = config;
  const results = { passes: 0, warns: 0, fails: 0, fixes: [], issues: [] };

  function pass() { results.passes++; }
  function warn(msg) { results.warns++; results.issues.push({ level: 'warn', msg }); }
  function fail(msg, fixFn) {
    results.fails++;
    results.issues.push({ level: 'fail', msg });
    if (fixFn) results.fixes.push({ msg, fn: fixFn });
  }

  // Vault
  const vaultDir = path.resolve(vaultName);
  if (fs.existsSync(vaultDir)) {
    const expected = ['MOC.md', 'ARCHITECTURE_OVERVIEW.md', 'API_CONTRACTS.md', 'DECISIONS.md', 'SESSION_LOG.md'];
    const missing = expected.filter(f => !fs.existsSync(path.join(vaultDir, f)));
    if (missing.length === 0) pass();
    else fail(`Vault missing: ${missing.join(', ')}`);

    if (isGitRepo(vaultDir)) pass();
    else warn('Vault is not a git repository');
  } else {
    fail(`Vault directory '${vaultName}' not found`);
  }

  // Workspace .ai-rules/
  const wsRulesDir = path.resolve('.ai-rules');
  if (fs.existsSync(wsRulesDir)) {
    const versionFile = path.join(wsRulesDir, 'version.txt');
    const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf-8').trim() : null;
    if (version === TEMPLATE_VERSION) pass();
    else fail(`.ai-rules/ at v${version || '?'} (latest: v${TEMPLATE_VERSION})`);

    const expectedRules = ['01-session-start.md', '02-vault-rules.md', '03-contract-drift.md', '04-vault-brain-mcp.md'];
    const missing = expectedRules.filter(f => !fs.existsSync(path.join(wsRulesDir, f)));
    if (missing.length > 0) fail(`Workspace .ai-rules/ missing: ${missing.join(', ')}`);
    else pass();
  } else {
    fail('Workspace .ai-rules/ not found');
  }

  // Workspace pointer files
  for (const agent of agents) {
    const filename = getPointerFilename(agent);
    if (fs.existsSync(path.resolve(filename))) pass();
    else fail(`${filename} missing (${getAgentDisplay(agent)})`, () => {
      const content = pointerTemplates.workspacePointer({ projectName, vaultName, repos });
      writeFileIfNotExists(path.resolve(filename), content);
    });
  }

  // Each repo
  for (const repoDir of repos) {
    const absDir = path.resolve(repoDir);
    if (!fs.existsSync(absDir)) {
      fail(`${repoDir}/ directory not found`);
      continue;
    }

    // .ai-rules/
    const repoRulesDir = path.join(absDir, '.ai-rules');
    if (fs.existsSync(repoRulesDir)) {
      const vFile = path.join(repoRulesDir, 'version.txt');
      const v = fs.existsSync(vFile) ? fs.readFileSync(vFile, 'utf-8').trim() : null;
      if (v === TEMPLATE_VERSION) pass();
      else fail(`${repoDir}/.ai-rules/ at v${v || '?'} (latest: v${TEMPLATE_VERSION})`);
    } else {
      fail(`${repoDir}/.ai-rules/ not found`, () => {
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
      if (fs.existsSync(path.join(absDir, filename))) pass();
      else fail(`${repoDir}/${filename} missing`);
    }

    // .gitignore
    if (fs.existsSync(path.join(absDir, '.gitignore'))) {
      const gitignore = fs.readFileSync(path.join(absDir, '.gitignore'), 'utf-8');
      const missing = GITIGNORE_ENTRIES.filter(e => !gitignore.includes(e));
      if (missing.length === 0) pass();
      else warn(`${repoDir}/.gitignore missing: ${missing.join(', ')}`);
    }
  }

  // Vault-map.json
  const vaultMapPath = path.join(os.homedir(), '.claude', 'vault-map.json');
  if (fs.existsSync(vaultMapPath)) {
    try {
      const vaultMap = JSON.parse(fs.readFileSync(vaultMapPath, 'utf-8'));
      if (vaultMap[vaultName]) pass();
      else warn(`${vaultName} not registered in vault-map.json`);
    } catch { warn('vault-map.json is not valid JSON'); }
  }

  return results;
}

export function applyFixes(results) {
  let fixed = 0;
  const failed = [];
  for (const { msg, fn } of results.fixes) {
    try {
      fn();
      fixed++;
    } catch (err) {
      failed.push({ msg, error: err.message });
    }
  }
  return { fixed, failed };
}
