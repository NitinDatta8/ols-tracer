// The catalog as a stream's hardware and CLI, put together from catalog/'s files, and the helpers over it. It reads no
// files itself, so it runs in the app and in Node alike: catalog-vite.ts gives it the files Vite bundles for the app,
// catalog-node.ts the same files from disk.
import type { Catalog, CliLevel, Device, End, Faceplate } from './types';

type Hardware = Pick<Catalog, 'chassis' | 'linecards' | 'pluggables'>;

type VendorMap = { vendorType?: string; linecardId?: string };
type StreamChassis = Catalog['chassis'][number] & { supportedVendorTypes?: string[]; vendorTypeMap?: VendorMap[] };

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
const nameFromId = (id: string) => id.replace(/^lc-/, '').split(/[-_]+/).map((part) => part.toUpperCase()).join(' ');

const placeholderLinecard = (id: string, name: string): Catalog['linecards'][number] => ({
  id,
  name,
  ports: [
    { id: 'P1', role: 'client', behavior: { showsInData: true }, allowedPluggables: ['SFP'] },
    { id: 'L1', role: 'line', behavior: { showsInL1: true, canLoopback: true }, allowedPluggables: ['QSFP'] },
  ],
});

const placeholderPluggable = (family: string): Catalog['pluggables'][number] => ({
  id: `${slug(family)}-placeholder`,
  name: `${family} placeholder`,
  formFactor: family,
  speed: 'N/A',
  fiber: 'SMF',
  about: `Temporary placeholder optics for ${family} ports.`,
});

const fitsAt = (chassis: Catalog['chassis'][number], index: number, width = 1) => {
  if (width <= 1) return true;
  const columns = chassis.columns ?? chassis.slots.length;
  if ((index % columns) + width > columns || index + width > chassis.slots.length) return false;
  const start = Number(chassis.slots[index].id);
  return Number.isFinite(start)
    && Array.from({ length: width }, (_, offset) => Number(chassis.slots[index + offset]?.id) === start + offset).every(Boolean);
};

function hydrate(chassis: Catalog['chassis'], linecards: Catalog['linecards'], pluggables: Catalog['pluggables']) {
  const nextChassis = chassis.map((c) => ({ ...c, slots: c.slots.map((s) => ({ ...s, allowedLinecards: [...s.allowedLinecards] })) }));
  const nextLinecards = [...linecards];
  const nextPluggables = [...pluggables];
  const knownLinecards = new Set(nextLinecards.map((card) => card.id));
  const widths = new Map(nextLinecards.map((card) => [card.id, card.width ?? 1]));
  const knownPluggables = new Set(nextPluggables.map((plug) => plug.id));
  const knownFamilies = new Set(nextPluggables.map((plug) => plug.formFactor));

  for (const chassisDef of nextChassis as StreamChassis[]) {
    const mapByVendor = new Map((chassisDef.vendorTypeMap ?? [])
      .filter((entry): entry is Required<Pick<VendorMap, 'vendorType' | 'linecardId'>> => !!entry.vendorType && !!entry.linecardId)
      .map((entry) => [entry.vendorType, entry.linecardId]));

    const supported = (chassisDef.supportedVendorTypes ?? []).filter((type): type is string => typeof type === 'string' && !!type);
    const linecardsForStream = supported.map((vendorType) => ({ id: mapByVendor.get(vendorType) ?? `lc-${slug(vendorType)}`, name: vendorType }));
    if (!linecardsForStream.length) continue;

    for (const card of linecardsForStream) {
      if (!knownLinecards.has(card.id)) {
        nextLinecards.push(placeholderLinecard(card.id, card.name));
        knownLinecards.add(card.id);
        widths.set(card.id, 1);
      }
    }

    for (const [index, slot] of chassisDef.slots.entries()) {
      const allowedByFit = linecardsForStream
        .map((card) => card.id)
        .filter((linecardId) => fitsAt(chassisDef, index, widths.get(linecardId) ?? 1));
      slot.allowedLinecards = [...new Set([...slot.allowedLinecards, ...allowedByFit])];
    }
  }

  for (const slot of nextChassis.flatMap((c) => c.slots)) {
    for (const linecardId of slot.allowedLinecards) {
      if (!knownLinecards.has(linecardId)) {
        nextLinecards.push(placeholderLinecard(linecardId, nameFromId(linecardId)));
        knownLinecards.add(linecardId);
        widths.set(linecardId, 1);
      }
    }
  }

  const missingFamilies = new Set(nextLinecards.flatMap((card) => card.ports.flatMap((port) => port.allowedPluggables))
    .filter((entry) => !knownPluggables.has(entry) && !knownFamilies.has(entry)));

  for (const family of missingFamilies) {
    const placeholder = placeholderPluggable(family);
    if (!knownPluggables.has(placeholder.id)) {
      nextPluggables.push(placeholder);
      knownPluggables.add(placeholder.id);
      knownFamilies.add(placeholder.formFactor);
    }
  }

  return { chassis: nextChassis, linecards: nextLinecards, pluggables: nextPluggables };
}

