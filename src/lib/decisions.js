import fs from 'fs';
import path from 'path';
import { DECISIONS_DIR, DECISION_INDEX_FILE } from '../constants.js';

/**
 * Read all symbol-linked decision files from the vault's decisions/ directory.
 * Returns [{ filename, title, date, author, status, refs, commits, depends, body }].
 * Shared by `devnexus index`, the MCP `why` tool, and `devnexus why`.
 */
export function readDecisions(vaultDir) {
  const dir = path.join(vaultDir, DECISIONS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== DECISION_INDEX_FILE && f !== 'README.md');

  const decisions = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    let lines = content.split('\n');

    // Tolerate standard Obsidian YAML frontmatter (--- fences at the very top): strip it
    // before parsing. Otherwise the FIRST --- was taken as the metadata/body separator —
    // the metadata scan ran zero lines, refs/date stayed empty, and the decision became
    // permanently invisible to why/decisionsForSymbol with no warning.
    if (lines[0]?.trim() === '---') {
      const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
      if (close !== -1) lines = lines.slice(close + 1);
    }

    // strip only the trailing .md, not the first occurrence anywhere in the name
    const d = { filename: file.replace(/\.md$/, ''), title: '', date: '', author: '', status: 'ACTIVE', refs: [], commits: [], depends: '', body: '' };

    const titleLine = lines.find(l => l.startsWith('# '));
    if (titleLine) d.title = titleLine.slice(2).trim();

    const sepIdx = lines.findIndex(l => l.trim() === '---');
    for (let i = 0; i < (sepIdx === -1 ? lines.length : sepIdx); i++) {
      const t = lines[i].trim();
      if (t.startsWith('Date:')) d.date = t.slice(5).trim();
      else if (t.startsWith('Author:')) d.author = t.slice(7).trim();
      else if (t.startsWith('Status:')) d.status = t.slice(7).trim();
      else if (t.startsWith('Depends:')) d.depends = t.slice(8).trim();
      else if (t.startsWith('Refs:')) {
        for (const m of t.matchAll(/\[\[([^\]]+)\]\]/g)) d.refs.push(m[1]);
      } else if (t.startsWith('Commits:')) {
        d.commits = t.slice(8).split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (sepIdx !== -1) d.body = lines.slice(sepIdx + 1).join('\n').trim();

    decisions.push(d);
  }

  return decisions.sort((a, b) => b.date.localeCompare(a.date));
}

/** Decisions whose Refs include `symbolName`. */
export function decisionsForSymbol(vaultDir, symbolName) {
  return readDecisions(vaultDir).filter(d => d.refs.includes(symbolName));
}
