import inquirer from 'inquirer';
import { SUPPORTED_AGENTS } from '../constants.js';

export async function promptProjectInfo() {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: "What's your project called?",
      default: 'my-project',
    },
    {
      type: 'input',
      name: 'author',
      message: "What's your name? (for decision log attribution)",
      default: 'Engineer',
    },
  ]);
}

export async function promptRepos() {
  const repos = [];

  console.log('');
  console.log('Add repos by git URL (will clone) or folder name (if already here).');
  console.log('Press Enter on an empty line when done.');
  console.log('');

  while (true) {
    const { repo } = await inquirer.prompt([
      {
        type: 'input',
        name: 'repo',
        message: 'Repo (or empty to finish):',
      },
    ]);

    if (!repo.trim()) break;
    repos.push(repo.trim());
  }

  return repos;
}

export async function promptAgents({ preselected, fallback = ['claude'] } = {}) {
  const checkedSet = new Set(preselected ?? ['claude']);
  const { agents } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'agents',
      message: 'Which AI agents do you use? (↑↓ move, space toggle, enter confirm)',
      choices: SUPPORTED_AGENTS.map(a => ({
        name: a,
        value: a,
        checked: checkedSet.has(a),
      })),
    },
  ]);

  return agents.length > 0 ? agents : fallback;
}

export async function promptExistingVault() {
  const { hasVault } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasVault',
      message: 'Do you have an existing project vault? (joining a team)',
      default: false,
    },
  ]);

  if (!hasVault) return null;

  const { vaultSource } = await inquirer.prompt([
    {
      type: 'input',
      name: 'vaultSource',
      message: 'Vault location (git URL to clone, or folder name if already here):',
    },
  ]);

  return vaultSource.trim() || null;
}

export async function confirm(message, defaultValue = true) {
  // No TTY (CI, piped) → no one can answer; inquirer would hang on stdin or throw.
  // Decline safely — every caller treats false as "cancelled", and the destructive
  // commands document --yes for non-interactive use.
  if (!process.stdin.isTTY) {
    console.error(`Non-interactive session — declining: "${message}" (pass --yes to skip confirmation)`);
    return false;
  }
  const { ok } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      message,
      default: defaultValue,
    },
  ]);
  return ok;
}
