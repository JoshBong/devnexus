import fs from 'fs';
import path from 'path';
import { CONFIG_FILE, CONFIG_VERSION } from '../constants.js';

export function readConfig(dir = process.cwd()) {
  const configPath = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(configPath)) return null;

  const content = fs.readFileSync(configPath, 'utf-8');

  // Try JSON first
  try {
    return JSON.parse(content);
  } catch {
    // A file that LOOKS like JSON but doesn't parse is corrupt — falling through to the
    // legacy parser used to return a near-empty object stamped valid, so doctor said
    // "found and valid" and then crashed on the missing fields. Surface it instead.
    if (content.trimStart().startsWith('{')) {
      console.error(`Corrupt ${CONFIG_FILE}: invalid JSON. Fix it by hand or restore it from git.`);
      return null;
    }
    // Fall back to legacy bash format
    return parseLegacyConfig(content);
  }
}

export function writeConfig(config, dir = process.cwd()) {
  const configPath = path.join(dir, CONFIG_FILE);
  const data = { version: CONFIG_VERSION, ...config };
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

export function requireConfig(dir = process.cwd()) {
  const config = readConfig(dir);
  if (!config) {
    throw new Error(
      `.workspace-config not found. Run 'devnexus init' first, or make sure you're in the workspace root.`
    );
  }
  return config;
}

function parseLegacyConfig(content) {
  const config = { migrated: true };

  const strings = {
    PROJECT_NAME: 'projectName',
    VAULT_NAME: 'vaultName',
    TECH_STACK: 'techStack',
    TEMPLATE_VERSION: 'templateVersion',
  };

  for (const [bashKey, jsonKey] of Object.entries(strings)) {
    const match = content.match(new RegExp(`${bashKey}="([^"]*)"`));
    if (match) config[jsonKey] = match[1];
  }

  const arrays = {
    REPO_DIRS: 'repos',
    AGENTS: 'agents',
  };

  for (const [bashKey, jsonKey] of Object.entries(arrays)) {
    const match = content.match(new RegExp(`${bashKey}=\\(([^)]*)\\)`));
    if (match) {
      config[jsonKey] = match[1].match(/"([^"]*)"/g)?.map(s => s.replace(/"/g, '')) || [];
    }
  }

  // Nothing matched → this isn't a legacy config at all, it's an unrecognized file.
  if (Object.keys(config).length === 1) return null;

  // Deliberately NO version stamp: `version` is what marks a config as current-format
  // JSON. Stamping it here made doctor's legacy-migration branch unreachable — every
  // legacy config passed the version check and was never offered the migrate fix.
  return config;
}
