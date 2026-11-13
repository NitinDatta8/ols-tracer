// The lab file (catalog/csp/lab.olst.json): the fixed lab the app shows everyone, which the bridge serves and saves,
// and a commit shares. A save names the mtime of the file it was made on, and is refused once the file has changed since
// (a pull, another view's save), so no one's edit overwrites another's. A box's sync changes only its own device, in
// the file as it is, locked or not: the lock is the app's, for people, and the hardware is what it is.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changes } from './changes.mjs';

/** The lab file: under catalog/, or BRIDGE_CATALOG (the tests' own). */
export const LAB = join(process.env.BRIDGE_CATALOG ?? fileURLToPath(new URL('../catalog', import.meta.url)), 'csp', 'lab.olst.json');

/** The lab, and its file's mtime in ms; null with no file. */
export function readLab() {
  if (!existsSync(LAB)) return null;
  return { topology: JSON.parse(readFileSync(LAB, 'utf8')), mtime: statSync(LAB).mtimeMs };
}

/** Writes `topology` as the lab file in one step, a whole file renamed over it, and gives its new mtime. */
function write(topology) {
  const tmp = `${LAB}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(topology, null, 2)}\n`);
  renameSync(tmp, LAB);
  return statSync(LAB).mtimeMs;
}

/** PUT /lab: the lab saved as `topology`, made on the file of `mtime`: { mtime }, or { status, why } when it isn't. */
export function saveLab(topology, mtime) {
  const t = topology;
  if (!t || t.version !== 1 || t.stream !== 'csp' || !Array.isArray(t.devices) || !Array.isArray(t.links)) return { status: 400, why: "A topology of csp's, with its devices and links" };
  if (!existsSync(LAB)) return { status: 404, why: 'No lab file' };
  if (statSync(LAB).mtimeMs !== mtime) return { status: 409, why: 'The lab file changed since it was loaded: reload the page to get it' };
  return { mtime: write(t) };
}

/**
 * POST /lab/sync: box `host` as its physical view synced it, applied to its device in the file as it is: `slots`, its
 * cards and pluggables, and `links`, every fiber on it. { was, mtime, changed }: the file's mtime before and after, and
 * what changed (none, and nothing written, when the file had it already); or { status, why }.
 */
export function syncLab(host, sync) {
  const lab = readLab();
  if (!lab) return { status: 404, why: 'No lab file' };
  const { topology: t, mtime } = lab;
  const { slots, links } = sync ?? {};
  if (!slots || typeof slots !== 'object' || Array.isArray(slots) || !Array.isArray(links) || !links.every((l) => typeof l?.id === 'string' && l.a && l.b)) {
    return { status: 400, why: 'slots, and the links on the device' };
  }
  const ds = t.devices.filter((d) => d.host?.trim() === host);
  if (ds.length !== 1) return { status: 409, why: `${ds.length ? `${ds.length} devices` : 'No device'} in the lab file at ${host}` };
  const [d] = ds;
  const ids = new Set(t.devices.map((x) => x.id));
  const on = (l) => l.a.device === d.id || l.b.device === d.id;
  if (!links.every((l) => on(l) && ids.has(l.a.device) && ids.has(l.b.device))) return { status: 409, why: `The lab file changed: its device at ${host} is ${d.id}, so reload the page` };
  const changed = changes({ slots: d.slots, links: t.links.filter(on) }, { slots, links });
  if (!changed.length) return { was: mtime, mtime, changed };
  d.slots = slots;
  t.links = [...t.links.filter((l) => !on(l)), ...links];
  return { was: mtime, mtime: write(t), changed };
}
