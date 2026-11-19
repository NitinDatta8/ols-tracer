#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveWidthFromSlots,
  linecardIdForVendorType,
  linecardKnown,
  linecardWidthOverrideForVendorType,
  uniqueSortedNums,
} from './sync-profile-utils.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  out: 'catalog',
  dryRun: false,
};

const usage = [
  'Sync stream list and chassis slot compatibility from IIVI platform profiles.',
  '',
  'Usage:',
  '  npm run sync:platform -- [--iivi-root <path>] [--out <path>] [--dry-run]',
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
  if (arg === '--iivi-root' || arg === '--out') {
    const val = argv[i + 1];
    if (!val) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    i += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const fromRepo = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));
const keyToSlots = (obj, key) => uniqueSortedNums(obj?.[key] ?? []);
const title = (id) => id.toUpperCase();
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const compactText = (value) => text(value).replace(/\s+/g, ' ');
const LED_COLORS = new Set(['RED', 'GREEN', 'AMBER', 'BLUE', 'YELLOW', 'WHITE']);

const SLOT_DOMAIN_BY_FAMILY = {
  LINECARD: { key: 'linecardslot', domain: 'linecard' },
  PSU: { key: 'psuslot', domain: 'psu' },
  FAN: { key: 'fanslot', domain: 'fan' },
  UI: { key: 'fpslot', domain: 'fp' },
  PANELCIM: { key: 'fpslot', domain: 'fp' },
  CU: { key: 'cuslot', domain: 'cu' },
  MUX: { key: 'muxslot', domain: 'mux' },
};

const pushAlias = (rules, seen, from, to, source, condition = '') => {
  const left = text(from);
  const right = text(to);
  const when = text(condition);
  if (!left || !right || left === right) return;
  const key = [left, right, source, when].join('\u0000');
  if (seen.has(key)) return;
  seen.add(key);
  rules.push({ from: left, to: right, source, ...(when ? { condition: when } : {}) });
};

function collectLinecardAliases(platformRoot) {
  const rules = [];
  const seen = new Set();

  for (const [from, mapped] of Object.entries(platformRoot?.cardname ?? {})) {
    if (typeof mapped === 'string') {
      pushAlias(rules, seen, from, mapped, 'cardname');
      continue;
    }
    if (mapped && typeof mapped === 'object') {
      pushAlias(rules, seen, from, mapped.target, 'cardname', mapped.condition?.expression ?? '');
    }
  }

  for (const [from, to] of Object.entries(platformRoot?.cardclass ?? {})) {
    pushAlias(rules, seen, from, to, 'cardclass');
  }

  for (const [from, to] of Object.entries(platformRoot?.cardpreconf ?? {})) {
    pushAlias(rules, seen, from, to, 'cardpreconf');
  }

  for (const [from, entries] of Object.entries(platformRoot?.cardnamemapping ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      pushAlias(rules, seen, from, entry.newcardname, 'cardnamemapping', entry.condition ?? '');
    }
  }

  return rules;
}

function collectNonLinecardFamilies(chassisRoot) {
  const attrs = chassisRoot?.attributes ?? {};
  const modulesRoot = chassisRoot?.modules ?? {};
  const familyKeys = [...new Set([
    ...((modulesRoot.key ?? []).filter((value) => typeof value === 'string')),
    ...Object.keys(modulesRoot).filter((value) => value !== 'key'),
  ])]
    .filter((family) => family !== 'LINECARD')
    .sort();

  const out = {};
  for (const family of familyKeys) {
    const familyRoot = modulesRoot?.[family];
    if (!familyRoot || typeof familyRoot !== 'object') continue;

    const familyModules = familyRoot.modules ?? {};
    const moduleTypes = (familyModules.key ?? []).filter((value) => typeof value === 'string');
    const slotRef = SLOT_DOMAIN_BY_FAMILY[family];

    out[family] = {
      ...(slotRef ? { slotDomain: slotRef.domain, slots: keyToSlots(attrs, slotRef.key).map(String) } : {}),
      modules: moduleTypes.map((vendorType) => {
        const def = familyModules[vendorType];
        const a = def?.attributes;
        return {
          vendorType,
          ...(typeof def?.filename === 'string' ? { profile: def.filename } : {}),
          ...(typeof def?.dataref === 'string' ? { dataref: def.dataref } : {}),
          ...(typeof a?.type === 'string' ? { type: a.type } : {}),
          ...(typeof a?.cardtype === 'string' ? { cardtype: a.cardtype } : {}),
          ...(a?.slot_occupied && typeof a.slot_occupied === 'object' ? { slotOccupied: a.slot_occupied } : {}),
          ...(a?.tray !== undefined ? { tray: a.tray } : {}),
        };
      }),
    };
  }

  return out;
}

