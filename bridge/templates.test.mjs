// Each TTP template in templates/ turns the sample output in fixtures/<name>.txt into fixtures/<name>.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const python = process.env.PYTHON ?? here('.venv/bin/python');
const names = readdirSync(here('fixtures')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));

describe.skipIf(!existsSync(python))('TTP templates (needs npm run bridge:setup)', () => {
  it.each(names)('%s', (name) => {
    const out = execFileSync(python, [here('parse.py'), here(`templates/${name}.ttp`)], { input: readFileSync(here(`fixtures/${name}.txt`)) });
    expect(JSON.parse(out)).toEqual(JSON.parse(readFileSync(here(`fixtures/${name}.json`), 'utf8')));
  });
});
