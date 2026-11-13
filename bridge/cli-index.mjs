// The CLI index (data/cli/<stream>/cli-index.source.json): which of its commands a command line runs. The sync uses it
// to count captures per command, and the recorder to find a command's TTP template, which is named after its id. The
// index lists most rpcs without their arguments (`rpc reboot`), so an rpc line is found by the rpc it starts with.

/**
 * The index command a command line runs. The syntax's words match the line's, a <key> matches any word, and a list's
 * last key may be left out (`show och` lists them all); only options (`-l 200`) may follow. An rpc is typed without
 * its `rpc`. The match with the most literal words wins, so typos and commands the index lacks match nothing.
 */
export function commandFor(commands, line) {
  const typed = line.trim().split(/\s+/);
  const key = (word) => word.startsWith('<');
  let best = null;
  let bestScore = -1;
  for (const command of commands) {
    const words = command.syntax.split(' ').slice(command.op === 'rpc' && typed[0] !== 'rpc' ? 1 : 0);
    const fits = words.every((word, i) => (i < typed.length ? key(word) || word === typed[i] : key(word) && i === words.length - 1))
      && (typed.length <= words.length || typed[words.length].startsWith('-'));
    const score = words.filter((word) => !key(word)).length;
    if (fits && score > bestScore) [best, bestScore] = [command, score];
  }
  return best;
}

/**
 * The index rpc a command line starts with, the longest (`reboot ne cold` starts with `rpc reboot`), or null. Its
 * arguments are left to the procedures, whose step lines come from the box logs (docs/procedures-plan.md#procedures).
 */
export function rpcOf(commands, line) {
  const words = line.trim().split(/\s+/);
  for (let n = words.length; n > 0; n--) {
    const command = commandFor(commands, words.slice(0, n).join(' '));
    if (command?.op === 'rpc') return command;
  }
  return null;
}
