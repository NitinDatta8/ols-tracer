// POST /show: one show command asked for (by the MCP server's run_show), run on a shell of the open session and answered
// with its raw output and TTP parse. Nothing of it is saved. A line runs only if typed commands could run again
// (showOf) and the CLI index has it as a show.
import { commandFor } from './cli-index.mjs';
import { COMMANDS, parse } from './recorder.mjs';
import { showOf } from './typed.mjs';

/** A line's show command, { cmd }, or why it may not run, { why }. */
export function showLine(line) {
  const { cmd, why } = showOf(line);
  if (why) return { why };
  return commandFor(COMMANDS, cmd)?.op === 'show' ? { cmd } : { why: `${cmd} is not a show command in the CLI index` };
}

/** Runs show command `cmd` on shell worker `w` (shells.mjs): when, its output, whether its prompt came back, its parse. */
export async function runShow(w, cmd) {
  const at = Date.now();
  const { raw, ok } = await w.output(cmd);
  return { cmd, at, ok, raw, ...(ok ? await parse(cmd, raw) : {}) };
}
