// POST /show: one show command asked for (by the MCP server's run_show), checked here before anything reaches the box.
// The poller runs it on a shell of the open session and saves it in the latest run, as a typed show is (source mcp).
// A line runs only if typed commands could run again (showOf) and the CLI index has it as a show.
import { commandFor } from './cli-index.mjs';
import { COMMANDS } from './recorder.mjs';
import { showOf } from './typed.mjs';

/** A line's show command, { cmd }, or why it may not run, { why }. */
export function showLine(line) {
  const { cmd, why } = showOf(line);
  if (why) return { why };
  return commandFor(COMMANDS, cmd)?.op === 'show' ? { cmd } : { why: `${cmd} is not a show command in the CLI index` };
}
