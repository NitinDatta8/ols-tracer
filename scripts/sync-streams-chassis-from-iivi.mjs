#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  out: 'catalog',
  linecards: 'catalog/common/linecards.json',
  dryRun: false,
};

const usage = [
  'Sync stream list and chassis slot compatibility from IIVI platform profiles.',
  '',
  'Usage:',
  '  npm run sync:platform -- [--iivi-root <path>] [--out <path>] [--linecards <path>] [--dry-run]',
].join('\n');

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (arg === '--dry-run') {
    options.dryRun = true;
    continue;
  }
  if (arg === '--iivi-root' || arg === '--out' || arg === '--linecards') {
    const val = argv[i + 1];
    if (!val) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    i += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const fromRepo = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));
const sortedNums = (arr) => [...new Set(arr)].sort((a, b) => a - b);
const keyToSlots = (obj, key) => sortedNums((obj?.[key] ?? []).map(Number).filter(Number.isFinite));
const title = (id) => id.toUpperCase();

const iiviRoot = fromRepo(options.iiviRoot);
const catalogRoot = fromRepo(options.out);
const linecardsPath = fromRepo(options.linecards);
const platformRoot = join(iiviRoot, 'profile/cu/platform');
const cliRoot = join(iiviRoot, 'profile/cu/cli');
const l1Root = join(iiviRoot, 'profile/cu/l1');
const streamsPath = join(catalogRoot, 'streams.json');

const knownLinecards = JSON.parse(readFileSync(linecardsPath, 'utf8'));
const linecardWidths = new Map(knownLinecards.map((linecard) => [linecard.id, linecard.width ?? 1]));

const vendorToLinecard = {
  TMUXC_25: 'lc-c25',
  TMUXC925: 'lc-c925',
  TMUXC1125: 'lc-c1125',
  '400MXS': 'lc-400mx',
  '800MX': 'lc-800mx',
};

const streamIds = readdirSync(platformRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'common')
  .map((entry) => entry.name)
  .filter((id) => {
    const chassis = join(platformRoot, id, 'CHASSIS.json');
    return existsSync(chassis) && existsSync(join(cliRoot, id)) && existsSync(join(l1Root, id));
  })
  .sort();

if (!streamIds.length) throw new Error(`No stream folders with CHASSIS profiles under ${platformRoot}`);

const streams = streamIds.map((id) => ({ id, name: title(id) }));

const outputPlan = [];
outputPlan.push({ path: streamsPath, json: streams });

for (const stream of streamIds) {
  const chassisPath = join(platformRoot, stream, 'CHASSIS.json');
  const parsed = JSON.parse(readFileSync(chassisPath, 'utf8'));
  const chassisRoot = parsed.CHASSIS;
  if (!chassisRoot) throw new Error(`CHASSIS root missing in ${chassisPath}`);

  const attrs = chassisRoot.attributes ?? {};
  const lineSlots = keyToSlots(attrs, 'linecardslot');
  if (!lineSlots.length) throw new Error(`linecardslot is empty in ${chassisPath}`);

  const vendorModules = chassisRoot.modules?.LINECARD?.modules ?? {};
  const vendorTypes = (vendorModules.key ?? []).filter((vendorType) => typeof vendorType === 'string');
  const mappedVendors = vendorTypes
    .map((vendorType) => ({
      vendorType,
      linecardId: vendorToLinecard[vendorType],
      profile: vendorModules[vendorType]?.filename,
    }))
    .filter((entry) => entry.linecardId && linecardWidths.has(entry.linecardId));

  const mappedLinecards = [...new Set(mappedVendors.map((entry) => entry.linecardId))];
  const fallbackLinecards = knownLinecards.map((linecard) => linecard.id).filter((linecardId) => linecardWidths.has(linecardId));
  const linecardsForSlots = mappedLinecards.length ? mappedLinecards : fallbackLinecards;
  if (!linecardsForSlots.length) throw new Error(`No linecards available for ${stream} (${chassisPath})`);

  const fitsAt = (slotIndex, linecardId) => {
    const width = linecardWidths.get(linecardId) ?? 1;
    if (width <= 1) return true;
    if (slotIndex % width !== 0 || slotIndex + width > lineSlots.length) return false;
    return Array.from({ length: width }, (_, offset) => lineSlots[slotIndex + offset] === lineSlots[slotIndex] + offset).every(Boolean);
  };

  const slots = lineSlots.map((slot, index) => ({
    id: String(slot),
    allowedLinecards: linecardsForSlots.filter((linecardId) => fitsAt(index, linecardId)),
  }));

  const chassisCatalog = [
    {
      id: `ch-${lineSlots.length}slot`,
      name: `${lineSlots.length}-Slot Chassis`,
      category: title(stream),
      columns: lineSlots.length % 4 === 0 ? 4 : Math.min(4, lineSlots.length),
      psus: keyToSlots(attrs, 'psuslot').length,
      fans: keyToSlots(attrs, 'fanslot').length,
      mgmtPorts: { front: ['USB-C', 'CON', 'MON'], back: ['NMS', 'NMS1', 'NMS2'] },
      slotDomains: {
        linecard: lineSlots.map(String),
        psu: keyToSlots(attrs, 'psuslot').map(String),
        fan: keyToSlots(attrs, 'fanslot').map(String),
        fp: keyToSlots(attrs, 'fpslot').map(String),
        cu: keyToSlots(attrs, 'cuslot').map(String),
        mux: keyToSlots(attrs, 'muxslot').map(String),
      },
      supportedVendorTypes: vendorTypes,
      vendorTypeMap: mappedVendors,
      linecardMappingComplete: mappedLinecards.length > 0,
      slots,
    },
  ];

  outputPlan.push({ path: join(catalogRoot, stream, 'chassis.json'), json: chassisCatalog });
}

if (options.dryRun) {
  for (const file of outputPlan) {
    console.log(`--- ${file.path}`);
    console.log(`${JSON.stringify(file.json, null, 2)}\n`);
  }
  process.exit(0);
}

for (const file of outputPlan) {
  const next = `${JSON.stringify(file.json, null, 2)}\n`;
  const current = (() => {
    try {
      return readFileSync(file.path, 'utf8');
    } catch {
      return '';
    }
  })();
  if (current === next) {
    console.log(`[sync:platform] up to date (${file.path})`);
    continue;
  }
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, next, 'utf8');
  console.log(`[sync:platform] wrote ${file.path}`);
}

console.log(`[sync:platform] streams: ${streamIds.join(', ')}`);
