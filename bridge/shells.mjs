// The poller's shells: a command's output read back from a shell, and a list of commands shared out over several.

/**
 * A shell the poller types into, one command at a time; `open` until it closes, or is dropped. A command is done when
 * the last line of output matches `prompt` and stays quiet for `settle` ms; after `timeout` ms it gets a Ctrl-C.
 */
export function worker(ch, { prompt: PROMPT, timeout, settle }) {
  let buf = '';
  let wake = () => {};
  const w = { ch, open: true, prompt, output };
  ch.on('data', (d) => { buf += d; wake(); }).on('close', () => { w.open = false; wake(); });
  const lines = () => buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
  /** True once the shell shows its prompt and stays quiet for `quietMs`; false after `ms`, or when it closes. */
  function prompt(ms, quietMs = settle) {
    return new Promise((done) => {
      let quiet;
      const give = setTimeout(() => done(false), ms);
      wake = () => {
        clearTimeout(quiet);
        if (!w.open) { clearTimeout(give); return done(false); }
        if (PROMPT.test(lines().at(-1))) quiet = setTimeout(() => { clearTimeout(give); done(true); }, quietMs);
      };
      wake();
    });
  }
  /** A command's output, the lines between its echo and the next prompt, and whether the prompt came back in `ms`. */
  async function output(cmd, ms = timeout) {
    buf = '';
    ch.write(cmd + '\n');
    if (await prompt(ms)) return { raw: lines().slice(1, -1).join('\n'), ok: true };
    const raw = lines().slice(1).join('\n');
    if (!w.open) return { raw, ok: false }; // closed: nothing to stop, and nothing to write to
    ch.write('\x03'); // Ctrl-C, so a hung command does not spill into the next one
    await prompt(timeout);
    return { raw, ok: false };
  }
  return w;
}

/**
 * Runs `each(item, w)` for every item, each on whichever open shell is free, while `go()`. The first shell starts at
 * once, each other one once its `ready[i]` resolves; one that comes up after the last item is handed out finds none.
 * Resolves when every item handed out is done, with the shells that took any.
 */
export async function shareOut(ws, ready, items, each, go = () => true) {
  let next = 0;
  const busy = [];
  const took = new Set();
  const share = (w) => busy.push((async () => {
    while (w.open && go() && next < items.length) {
      took.add(w);
      await each(items[next++], w);
    }
  })());
  share(ws[0]);
  ws.slice(1).forEach((w, i) => ready[i + 1].then(() => share(w)));
  await busy[0];
  await Promise.all(busy); // the items still running on the others
  return took;
}