function parseLedStateKey(key) {
  const parts = String(key).split('_');
  if (parts[0] !== 'CMD' || parts[1] !== 'APS' || parts[2] !== 'LED') return null;

  let index = 3;
  let commandType = 'combined';
  if (parts[index] === 'MODE' || parts[index] === 'COLOR') {
    commandType = parts[index].toLowerCase();
    index += 1;
  }

  const selectorA = parts[index];
  const selectorB = parts[index + 1];
  const op = parts[index + 2];
  const laneRaw = parts[index + 3];
  const activity = parts[index + 4];
  if (!selectorA || !selectorB || !op || !laneRaw || !activity) return null;

  const lane = Number.parseInt(laneRaw, 10);
  return {
    commandType,
    selectorA: selectorA.toLowerCase(),
    selectorB: selectorB.toLowerCase(),
    op,
    lane: Number.isFinite(lane) ? lane : laneRaw,
    activity: activity.toLowerCase(),
  };
}

function parseLedCommand(command) {
  const normalized = compactText(command);
  if (!normalized) return null;

  const match = normalized.match(/^LED\s*(\d+)\s+(MODE|COLOR)\s+(.+)$/i);
  if (!match) return { raw: normalized };

  const led = Number.parseInt(match[1], 10);
  const operation = match[2].toUpperCase();
  const value = match[3].trim();
  const parts = value.split(/\s+/);

  const parsed = {
    raw: normalized,
    ...(Number.isFinite(led) ? { led } : {}),
    operation,
  };

  if (operation === 'COLOR') {
    parsed.color = value;
    return parsed;
  }

  const [first, ...rest] = parts;
  if (first && LED_COLORS.has(first.toUpperCase()) && rest.length) {
    parsed.color = first;
    parsed.mode = rest.join(' ');
    return parsed;
  }

  parsed.mode = value;
  return parsed;
}

function resolveLedCommand(section, key) {
  const path = [];
  const seen = new Set();
  let currentKey = String(key);

  while (currentKey) {
    if (seen.has(currentKey)) {
      return { cycle: [...path, currentKey] };
    }
    seen.add(currentKey);
    path.push(currentKey);

    const entry = section?.[currentKey];
    if (!entry || typeof entry !== 'object') {
      return { missing: currentKey, path };
    }

    if (typeof entry.cmd === 'string' && text(entry.cmd)) {
      return { command: compactText(entry.cmd), path };
    }

    if (typeof entry.ref === 'string' && text(entry.ref)) {
      currentKey = text(entry.ref);
      continue;
    }

    return { invalid: currentKey, path };
  }

  return null;
}

function collectLedStateEntries(section) {
  if (!section || typeof section !== 'object') return [];

  return Object.entries(section).map(([key, raw]) => {
    const directCmd = raw && typeof raw === 'object' && typeof raw.cmd === 'string' ? compactText(raw.cmd) : '';
    const ref = raw && typeof raw === 'object' && typeof raw.ref === 'string' ? text(raw.ref) : '';
    const resolved = resolveLedCommand(section, key);
    const resolvedCmd = resolved?.command;

    return {
      key,
      ...(parseLedStateKey(key) ?? {}),
      ...(directCmd ? { cmd: directCmd } : {}),
      ...(ref ? { ref } : {}),
      ...(resolvedCmd ? { resolvedCmd, resolved: parseLedCommand(resolvedCmd) } : {}),
      ...(ref && Array.isArray(resolved?.path) && resolved.path.length > 1 ? { refChain: resolved.path.slice(1) } : {}),
      ...(Array.isArray(resolved?.cycle) ? { cycle: resolved.cycle } : {}),
      ...(typeof resolved?.missing === 'string' ? { missingRef: resolved.missing } : {}),
      ...(typeof resolved?.invalid === 'string' ? { invalidRef: resolved.invalid } : {}),
    };
  });
}

function collectLedRegisterEntries(section) {
  if (!section || typeof section !== 'object') return [];

  return Object.entries(section).map(([key, value]) => {
    const ledRef = compactText(value);
    const led = Number.parseInt(ledRef.match(/^LED\s*(\d+)$/i)?.[1] ?? '', 10);
    const parsed = key.match(/^PREFIX_(CE_)?(OP\d+)_(.+)$/);

    return {
      key,
      ...(parsed
        ? {
          scope: parsed[1] ? 'ce' : 'default',
          op: parsed[2],
          signal: parsed[3],
        }
        : {}),
      ledRef,
      ...(Number.isFinite(led) ? { led } : {}),
    };
  });
}

