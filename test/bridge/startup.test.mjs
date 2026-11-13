// The bridge refuses to start when it could parse nothing: no Python, or no templates where its data root says. Each
// case starts bridge/server.mjs on its own, which exits before it listens.
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const server = fileURLToPath(new URL('../../bridge/server.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'ols-startup-'));
/** Starts the bridge with `env`: its exit code and what it printed. A bridge that starts listening is stopped after 4 s. */
const start = (env) => new Promise((done) => {
  execFile(process.execPath, [server], { env: { PATH: process.env.PATH, BRIDGE_PORT: '0', ...env }, timeout: 4000 }, (e, stdout, stderr) => done({ code: e?.code ?? 0, stderr }));
});

describe('the bridge at start', () => {
  it('refuses to start with no Python', async () => {
    const { code, stderr } = await start({ PYTHON: join(root, 'no-python'), BOX_DATA_ROOT: join(root, 'box') });
    expect([code, stderr]).toEqual([1, expect.stringContaining('no Python at')]);
  });

  it('refuses to start with no templates in its data root', async () => {
    const { code, stderr } = await start({ PYTHON: process.execPath, BOX_DATA_ROOT: join(root, 'box') });
    expect([code, stderr]).toEqual([1, expect.stringContaining(`no TTP templates at ${join(root, 'box', 'ttp', 'templates')}`)]);
  });
});
