#!/usr/bin/env node
// Splits a hand-made session log (`script` over ssh, in <run>/raw/session.log) into the recorder's run layout: one
// raw/NNN_<slug>.txt per command, cut the way the bridge's poller cuts it (the lines between the command's echo and the
// next prompt), and raw/index.jsonl. Only hand captures need this; the recorder writes the layout itself.
// Usage: node scripts/split-session-log.mjs data/boxes/box3/runs/run-01-healthy
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = join(process.argv[2] ?? '', 'raw');
const PROMPT = /^[\w.-]+@[\w.-]+[>#] ?/; // admin@PAHO-GS2000-03> or, in configure mode, #

/** A line as the terminal showed it: a backspace moves left, other characters overwrite, the bell is dropped. */
const render = (line) => {
  const out = [];
  let at = 0;
  for (const ch of line) {
    if (ch === '\b') at = Math.max(0, at - 1);
    else if (ch !== '\x07') out[at++] = ch;
  }
  return out.join('').trimEnd();
};

const lines = readFileSync(join(raw, 'session.log'), 'utf8').replace(/\r/g, '').split('\n');
const done = lines.findIndex((l) => l.startsWith('Script done on '));
const end = done < 0 ? lines.length : done;
const prompts = lines.map((l, i) => (i < end && PROMPT.test(l) ? i : -1)).filter((i) => i >= 0);

for (const f of readdirSync(raw)) if (/^\d{3}_.*\.txt$/.test(f)) rmSync(join(raw, f));
const index = [];
prompts.forEach((p, k) => {
  const cmd = render(lines[p]).replace(PROMPT, '').trim();
  if (!cmd) return; // Enter on its own
  const n = index.length;
  const slug = cmd.replace(/\*/g, 'all').replace(/\?/g, 'help').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  const file = `${String(n).padStart(3, '0')}_${slug}.txt`;
  writeFileSync(join(raw, file), lines.slice(p + 1, prompts[k + 1] ?? end).join('\n') + '\n');
  index.push({ n, cmd, at: null, source: 'hand', file, ok: k + 1 < prompts.length });
});
writeFileSync(join(raw, 'index.jsonl'), index.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`${index.length} commands → ${raw}`);