function collectLedCardOpEntries(section) {
  if (!section || typeof section !== 'object') return [];

  return Object.entries(section)
    .filter(([key]) => key !== '__description')
    .map(([source, target]) => {
      const cardOp = source.match(/^(OP\d+)_/)?.[1];
      const sourceCmd = source.replace(/^(OP\d+)_/, '');
      const resolvedTarget = compactText(target);
      return {
        source,
        ...(cardOp ? { op: cardOp } : {}),
        sourceCmd,
        sourceParsed: parseLedCommand(sourceCmd),
        target: resolvedTarget,
        targetParsed: parseLedCommand(resolvedTarget),
      };
    });
}

function collectCspL0LedProfile(iiviRoot, stream) {
  if (stream.toLowerCase() !== 'csp') return null;

  const l0CmdPath = join(iiviRoot, 'profile/cu/l0', stream, 'l0_cmd_profile.json');
  if (!existsSync(l0CmdPath)) throw new Error(`[sync:platform] Missing CSP L0 LED profile ${l0CmdPath}`);

  const parsed = JSON.parse(readFileSync(l0CmdPath, 'utf8'));
  const ledCardOpDescription = text(parsed?.LED_CARD_OP?.__description);
  const actionDescription = text(parsed?.ACTION_LED?.__description);

  return {
    source: 'l0/csp/l0_cmd_profile.json',
    commandStates: {
      default: collectLedStateEntries(parsed?.DEFAULT_LED),
      ce: collectLedStateEntries(parsed?.CE_LED),
    },
    registerMap: collectLedRegisterEntries(parsed?.REG_LED),
    cardOpMap: {
      ...(ledCardOpDescription ? { description: ledCardOpDescription } : {}),
      mappings: collectLedCardOpEntries(parsed?.LED_CARD_OP),
    },
    action: {
      ...(actionDescription ? { description: actionDescription } : {}),
      settings: Object.fromEntries(Object.entries(parsed?.ACTION_LED ?? {})
        .filter(([key, value]) => key !== '__description' && value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])),
    },
  };
}

