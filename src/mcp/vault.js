import fs from 'fs';
import path from 'path';
import { CONFIG_FILE, NODE_INDEX_JSON_FILE } from '../constants.js';
import { readConfig } from '../lib/config.js';

/**
 * Resolve the workspace root and vault for the MCP server.
 *
 * Resolution order:
 *   1. explicit `workspace` argument (--workspace flag)
 *   2. DEVNEXUS_WORKSPACE env var
 *   3. walk up from cwd until a .workspace-config is found
 *
 * Returns { workspaceDir, vaultDir, config } or null if no workspace is found.
 * The MCP server still starts when this returns null — tools surface a helpful
 * "no workspace" message rather than crashing.
 */
export function resolveWorkspace(explicit) {
  const start = explicit || process.env.DEVNEXUS_WORKSPACE || process.cwd();

  let dir = path.resolve(start);
  // First, check the start dir and every ancestor for a config.
  while (true) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) {
      return buildContext(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function buildContext(workspaceDir) {
  const config = readConfig(workspaceDir);
  if (!config || !config.vaultName) return null;
  const vaultDir = path.join(workspaceDir, config.vaultName);
  return { workspaceDir, vaultDir, config };
}

/** Read the structured NODE_INDEX.json, or null if it hasn't been built yet. */
export function readIndexJson(vaultDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultDir, NODE_INDEX_JSON_FILE), 'utf-8'));
  } catch {
    return null;
  }
}

/** Read a vault file, returning '' if absent. */
export function readVaultFile(vaultDir, relPath) {
  const full = path.join(vaultDir, relPath);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf-8');
}

/**
 * Split markdown into sections keyed by their nearest heading.
 * Returns [{ heading, level, body, raw }]. Content before the first heading
 * is returned under heading '' (the preamble).
 */
export function splitSections(md) {
  const lines = md.split('\n');
  const sections = [];
  let current = { heading: '', level: 0, lines: [] };
  let inFence = false;

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~) so a `# comment` inside a shell/markdown
    // block is NOT mistaken for a heading — that split truncated contracts at a code
    // comment and polluted the available-section list.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  return sections
    .map(s => ({
      heading: s.heading,
      level: s.level,
      raw: s.lines.join('\n').trim(),
      body: s.lines.slice(s.heading ? 1 : 0).join('\n').trim(),
    }))
    .filter(s => s.raw);
}

/**
 * Return the last N "## " entries from a log-style file (SESSION_LOG, etc.),
 * newest first if the file is newest-first, otherwise file order. We return
 * them in the order they appear, capped to the last N by file position.
 */
export function lastEntries(md, n) {
  const sections = splitSections(md).filter(s => s.level === 2);
  if (sections.length === 0) return [];
  return sections.slice(-n).map(s => s.raw);
}

/**
 * Pull a section whose heading contains `name` (case-insensitive), INCLUDING its
 * nested subsections — everything until the next heading at the same or a higher level.
 * splitSections is flat (one atomic entry per heading), so a parent like `## Endpoints`
 * with `### POST /users` children would otherwise return just the bare heading line.
 */
export function findSection(md, name) {
  const target = name.toLowerCase();
  const sections = splitSections(md);
  const idx = sections.findIndex(s => s.heading.toLowerCase().includes(target));
  if (idx === -1) return '';
  const parts = [sections[idx].raw];
  for (let i = idx + 1; i < sections.length; i++) {
    if (sections[i].level <= sections[idx].level) break; // sibling/ancestor → stop
    parts.push(sections[i].raw);
  }
  return parts.join('\n\n');
}

/** Recursively list markdown files under a vault subdir (relative paths). */
export function listMarkdown(vaultDir, subdir) {
  const base = path.join(vaultDir, subdir);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(path.relative(vaultDir, full));
    }
  };
  walk(base);
  return out;
}
