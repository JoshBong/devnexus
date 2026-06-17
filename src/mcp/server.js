import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_SERVER_NAME } from '../constants.js';
import { resolveWorkspace } from './vault.js';
import { TOOLS } from './tools.js';
import { startWatcher } from './watcher.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const INSTRUCTIONS = `devnexus is the shared brain for this workspace — the prose/knowledge layer
(decisions, API contracts, code practices, handoffs) plus structural analysis
(god nodes, communities) devnexus computed from the code graph.

Use it like this:
- Call vault_context FIRST every session — it returns the map of content, API
  contracts, recent handoffs, and which practice areas exist.
- Before proposing an architectural change, call search_vault to see what was
  already decided. Dead ends stay dead.
- Before touching a shared structure, call god_nodes / communities.
- Before writing code in an area, call practices({ area }).
- Log decisions with log_decision AS THEY HAPPEN, and write a handoff with
  log_handoff at session end.

For the LIVE code graph — callers, blast radius, safe renames — use the separate
GitNexus MCP (gitnexus_impact, gitnexus_query, gitnexus_context). devnexus owns
knowledge and derived structure; GitNexus owns the raw graph. They compose.`;

export async function startMcpServer({ workspace } = {}) {
  // Resolved once at launch. Tools read files fresh on every call, so vault
  // edits during the session are always reflected.
  const ctx = resolveWorkspace(workspace);

  if (ctx) {
    process.stderr.write(`[devnexus mcp] workspace: ${ctx.workspaceDir}\n`);
  } else {
    process.stderr.write('[devnexus mcp] no workspace found — tools will report it\n');
  }

  const server = new Server(
    { name: MCP_SERVER_NAME, version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find(t => t.name === req.params.name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    try {
      return tool.handler(ctx, req.params.arguments || {});
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Embedded vault watcher — syncs human/tool edits in the background. Singleton
  // per vault (lease), so concurrent agent sessions don't duplicate it.
  let watcher = null;
  if (ctx) {
    watcher = await startWatcher(ctx, {
      log: (m) => process.stderr.write(`[devnexus mcp] ${m}\n`),
    });
  }

  const shutdown = () => {
    try { watcher?.stop(); } catch { /* best-effort */ }
    process.exit(0);
  };
  transport.onclose = shutdown;
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
