export const TEMPLATE_VERSION = '3.2';
export const CONFIG_VERSION = '2.0';
export const CONFIG_FILE = '.workspace-config';

// MCP server — devnexus exposes the vault as live tools agents call in-session
export const MCP_SERVER_NAME = 'devnexus';

export const AGENTS = {
  claude:   { pointer: 'CLAUDE.md',       display: 'Claude Code',  inline: false },
  cursor:   { pointer: '.cursorrules',     display: 'Cursor',       inline: true  },
  codex:    { pointer: 'AGENTS.md',        display: 'Codex',        inline: false },
  windsurf: { pointer: '.windsurfrules',   display: 'Windsurf',     inline: true  },
  generic:  { pointer: 'AI_RULES.md',       display: 'Generic',      inline: true  },
};

export const MANAGED_FENCE_START = '<!-- devnexus:managed:start -->';
export const MANAGED_FENCE_END = '<!-- devnexus:managed:end -->';

export const SUPPORTED_AGENTS = Object.keys(AGENTS);

export const GITIGNORE_ENTRIES = ['.ai-rules/', '.cursor/', '.gitnexus', 'AI_RULES.md'];

// Index constants
export const NODES_DIR = 'nodes';
export const NODE_INDEX_FILE = 'NODE_INDEX.md';
export const NODE_INDEX_JSON_FILE = 'NODE_INDEX.json'; // structured twin — local, per-branch, gitignored
export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_MARKER_START = '<!-- devnexus:index:start -->';
export const INDEX_MARKER_END = '<!-- devnexus:index:end -->';

// Knowledge constants
export const PRACTICES_DIR = 'practices';
export const HANDOFFS_DIR = 'handoffs';

// Vault sync — devnexus-owned git sync, scoped to the vault repo only.
// 'mcp' = commit on every vault write, push if a remote exists (fail-soft).
// 'off' = plain file writes, no git (legacy behavior / Obsidian Git owns sync).
export const DEFAULT_VAULT_SYNC = 'mcp';
export const DEVNEXUS_DIR = '.devnexus';        // machine-local runtime state (gitignored)
export const SYNC_LOCK_FILE = 'sync.lock';
export const SYNC_STATUS_FILE = 'sync-status.json';
export const SYNC_LOCK_TTL_MS = 30_000;         // steal a lock older than this
export const SYNC_LOCK_WAIT_MS = 4_000;         // how long a write waits for the lock
export const SYNC_GIT_TIMEOUT_MS = 20_000;      // per git op, then fail-soft

// Embedded vault watcher (rides inside `devnexus mcp` by default)
export const DEFAULT_VAULT_WATCH = true;
export const WATCH_LEASE_FILE = 'watch.lease';  // singleton: one watcher per vault
export const WATCH_DEBOUNCE_MS = 1_500;         // settle edits before syncing
export const WATCH_PULL_INTERVAL_MS = 60_000;   // periodic pull of others' changes
export const WATCH_LEASE_TTL_MS = 30_000;       // steal a lease older than this
export const WATCH_LEASE_HEARTBEAT_MS = 10_000; // refresh our lease this often

// Decision constants
export const DECISIONS_DIR = 'decisions';
export const DECISION_INDEX_FILE = 'DECISION_INDEX.md';
export const DECISION_MARKER_START = '<!-- devnexus:decisions:start -->';
export const DECISION_MARKER_END = '<!-- devnexus:decisions:end -->';

// Thresholds
export const GOD_NODE_MAX = 15;           // max god nodes to surface
export const GOD_NODE_MIN_EDGES = 10;     // minimum edges to qualify as god node
export const GOD_NODE_MIN_COMMUNITIES = 3; // minimum cross-community reach for god nodes
export const COMMUNITY_HUB_COUNT = 3;     // top N symbols per community as hubs
export const DRIFT_DAYS_THRESHOLD = 14;    // days before index is considered stale