const iiviRoot = fromRepo(options.iiviRoot);
const catalogRoot = fromRepo(options.out);
const platformRoot = join(iiviRoot, 'profile/cu/platform');
const cliRoot = join(iiviRoot, 'profile/cu/cli');
const l1Root = join(iiviRoot, 'profile/cu/l1');
const streamsPath = join(catalogRoot, 'streams.json');

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
  const streamRoot = join(platformRoot, stream);
  const chassisPath = join(streamRoot, 'CHASSIS.json');
  const platformPath = join(streamRoot, 'PLATFORM.json');
  const parsed = JSON.parse(readFileSync(chassisPath, 'utf8'));
  const chassisRoot = parsed.CHASSIS;
  if (!chassisRoot) throw new Error(`CHASSIS root missing in ${chassisPath}`);

  const platformParsed = existsSync(platformPath) ? JSON.parse(readFileSync(platformPath, 'utf8')) : {};
  const platformMeta = platformParsed.PLATFORM ?? {};
  const l0Led = collectCspL0LedProfile(iiviRoot, stream);

  const attrs = chassisRoot.attributes ?? {};
  const lineSlots = keyToSlots(attrs, 'linecardslot');
  if (!lineSlots.length) throw new Error(`linecardslot is empty in ${chassisPath}`);

  const vendorModules = chassisRoot.modules?.LINECARD?.modules ?? {};
  const vendorTypes = (vendorModules.key ?? []).filter((vendorType) => typeof vendorType === 'string');
  if (!vendorTypes.length) throw new Error(`No LINECARD vendor types in ${chassisPath}`);

  const mappedVendors = vendorTypes
    .map((vendorType) => {
      const profile = vendorModules[vendorType]?.filename;
      const profilePath = profile ? join(streamRoot, profile) : '';
      const profileRoot = profilePath && existsSync(profilePath)
        ? JSON.parse(readFileSync(profilePath, 'utf8'))
        : null;
      const cardRoot = profileRoot && Object.keys(profileRoot).length ? profileRoot[Object.keys(profileRoot)[0]] : null;
      const profileSlots = keyToSlots(cardRoot?.attributes, 'slots');
      const occupiedWidth = Number(cardRoot?.attributes?.slot_occupied?.horizontal);
      let width = linecardWidthOverrideForVendorType(vendorType);
      if (!width && Number.isFinite(occupiedWidth) && occupiedWidth > 0) {
        width = occupiedWidth;
      }
      if (!width) {
        width = deriveWidthFromSlots(profileSlots, lineSlots);
      }
      return {
        vendorType,
        linecardId: linecardIdForVendorType(vendorType),
        known: !!linecardKnown(vendorType),
        profile,
        profileSlots,
        width: width ?? 1,
      };
    })
    .filter((entry) => !!entry.profile);

  const linecardAliases = collectLinecardAliases(platformMeta);
  const directMap = new Map(mappedVendors.map((entry) => [entry.vendorType, entry]));
  const aliasMap = new Map();
  for (const alias of linecardAliases) {
    const fromDirect = directMap.get(alias.from);
    const toDirect = directMap.get(alias.to);
    const direct = fromDirect ?? toDirect;
    if (!direct) continue;

    const aliasVendorType = fromDirect ? alias.to : alias.from;
    const aliasOf = fromDirect ? alias.from : alias.to;
    if (!aliasVendorType || directMap.has(aliasVendorType)) continue;

    const existing = aliasMap.get(aliasVendorType);
    if (existing && existing.linecardId !== direct.linecardId) continue;

    aliasMap.set(aliasVendorType, {
      vendorType: aliasVendorType,
      linecardId: direct.linecardId,
      aliasOf,
      source: alias.source,
      ...(alias.condition ? { condition: alias.condition } : {}),
    });
  }
  const aliasEntries = [...aliasMap.values()].sort((a, b) => a.vendorType.localeCompare(b.vendorType));

  const knownMappings = mappedVendors.filter((entry) => entry.known).length;
  const fallbackMappings = mappedVendors.length - knownMappings;

  if (!mappedVendors.length) {
    throw new Error(`No profile-backed linecards mapped for ${stream} (${chassisPath})`);
  }

  const linecardWidths = new Map(mappedVendors.map((entry) => [entry.linecardId, entry.width]));
  const linecardStartSlots = new Map();
  for (const entry of mappedVendors) {
    if (!entry.profileSlots.length) continue;
    const starts = linecardStartSlots.get(entry.linecardId) ?? new Set();
    for (const slot of entry.profileSlots) starts.add(slot);
    linecardStartSlots.set(entry.linecardId, starts);
  }

  const linecardsForSlots = [...new Set(mappedVendors.map((entry) => entry.linecardId))];
  const columns = lineSlots.length % 4 === 0 ? 4 : Math.min(4, lineSlots.length);

  const fitsAt = (slotIndex, linecardId) => {
    const width = linecardWidths.get(linecardId) ?? 1;
    if (width <= 1) return true;
    if ((slotIndex % columns) + width > columns || slotIndex + width > lineSlots.length) return false;
    const starts = linecardStartSlots.get(linecardId);
    if (starts?.size && !starts.has(lineSlots[slotIndex])) return false;
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
      columns,
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
      vendorTypeMap: [
        ...mappedVendors.map(({ vendorType, linecardId, profile }) => ({ vendorType, linecardId, profile })),
        ...aliasEntries,
      ],
      linecardMappingComplete: mappedVendors.length === vendorTypes.length,
      knownLinecardMappings: knownMappings,
      fallbackLinecardMappings: fallbackMappings,
      knownMappingComplete: knownMappings === vendorTypes.length,
      aliasLinecardMappings: aliasEntries.length,
      slots,
    },
  ];

  const platformCatalog = {
    aliases: {
      rules: linecardAliases,
      cardname: platformMeta.cardname ?? {},
      cardnamemapping: platformMeta.cardnamemapping ?? {},
    },
    cardclass: platformMeta.cardclass ?? {},
    cardpreconf: platformMeta.cardpreconf ?? {},
    ledrules: platformMeta.ledrules ?? {},
    LED: platformMeta.LED ?? {},
    switch: platformMeta.switch ?? {},
    unavailablevalue: platformMeta.unavailablevalue ?? {},
    chassis: {
      ...(attrs['chassis-type'] !== undefined ? { type: attrs['chassis-type'] } : {}),
      ...(attrs.chassislimit !== undefined ? { limits: attrs.chassislimit } : {}),
      ...(attrs.deployment !== undefined ? { deployment: attrs.deployment } : {}),
      ...(attrs.ledtest !== undefined ? { ledTest: attrs.ledtest } : {}),
      ...(attrs.locatechassis !== undefined ? { locate: attrs.locatechassis } : {}),
    },
    moduleFamilies: collectNonLinecardFamilies(chassisRoot),
    ...(l0Led ? { l0Led } : {}),
  };

  outputPlan.push({ path: join(catalogRoot, stream, 'chassis.json'), json: chassisCatalog });
  outputPlan.push({ path: join(catalogRoot, stream, 'platform.json'), json: platformCatalog });
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
