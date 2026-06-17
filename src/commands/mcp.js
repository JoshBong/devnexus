import { Command } from 'commander';

export function mcpCommand() {
  const cmd = new Command('mcp')
    .description('Run the devnexus MCP server (stdio) — exposes the vault as agent tools')
    .option('--workspace <dir>', 'Workspace root (defaults to cwd, walking up to .workspace-config)')
    .action(async (opts) => {
      // The MCP protocol owns stdout. Never write to stdout here — only stderr.
      // Import lazily so the SDK only loads when the server actually runs.
      const { startMcpServer } = await import('../mcp/server.js');
      try {
        await startMcpServer({ workspace: opts.workspace });
      } catch (err) {
        process.stderr.write(`[devnexus mcp] fatal: ${err.message}\n`);
        process.exit(1);
      }
    });

  return cmd;
}
