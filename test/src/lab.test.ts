// The lab's lock (src/lab.ts): a password typed is checked by its SHA-256, in hex, as catalog/csp/lab.olst.json keeps it.
import { expect, it } from 'vitest';
import lab from '../../catalog/csp/lab.olst.json';
import { sha256 } from '../../src/lab';

it('hashes as the lab file keeps its lock: SHA-256, in hex', async () => {
  expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(lab.lock.sha256).toMatch(/^[0-9a-f]{64}$/);
});
