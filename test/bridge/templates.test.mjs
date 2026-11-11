// Each TTP template in data/boxes/<box>/ttp/templates turns its fixture text into fixture JSON. A fixture is named after
// its command's id, the template's name; `<id>~<form>` is another form of the same command (its list, a wildcard).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repoRoot = resolve(here('../..'));
const python = process.env.PYTHON ?? here('../../bridge/.venv/bin/python');
const box = (process.env.BOX_DATA_BOX ?? 'paho-gs2000-03').trim() || 'paho-gs2000-03';
const boxDataRoot = process.env.BOX_DATA_ROOT
  ? (isAbsolute(process.env.BOX_DATA_ROOT) ? process.env.BOX_DATA_ROOT : resolve(repoRoot, process.env.BOX_DATA_ROOT))
  : join(repoRoot, 'data', 'boxes', box);
const templatesDir = join(boxDataRoot, 'ttp', 'templates');
const fixturesDir = join(boxDataRoot, 'ttp', 'fixtures');
const names = existsSync(fixturesDir)
  ? readdirSync(fixturesDir).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4))
  : [];

describe.skipIf(!existsSync(python) || !existsSync(fixturesDir) || !existsSync(templatesDir))('TTP templates (needs npm run bridge:setup)', () => {
  it.each(names)('%s', (name) => {
    const out = execFileSync(python, [here('../../bridge/parse.py'), join(templatesDir, `${name.split('~')[0]}.ttp`)], { input: readFileSync(join(fixturesDir, `${name}.txt`)) });
    expect(JSON.parse(out)).toEqual(JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')));
  });
});
