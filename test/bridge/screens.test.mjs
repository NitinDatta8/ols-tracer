// A BERT's screen (/vnc): the page's noVNC relayed byte for byte to the VNC server on a tester's IP in the lab file,
// here a fake one on 127.0.0.1, and refused for any other host or origin. No box session is opened (test/fakes/lab.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalog, socket, until } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe("a BERT's screen", () => {
  it("relays a tester's VNC server both ways, closes it with the page and the page with it, and reaches nothing else", async () => {
    const got = [];
    let opened = 0;
    let closed = 0;
    const vnc = createServer((c) => { opened++; c.write('RFB 003.008\n'); c.on('data', (d) => got.push(String(d))).on('close', () => closed++); });
    await new Promise((ok) => vnc.listen(0, '127.0.0.1', ok));
    process.env.BERT_VNC_PORT = String(vnc.address().port);
    mkdirSync(join(catalog, 'csp'), { recursive: true });
    writeFileSync(join(catalog, 'csp', 'testers.json'), readFileSync(new URL('../../catalog/csp/testers.json', import.meta.url)));
    writeFileSync(join(catalog, 'csp', 'lab.olst.json'), JSON.stringify({ version: 1, stream: 'csp', links: [], devices: [
      { id: 'd1', chassis: 'ch-bert-tester', name: 'BERT-1', x: 0, y: 0, host: '127.0.0.1', slots: {} },
      { id: 'd2', chassis: 'ch-8slot', name: 'Site-2', x: 0, y: 0, host: 'localhost', slots: {} },
    ] }));

    const page = socket('/vnc?host=127.0.0.1');
    await page.opened;
    await until(() => page.got === 'RFB 003.008\n', 3000, "the BERT's greeting on the page");
    page.send(Buffer.from('RFB 003.008\n'));
    await until(() => got.join('') === 'RFB 003.008\n', 3000, "the page's answer on the BERT");
    page.close();
    await until(() => closed === 1, 3000, 'the VNC connection to close with the page');

    for (const [path, origin] of [
      ['/vnc?host=localhost', undefined], // a box, not a tester
      ['/vnc?host=elsewhere.test', undefined], // no device's
      ['/vnc?host=127.0.0.1', 'http://evil.example'],
    ]) await expect(socket(path, origin).opened, `${origin} ${path}`).rejects.toThrow();
    expect(opened).toBe(1);

    await new Promise((ok) => vnc.close(ok)); // the BERT's VNC server down: the page is closed
    const late = socket('/vnc?host=127.0.0.1');
    await late.opened;
    await new Promise((ok) => late.once('close', ok));
  });
});
