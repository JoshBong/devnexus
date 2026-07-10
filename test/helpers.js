import path from 'path';
import { fileURLToPath } from 'url';

// The devnexus checkout under test. Several suites symlink a real repo (with its
// committed .gitnexus index) into their fixtures — this resolves it relative to the
// test file so the suite runs on any machine/CI, not just the author's.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
