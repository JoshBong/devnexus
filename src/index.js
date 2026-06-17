import { Command } from 'commander';
import { createRequire } from 'module';
import { TEMPLATE_VERSION } from './constants.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
import { initCommand } from './commands/init.js';
import { updateCommand } from './commands/update.js';
import { statusCommand } from './commands/status.js';
import { addCommand } from './commands/add.js';
import { removeCommand } from './commands/remove.js';
import { agentCommand } from './commands/agent.js';
import { doctorCommand } from './commands/doctor.js';
import { analyzeCommand } from './commands/analyze.js';
import { indexCommand } from './commands/index.js';
import { completionCommand } from './commands/completion.js';
import { upgradeCommand } from './commands/upgrade.js';
import { mcpCommand } from './commands/mcp.js';
import { syncCommand } from './commands/sync.js';
import { whyCommand } from './commands/why.js';

export function createProgram() {
  const program = new Command();

  program
    .name('devnexus')
    .description('AI-augmented workspace setup and management')
    .version(`${version} (templates v${TEMPLATE_VERSION})`);

  program.addCommand(initCommand());
  program.addCommand(updateCommand());
  program.addCommand(statusCommand());
  program.addCommand(addCommand());
  program.addCommand(removeCommand());
  program.addCommand(agentCommand());
  program.addCommand(doctorCommand());
  program.addCommand(analyzeCommand());
  program.addCommand(indexCommand());
  program.addCommand(completionCommand());
  program.addCommand(upgradeCommand());
  program.addCommand(mcpCommand());
  program.addCommand(syncCommand());
  program.addCommand(whyCommand());

  return program;
}
