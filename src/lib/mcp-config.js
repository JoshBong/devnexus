import fs from 'fs';
import path from 'path';
import os from 'os';
import { MCP_SERVER_NAME } from '../constants.js';

// The server definition every agent registers. `devnexus` must be on PATH
// (it is after `npm install -g devnexus`). The server resolves the workspace
// from its launch directory, so no path needs to be baked in.
function serverDef() {
  return { command: 'devnexus', args: ['mcp'] };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// Merge devnexus into a `{ mcpServers: {...} }` JSON file without clobbering
// other servers. Returns 'created' | 'added' | 'present'.
function mergeJsonMcp(file) {
  const existing = readJson(file) || {};
  const servers = existing.mcpServers || {};
  const had = !!servers[MCP_SERVER_NAME];
  servers[MCP_SERVER_NAME] = serverDef();
  existing.mcpServers = servers;
  writeJson(file, existing);
  if (!fs.existsSync(file)) return 'created';
  return had ? 'present' : 'added';
}

/**
 * Register the devnexus MCP server for each configured agent.
 *
 * Clean project-scoped config for Claude and Cursor. Codex and Windsurf only
 * support GLOBAL MCP config, so we merge into the global file when present and
 * otherwise emit copy-paste instructions — never a silent no-op.
 *
 * Returns { written: [{agent, file, status}], instructions: [{agent, text}] }.
 */
export function writeMcpConfig(workspaceDir, agents) {
  const written = [];
  const instructions = [];
  const seen = new Set(); // avoid writing the same file twice

  const def = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverDef() } }, null, 2);

  for (const agent of agents) {
    if (agent === 'claude') {
      const file = path.join(workspaceDir, '.mcp.json');
      if (seen.has(file)) continue;
      seen.add(file);
      const before = fs.existsSync(file);
      const status = mergeJsonMcp(file);
      written.push({ agent: 'claude', file: '.mcp.json', status: before ? status : 'created' });
    } else if (agent === 'cursor') {
      const file = path.join(workspaceDir, '.cursor', 'mcp.json');
      if (seen.has(file)) continue;
      seen.add(file);
      const before = fs.existsSync(file);
      const status = mergeJsonMcp(file);
      written.push({ agent: 'cursor', file: '.cursor/mcp.json', status: before ? status : 'created' });
    } else if (agent === 'windsurf') {
      // Global only: ~/.codeium/windsurf/mcp_config.json
      const file = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      if (fs.existsSync(path.dirname(file))) {
        const status = mergeJsonMcp(file);
        written.push({ agent: 'windsurf', file: '~/.codeium/windsurf/mcp_config.json (global)', status });
      } else {
        instructions.push({
          agent: 'windsurf',
          text:
            'Windsurf uses a global MCP config. Add to ~/.codeium/windsurf/mcp_config.json:\n' + def,
        });
      }
    } else if (agent === 'codex') {
      // Global only: ~/.codex/config.toml (TOML)
      const file = path.join(os.homedir(), '.codex', 'config.toml');
      const block =
        `\n[mcp_servers.${MCP_SERVER_NAME}]\n` +
        `command = "devnexus"\n` +
        `args = ["mcp"]\n`;
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.includes(`[mcp_servers.${MCP_SERVER_NAME}]`)) {
          written.push({ agent: 'codex', file: '~/.codex/config.toml (global)', status: 'present' });
        } else {
          fs.appendFileSync(file, block);
          written.push({ agent: 'codex', file: '~/.codex/config.toml (global)', status: 'added' });
        }
      } else {
        instructions.push({
          agent: 'codex',
          text: 'Codex uses a global TOML config. Add to ~/.codex/config.toml:' + block,
        });
      }
    }
    // generic: no MCP config — relies on the .ai-rules/ instructions only.
  }

  return { written, instructions };
}