/**
 * An entry of common/faceplates.json: the deck's picture of a front and where things are on it, or `like` another
 * card's; and what the deck calls the card, on which PDF pages, and its facts.
 */
type FaceEntry = Partial<Faceplate> & { like?: string; name?: string; page?: string; about?: string; specs?: Record<string, string> };
export type Faces = { chassis?: Record<string, FaceEntry>; linecards?: Record<string, FaceEntry> };

/** Gives each item the deck draws its faceplate, and the deck's facts for its datasheet (behind any it has already). */
function withFaces<T extends Catalog['chassis'][number] | Catalog['linecards'][number]>(items: T[], entries: Record<string, FaceEntry> = {}): T[] {
  return items.map((item) => {
    const entry = entries[item.id];
    if (!entry) return item;
    const { image, size, ports, slots, specs } = entry.like ? entries[entry.like] : entry;
    return {
      ...item,
      faceplate: { image: image!, size: size!, ...(ports && { ports }), ...(slots && { slots }) },
      image: item.image ?? image,
      about: item.about ?? entry.about,
      specs: { ...(entry.name && { 'Deck name': entry.name }), ...(entry.specs ?? specs), ...(entry.page && { 'Deck pages': entry.page }), ...item.specs },
    };
  });
}

/**
 * `catalogFor`, over the catalog/ files that `read` gives by name (csp/linecards.json), or undefined for one that isn't
 * there. A stream's hardware (chassis/linecards/pluggables) is its own files only, plus its `testers.json`: hardware kept
 * by hand, which the IIVI profiles don't have and the syncs never overwrite, such as a BERT. `common/` holds `cli.json`
 * and `faceplates.json`, the fronts the product deck draws, also kept by hand. Each stream is put together once.
 */
export function catalogs(read: (name: string) => unknown) {
  const cache = new Map<string, Catalog>();
  return (stream: string): Catalog => {
    const merge = <K extends keyof Hardware>(kind: K) =>
      [...((read(`${stream}/${kind}.json`) as Hardware[K]) ?? []), ...((read(`${stream}/testers.json`) as Partial<Hardware>)?.[kind] ?? [])] as Catalog[K];
    if (!cache.has(stream)) {
      const base = hydrate(merge('chassis'), merge('linecards'), merge('pluggables'));
      const faces = read('common/faceplates.json') as Faces | undefined;
      cache.set(stream, {
        chassis: withFaces(base.chassis, faces?.chassis),
        linecards: withFaces(base.linecards, faces?.linecards),
        pluggables: base.pluggables,
        cli: { ...(read('common/cli.json') as Catalog['cli']), ...(read(`${stream}/cli.json`) as Catalog['cli']) },
      } as Catalog);
    }
    return cache.get(stream)!;
  };
}

export const byId = <T extends { id: string }>(items: T[], id: string | undefined) => items.find((x) => x.id === id);

/** The linecard id of a card the box calls `moduleType` (show card's module-type), as hydrate maps it: TMUXC1125 → lc-c1125. */
export const linecardFor = (chassis: Catalog['chassis'][number], moduleType: string) =>
  (chassis as StreamChassis).vendorTypeMap?.find((m) => m.vendorType === moduleType)?.linecardId ?? `lc-${slug(moduleType)}`;

/** The CLI command for one level, e.g. `show card 1-3`. */
export const cli = (cat: Catalog, level: CliLevel, vars: { chassis?: number; slot?: string; port?: string }) => {
  const v = { ...vars, port: vars.port && cliPort(vars.port) };
  return cat.cli[level]?.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k as keyof typeof v] ?? m)) ?? '';
};

/** A catalog port id as the box's CLI names it: an 800MX's PORT4 is 4, a C1125's AD1 is ad1 (as box 3 prints them). */
export const cliPort = (id: string) => id.replace(/^PORT(\d+)$/, '$1').toLowerCase();

/** Where something is in the box's CLI: 1-7 for a card, 1-7-4 for a port. Live values are keyed by it. */
export const cliAddress = (chassis: number, slot: string, port?: string) => [chassis, slot, ...(port ? [cliPort(port)] : [])].join('-');

/** The port of device `d` at a CLI address (1-7-5 → slot 7, PORT5), or null when it is not one of d's ports (BERT:P1). */
export function endAt(cat: Catalog, d: Device, address: string): End | null {
  const [no, slot, port, ...rest] = address.split('-');
  const p = byId(cat.linecards, d.slots[slot]?.linecard)?.ports.find((x) => cliPort(x.id) === port);
  return p && !rest.length && Number(no) === (d.chassisNo ?? 1) ? { device: d.id, slot, port: p.id } : null;
}

/** The CLI mode (index into `cli.modes`) after `command` ran in `mode`: next mode's `enter` goes one deeper, `exit` goes one back. */
export const nextMode = (cat: Catalog, mode: number, command: string) =>
  command === cat.cli.modes[mode + 1]?.enter ? mode + 1 : command === 'exit' ? Math.max(0, mode - 1) : mode;
