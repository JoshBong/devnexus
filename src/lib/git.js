import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export function isGitUrl(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('ssh://') ||
    s.startsWith('git://') ||
    s.startsWith('git+ssh://') ||
    /^git@[^:]+:/.test(s)
  );
}

export function repoDirFromUrl(url) {
  const scpMatch = url.match(/^git@[^:]+:(.+)$/);
  const tail = scpMatch ? scpMatch[1] : url;
  return path.basename(tail, '.git');
}

export function gitClone(url, cwd = process.cwd()) {
  // arg array, no shell: a "URL" containing quotes/$/backticks passes isGitUrl
  // (any https:// prefix) and would otherwise escape the quoting into the shell
  execFileSync('git', ['clone', url], { cwd, stdio: 'pipe' });
  return repoDirFromUrl(url);
}

export function gitInit(dir) {
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
}

export function gitAddAll(dir) {
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
}

export function gitCommit(dir, message) {
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, stdio: 'pipe' });
}

export function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

export function gitStatus(dir) {
  try {
    const output = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' });
    return output.trim() === '' ? 'clean' : 'dirty';
  } catch {
    return 'error';
  }
}

export function gitHasRemote(dir) {
  try {
    const output = execSync('git remote -v', { cwd: dir, encoding: 'utf-8' });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function gitLastCommitTime(dir) {
  try {
    const output = execSync('git log -1 --format=%cr', { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return output.trim();
  } catch {
    return null;
  }
}

// Short SHA + subject of the current HEAD, or null if not a repo / no commits.
export function gitHeadInfo(dir) {
  try {
    const out = execSync('git log -1 --format=%h%x00%s', { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const [sha, subject] = out.trim().split('\x00');
    if (!sha) return null;
    return { sha, subject: subject || '' };
  } catch {
    return null;
  }
}
