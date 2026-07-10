import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The devnexus checkout under test. Several suites symlink a real repo into their
// fixtures — this resolves it relative to the test file so the suite runs on any
// machine/CI, not just the author's.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The graph-dependent suites (index-builder, decisions, edge-cases, stress) need this
// checkout to have a real GitNexus index — which is LOCAL (gitignored), so a fresh
// clone doesn't have one. Those suites skip with this reason instead of failing 32
// tests on a clean machine; run `npx gitnexus analyze` here to enable them.
export const HAS_GRAPH = fs.existsSync(path.join(REPO_ROOT, '.gitnexus', 'meta.json'));
export const SKIP_NO_GRAPH = HAS_GRAPH ? false : 'needs a GitNexus index — run `npx gitnexus analyze` in the repo first';
