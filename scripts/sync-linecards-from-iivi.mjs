#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveWidthFromSlots,
  linecardIdForVendorType,
  linecardNameForVendorType,
  linecardWidthOverrideForVendorType,
  normalizeFormFactor,
  slug,
  uniqueSortedNums,
} from './sync-profile-utils.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  out: 'catalog',
  stream: '',
  strict: false,
  dryRun: false,
};

const usage = [
  'Sync per-stream linecards and supported pluggables from IIVI platform + l1 profiles.',
  '',
  'Usage:',
  '  npm run sync:linecards -- [--iivi-root <path>] [--stream <id>] [--out <path>] [--strict] [--dry-run]',
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
  if (arg === '--strict') {
    options.strict = true;
    continue;
  }
  if (arg === '--iivi-root' || arg === '--out' || arg === '--stream') {
    const val = argv[i + 1];
    if (!val) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    i += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const fromRepo = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));
const iiviRoot = fromRepo(options.iiviRoot);
const outRoot = fromRepo(options.out);
const platformRoot = join(iiviRoot, 'profile/cu/platform');
const l1Root = join(iiviRoot, 'profile/cu/l1');
const l0Root = join(iiviRoot, 'profile/cu/l0');

const streamIds = (() => {
  if (options.stream) return [options.stream];
  return readdirSync(platformRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'common')
    .map((entry) => entry.name)
    .filter((id) => existsSync(join(platformRoot, id, 'CHASSIS.json')) && existsSync(join(l1Root, id, 'l1_profile.xml')))
    .sort();
})();

if (!streamIds.length) throw new Error(`No streams found under ${platformRoot}`);

const roleSet = new Set(['line', 'client', 'adddrop', 'com', 'osc', 'monitor', 'port', 'ampin', 'ampout']);

const defaultBehaviorByRole = {
  line: { showsInL1: true, canLoopback: true, serviceGroup: 'line' },
  client: { showsInData: true },
  adddrop: { showsInData: true, serviceGroup: 'adddrop' },
  com: { showsInData: true, serviceGroup: 'adddrop' },
  osc: {},
  monitor: {},
  port: { showsInData: true },
  ampin: { showsInData: true },
  ampout: { showsInData: true },
};

const cleanBehavior = (behavior) => {
  const out = {};
  if (behavior.showsInL1 !== undefined) out.showsInL1 = !!behavior.showsInL1;
  if (behavior.showsInData !== undefined) out.showsInData = !!behavior.showsInData;
  if (behavior.canLoopback !== undefined) out.canLoopback = !!behavior.canLoopback;
  if (behavior.serviceGroup !== undefined) out.serviceGroup = String(behavior.serviceGroup);
  return out;
};

const normalizePortType = (value) => String(value ?? '').trim().toUpperCase();

const speedFromPortTypes = (portTypes) => {
  const text = [...portTypes].join(' ');
  if (/OTUC8|800G/.test(text)) return '800G';
  if (/OTUC6|600G/.test(text)) return '600G';
  if (/OTUC4|400G/.test(text)) return '400G';
  if (/OTUC2|200G/.test(text)) return '200G';
  if (/OTU4|100G/.test(text)) return '100G';
  if (/OTU2|STM64|10G/.test(text)) return '10G';
  return 'N/A';
};

const inferFiber = (partNo, portTypes) => {
  const text = `${partNo} ${[...portTypes].join(' ')}`.toUpperCase();
  return /\bSR\b|MMF/.test(text) ? 'MMF' : 'SMF';
};

const parseTags = (source, tag) => [...source.matchAll(new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`, 'g'))].map((m) => m[1]);
const stripXmlComments = (xml) => String(xml).replace(/<!--[\s\S]*?-->/g, '');
const normalizeCardKey = (value) => String(value ?? '').trim().toUpperCase();

const parseNum = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : undefined;
};

const parseRangePair = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const parts = text.split(',').map((part) => parseNum(part)).filter((part) => part !== undefined);
  if (!parts.length) return undefined;
  if (parts.length === 1) return [parts[0], parts[0]];
  return [parts[0], parts[1]];
};

const normalizePortRef = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const primary = text.split(',')[0]?.trim() ?? '';
  const tail = primary.match(/([A-Za-z0-9_]+)$/)?.[1] ?? primary;
  return tail.toUpperCase();
};

const dedupeBy = (items, keyFn) => {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

function parseL0AmplifierMaps(l0CardXml) {
  const out = new Map();
  for (const moCfgMatch of l0CardXml.matchAll(/<mo_cfg\b[^>]*>([\s\S]*?)<\/mo_cfg>/g)) {
    const moCfg = moCfgMatch[1];
    const moName = parseTags(moCfg, 'mo_name')[0]?.trim();
    if (moName !== 'AmplifierState') continue;
    for (const cardMatch of moCfg.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
      const cardRaw = cardMatch[1];
      const cardType = normalizeCardKey(parseTags(cardRaw, 'card_type')[0]);
      if (!cardType) continue;
      const ampMap = out.get(cardType) ?? new Map();
      for (const moMapMatch of cardRaw.matchAll(/<mo_map>([\s\S]*?)<\/mo_map>/g)) {
        const moRaw = moMapMatch[1];
        const ampId = normalizePortRef(parseTags(moRaw, 'mo_name')[0]);
        if (!ampId) continue;
        const amplifier = ampMap.get(ampId) ?? { id: ampId };
        for (const leafCfgMatch of moRaw.matchAll(/<leaf_config>([\s\S]*?)<\/leaf_config>/g)) {
          const leafRaw = leafCfgMatch[1];
          const leafName = parseTags(leafRaw, 'leaf_name')[0]?.trim();
          const leafValue = parseTags(leafRaw, 'leaf_value')[0]?.trim();
          if (!leafName || !leafValue) continue;
          if (leafName === 'ingress-port') amplifier.ingressPort = normalizePortRef(leafValue);
          if (leafName === 'egress-port') amplifier.egressPort = normalizePortRef(leafValue);
          if (leafName === 'type') amplifier.type = String(leafValue).toUpperCase();
        }
        ampMap.set(ampId, amplifier);
      }
      if (ampMap.size) out.set(cardType, ampMap);
    }
    break;
  }
  return out;
}

function parseL0InternalLinks(l0CardXml) {
  const out = new Map();
  const section = l0CardXml.match(/<wss_card_internal_link>([\s\S]*?)<\/wss_card_internal_link>/)?.[1] ?? '';
  if (!section) return out;

  for (const cardMatch of section.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
    const cardRaw = cardMatch[1];
    const cardType = normalizeCardKey(parseTags(cardRaw, 'card_type')[0]);
    if (!cardType) continue;
    const links = [];
    for (const portMapMatch of cardRaw.matchAll(/<port_map>([\s\S]*?)<\/port_map>/g)) {
      const portRaw = portMapMatch[1];
      const sourcePort = normalizePortRef(parseTags(portRaw, 'source_port')[0]);
      const destPorts = parseTags(portRaw, 'dest_port').map(normalizePortRef).filter(Boolean);
      if (!sourcePort || !destPorts.length) continue;
      links.push({ sourcePort, destPorts: [...new Set(destPorts)].sort() });
    }
    if (links.length) {
      out.set(cardType, dedupeBy(links, (link) => `${link.sourcePort}>${link.destPorts.join(',')}`)
        .sort((a, b) => a.sourcePort.localeCompare(b.sourcePort)));
    }
  }

  return out;
}

function parseL0PowerControl(l0PowerXml) {
  const out = new Map();
  for (const cardMatch of l0PowerXml.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
    const cardRaw = cardMatch[1];
    const cardType = normalizeCardKey(parseTags(cardRaw, 'card_name')[0]);
    if (!cardType) continue;
    const links = [];
    for (const linkMatch of cardRaw.matchAll(/<OtsLink_map>([\s\S]*?)<\/OtsLink_map>/g)) {
      const raw = linkMatch[1];
      const name = String(parseTags(raw, 'OtsLink_name')[0] ?? '').trim();
      const physicalPort = normalizePortRef(parseTags(raw, 'physical_port')[0]);
      const ingressAmplifier = normalizePortRef(parseTags(raw, 'ingress_amplifier')[0]);
      const egressAmplifier = normalizePortRef(parseTags(raw, 'egress_amplifier')[0]);
      const algorithm = String(parseTags(raw, 'PCAlgorithm')[0] ?? '').trim();
      if (!name && !physicalPort && !ingressAmplifier && !egressAmplifier) continue;
      links.push({
        ...(name ? { name } : {}),
        ...(physicalPort ? { physicalPort } : {}),
        ...(ingressAmplifier ? { ingressAmplifier } : {}),
        ...(egressAmplifier ? { egressAmplifier } : {}),
        ...(algorithm ? { algorithm } : {}),
      });
    }
    if (links.length) out.set(cardType, links);
  }
  return out;
}

function parseL0AmplifierRanges(l0ValidateXml) {
  const out = new Map();
  for (const moduleMatch of l0ValidateXml.matchAll(/<module_map>([\s\S]*?)<\/module_map>/g)) {
    const moduleRaw = moduleMatch[1];
    const moduleName = String(parseTags(moduleRaw, 'module_name')[0] ?? '').trim();
    if (moduleName !== '/openconfig-optical-amplifier:optical-amplifier/amplifiers/amplifier/config') continue;

    for (const cardMatch of moduleRaw.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
      const cardRaw = cardMatch[1];
      const cardType = normalizeCardKey(parseTags(cardRaw, 'card_name')[0]);
      if (!cardType || cardType === 'NONE') continue;
      const ampMap = out.get(cardType) ?? new Map();

      for (const portMatch of cardRaw.matchAll(/<port_map>([\s\S]*?)<\/port_map>/g)) {
        const portRaw = portMatch[1];
        const ampId = normalizePortRef(parseTags(portRaw, 'port_name')[0]);
        if (!ampId) continue;
        const range = ampMap.get(ampId) ?? {};

        for (const leafMatch of portRaw.matchAll(/<leaf_map>([\s\S]*?)<\/leaf_map>/g)) {
          const leafRaw = leafMatch[1];
          const leaf = String(parseTags(leafRaw, 'leaf')[0] ?? '').trim();
          const min = parseNum(parseTags(leafRaw, 'min')[0]);
          const max = parseNum(parseTags(leafRaw, 'max')[0]);
          if (!leaf || min === undefined || max === undefined) continue;
          if (leaf === 'target-gain') range.gainRange = { min, max };
          if (leaf === 'target-gain-tilt') range.targetGainTiltRange = { min, max };
          if (leaf === 'ingress-voa-atten') range.ingressVoaAttenRange = { min, max };
          if (leaf === 'target-span-loss-offset') range.targetSpanLossOffsetRange = { min, max };
        }

        if (Object.keys(range).length) ampMap.set(ampId, range);
      }

      if (ampMap.size) out.set(cardType, ampMap);
    }
  }
  return out;
}

function parseL0ValidationWavelength(l0ValidateXml) {
  const out = new Map();
  const section = l0ValidateXml.match(/<validation_wavelength>([\s\S]*?)<\/validation_wavelength>/)?.[1] ?? '';
  if (!section) return out;

  for (const cardMatch of section.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
    const cardRaw = cardMatch[1];
    const cardType = normalizeCardKey(parseTags(cardRaw, 'card_name')[0]);
    if (!cardType || cardType === 'NONE') continue;
    const current = out.get(cardType) ?? {};

    for (const leafMatch of cardRaw.matchAll(/<leaf_map>([\s\S]*?)<\/leaf_map>/g)) {
      const leafRaw = leafMatch[1];
      const key = String(parseTags(leafRaw, 'map_key')[0] ?? '').trim();
      const min = parseNum(parseTags(leafRaw, 'min')[0]);
      const max = parseNum(parseTags(leafRaw, 'max')[0]);
      if (min === undefined || max === undefined) continue;
      if (key === 'frequency-range') current.frequencyRange = { min, max };
      if (key === 'bandwidth-range') current.bandwidthRange = { min, max };
    }

    if (Object.keys(current).length) out.set(cardType, current);
  }

  return out;
}

function parseL0ValidationGrid(l0ValidateXml) {
  const out = new Map();
  const section = l0ValidateXml.match(/<validation_grid_config>([\s\S]*?)<\/validation_grid_config>/)?.[1] ?? '';
  if (!section) return out;

  for (const cardMatch of section.matchAll(/<card_map>([\s\S]*?)<\/card_map>/g)) {
    const cardRaw = cardMatch[1];
    const cardType = normalizeCardKey(parseTags(cardRaw, 'card_name')[0]);
    if (!cardType || cardType === 'NONE') continue;
    const grid = parseNum(parseTags(cardRaw, 'value_vector')[0]);
    if (grid !== undefined) out.set(cardType, grid);
  }

  return out;
}

function parseL0ChannelMonitors(l0CardXml) {
  const out = new Map();
  const section = l0CardXml.match(/<channel-monitor-maps>([\s\S]*?)<\/channel-monitor-maps>/)?.[1] ?? '';
  if (!section) return out;

  for (const linecardMatch of section.matchAll(/<linecard>([\s\S]*?)<\/linecard>/g)) {
    const linecardRaw = linecardMatch[1];
    const cardType = normalizeCardKey(parseTags(linecardRaw, 'card-type')[0]);
    if (!cardType) continue;

    const supportedProvisionModes = [...new Set(parseTags(linecardRaw, 'supported-channel-provision-mode').map((mode) => String(mode).trim()).filter(Boolean))].sort();
    const supportedMapIndexes = uniqueSortedNums(parseTags(linecardRaw, 'supported-map-index').map((idx) => parseNum(idx)).filter((idx) => idx !== undefined));

    const monitorMaps = [];
    for (const mapMatch of linecardRaw.matchAll(/<channel-monitor-map>([\s\S]*?)<\/channel-monitor-map>/g)) {
      const mapRaw = mapMatch[1];
      const mapIndex = parseNum(parseTags(mapRaw, 'map-index')[0]);
      const provisionMode = String(parseTags(mapRaw, 'channel-provision-mode')[0] ?? '').trim();
      const channelNumber = parseNum(parseTags(mapRaw, 'channel-number')[0]);
      const channelSpacing = String(parseTags(mapRaw, 'channel-spacing')[0] ?? '').trim();
      const bandLowerFrequency = parseNum(parseTags(mapRaw, 'band-lower-frequency')[0]);
      const bandUpperFrequency = parseNum(parseTags(mapRaw, 'band-upper-frequency')[0]);
      const map = {
        ...(mapIndex !== undefined ? { mapIndex } : {}),
        ...(provisionMode ? { provisionMode } : {}),
        ...(channelNumber !== undefined ? { channelNumber } : {}),
        ...(channelSpacing ? { channelSpacing } : {}),
        ...(bandLowerFrequency !== undefined ? { bandLowerFrequency } : {}),
        ...(bandUpperFrequency !== undefined ? { bandUpperFrequency } : {}),
      };
      if (Object.keys(map).length) monitorMaps.push(map);
    }

    out.set(cardType, {
      ...(supportedProvisionModes.length ? { supportedProvisionModes } : {}),
      ...(supportedMapIndexes.length ? { supportedMapIndexes } : {}),
      ...(monitorMaps.length ? { monitorMaps } : {}),
    });
  }

  return out;
}

function loadL0ProfileData(stream) {
  const streamRoot = join(l0Root, stream);
  if (!existsSync(streamRoot)) return null;

  const l0CardPath = join(streamRoot, 'l0_card_profile.xml');
  const l0PowerPath = join(streamRoot, 'l0_power_ctrl_mgr_profile.xml');
  const l0ValidatePath = join(streamRoot, 'l0_validate_profile.xml');

  const l0CardXml = existsSync(l0CardPath) ? stripXmlComments(readFileSync(l0CardPath, 'utf8')) : '';
  const l0PowerXml = existsSync(l0PowerPath) ? stripXmlComments(readFileSync(l0PowerPath, 'utf8')) : '';
  const l0ValidateXml = existsSync(l0ValidatePath) ? stripXmlComments(readFileSync(l0ValidatePath, 'utf8')) : '';

  if (!l0CardXml && !l0PowerXml && !l0ValidateXml) return null;

  return {
    amplifierMapByCard: parseL0AmplifierMaps(l0CardXml),
    internalLinksByCard: parseL0InternalLinks(l0CardXml),
    powerCtrlByCard: parseL0PowerControl(l0PowerXml),
    amplifierRangesByCard: parseL0AmplifierRanges(l0ValidateXml),
    wavelengthByCard: parseL0ValidationWavelength(l0ValidateXml),
    gridByCard: parseL0ValidationGrid(l0ValidateXml),
    channelMonitorByCard: parseL0ChannelMonitors(l0CardXml),
  };
}

function extractProfileOpticalThresholds(root) {
  const out = new Map();
  const modules = root?.modules;
  if (!modules || typeof modules !== 'object') return out;

  for (const [moduleName, mod] of Object.entries(modules)) {
    if (moduleName === 'key' || !mod || typeof mod !== 'object') continue;
    const names = Array.isArray(mod.identity?.names)
      ? mod.identity.names.filter((name) => typeof name === 'string' && name.trim())
      : [];
    if (!names.length) continue;

    const cfg = mod?.attributes?.yangattributes?.['optical-port/config'];
    if (!cfg || typeof cfg !== 'object') continue;

    const envelope = {};
    for (const [key, raw] of Object.entries(cfg)) {
      if (key !== 'power-offset' && !key.includes('threshold')) continue;
      if (typeof raw === 'string' && raw.includes(',')) {
        const pair = parseRangePair(raw);
        if (pair) envelope[key] = pair;
        continue;
      }
      const n = parseNum(raw);
      if (n !== undefined) envelope[key] = n;
    }
    if (!Object.keys(envelope).length) continue;

    for (const name of names) {
      const portId = formatPortId(moduleName, name);
      if (!portId) continue;
      out.set(portId, envelope);
    }
  }

  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function extractProfileAmplifierDefaults(root) {
  const out = new Map();
  const modules = root?.modules;
  if (!modules || typeof modules !== 'object') return out;

  for (const [moduleName, mod] of Object.entries(modules)) {
    if (moduleName === 'key' || !mod || typeof mod !== 'object') continue;
    const names = Array.isArray(mod.identity?.names)
      ? mod.identity.names.filter((name) => typeof name === 'string' && name.trim())
      : [];
    if (!names.length) continue;

    const upModule = String(moduleName).toUpperCase();
    const upClass = String(root?.classname?.[moduleName] ?? '').toUpperCase();
    if (!upModule.includes('AMPLIFIER') && !upClass.includes('AMPLIFIER')) continue;

    const ampId = normalizePortRef(names[0]);
    if (!ampId) continue;

    const config = mod?.attributes?.yangattributes?.config;
    const state = mod?.attributes?.yangattributes?.state;
    if ((!config || typeof config !== 'object') && (!state || typeof state !== 'object')) continue;

    const entry = out.get(ampId) ?? { id: ampId };
    const gainMin = parseNum(config?.['min-gain']);
    const gainMax = parseNum(config?.['max-gain']);
    const targetGain = parseNum(config?.['target-gain']);
    const targetGainTilt = parseNum(config?.['target-gain-tilt']);
    const targetOutputPower = parseNum(config?.['target-output-power']);
    const maxOutputPower = parseNum(config?.['max-output-power']);
    const ingressVoaAtten = parseNum(config?.['ingress-voa-atten']);
    const targetSpanLossOffset = parseNum(config?.['target-span-loss-offset']);

    if (targetGain !== undefined) entry.targetGain = targetGain;
    if (gainMin !== undefined && gainMax !== undefined) entry.gainRange = { min: gainMin, max: gainMax };
    if (targetGainTilt !== undefined) entry.targetGainTilt = targetGainTilt;
    if (targetOutputPower !== undefined) entry.targetOutputPower = targetOutputPower;
    if (maxOutputPower !== undefined) entry.maxOutputPower = maxOutputPower;
    if (ingressVoaAtten !== undefined) entry.ingressVoaAtten = ingressVoaAtten;
    if (targetSpanLossOffset !== undefined) entry.targetSpanLossOffset = targetSpanLossOffset;

    const ampType = String(config?.type ?? '').trim().toUpperCase();
    if (ampType) entry.type = ampType;

    const ingressPort = normalizePortRef(state?.['ingress-port']);
    const egressPort = normalizePortRef(state?.['egress-port']);
    if (ingressPort) entry.ingressPort = ingressPort;
    if (egressPort) entry.egressPort = egressPort;

    out.set(ampId, entry);
  }

  return out;
}

function buildInternalPaths(internalLinks, otsLinks) {
  const routes = [];

  if (otsLinks.length) {
    for (const ots of otsLinks) {
      const linePort = normalizePortRef(ots.physicalPort);
      if (!linePort) continue;

      const adToLine = internalLinks
        .filter((link) => link.destPorts.includes(linePort))
        .map((link) => link.sourcePort)
        .filter(Boolean);
      const lineToAd = internalLinks
        .filter((link) => link.sourcePort === linePort)
        .flatMap((link) => link.destPorts)
        .filter((port) => port !== linePort);

      for (const adPort of [...new Set(adToLine)].sort()) {
        const via = ['wss:mux', ...(ots.egressAmplifier ? [`amplifier:${normalizePortRef(ots.egressAmplifier)}`] : [])];
        routes.push({ fromPort: adPort, toPort: linePort, via });
      }

      for (const adPort of [...new Set(lineToAd)].sort()) {
        const via = [...(ots.ingressAmplifier ? [`amplifier:${normalizePortRef(ots.ingressAmplifier)}`] : []), 'wss:demux'];
        routes.push({ fromPort: linePort, toPort: adPort, via });
      }
    }
  }

  if (!routes.length) {
    for (const link of internalLinks) {
      for (const dest of link.destPorts) routes.push({ fromPort: link.sourcePort, toPort: dest, via: ['wss'] });
    }
  }

  return dedupeBy(routes, (route) => `${route.fromPort}>${route.toPort}>${route.via.join('>')}`)
    .sort((a, b) => `${a.fromPort}/${a.toPort}`.localeCompare(`${b.fromPort}/${b.toPort}`));
}

function buildL0Metadata(vendorType, l0Data, thresholdMap, profileAmplifierDefaults) {
  const key = normalizeCardKey(vendorType);
  const hasL0CardData = !!l0Data && (
    l0Data.amplifierMapByCard.has(key)
    || l0Data.internalLinksByCard.has(key)
    || l0Data.powerCtrlByCard.has(key)
    || l0Data.amplifierRangesByCard.has(key)
    || l0Data.wavelengthByCard.has(key)
    || l0Data.gridByCard.has(key)
    || l0Data.channelMonitorByCard.has(key)
  );
  if (!hasL0CardData) return null;

  const amplifierMap = l0Data?.amplifierMapByCard.get(key) ?? new Map();
  const amplifierRanges = l0Data?.amplifierRangesByCard.get(key) ?? new Map();
  const internalLinks = l0Data?.internalLinksByCard.get(key) ?? [];
  const otsLinks = l0Data?.powerCtrlByCard.get(key) ?? [];
  const wavelength = l0Data?.wavelengthByCard.get(key);
  const gridMHz = l0Data?.gridByCard.get(key);
  const channelMonitor = l0Data?.channelMonitorByCard.get(key);

  const amplifierNames = [...new Set([
    ...amplifierMap.keys(),
    ...profileAmplifierDefaults.keys(),
    ...amplifierRanges.keys(),
  ])].sort();

  const amplifiers = amplifierNames.map((ampId) => {
    const fromCfg = amplifierMap.get(ampId) ?? {};
    const fromProfile = profileAmplifierDefaults.get(ampId) ?? {};
    const fromRange = amplifierRanges.get(ampId) ?? {};
    const lineRole = (() => {
      const ingress = otsLinks.some((link) => normalizePortRef(link.ingressAmplifier) === ampId);
      const egress = otsLinks.some((link) => normalizePortRef(link.egressAmplifier) === ampId);
      if (ingress && !egress) return 'ingress';
      if (!ingress && egress) return 'egress';
      return undefined;
    })();

    const amp = {
      id: ampId,
      ...(fromCfg.type || fromProfile.type ? { type: fromCfg.type ?? fromProfile.type } : {}),
      ...(fromCfg.ingressPort || fromProfile.ingressPort ? { ingressPort: fromCfg.ingressPort ?? fromProfile.ingressPort } : {}),
      ...(fromCfg.egressPort || fromProfile.egressPort ? { egressPort: fromCfg.egressPort ?? fromProfile.egressPort } : {}),
      ...(lineRole ? { lineRole } : {}),
      ...(fromProfile.targetGain !== undefined ? { targetGain: fromProfile.targetGain } : {}),
      ...(fromRange.gainRange || fromProfile.gainRange ? { gainRange: fromRange.gainRange ?? fromProfile.gainRange } : {}),
      ...(fromProfile.targetGainTilt !== undefined ? { targetGainTilt: fromProfile.targetGainTilt } : {}),
      ...(fromRange.targetGainTiltRange ? { targetGainTiltRange: fromRange.targetGainTiltRange } : {}),
      ...(fromProfile.targetOutputPower !== undefined ? { targetOutputPower: fromProfile.targetOutputPower } : {}),
      ...(fromProfile.maxOutputPower !== undefined ? { maxOutputPower: fromProfile.maxOutputPower } : {}),
      ...(fromProfile.ingressVoaAtten !== undefined ? { ingressVoaAtten: fromProfile.ingressVoaAtten } : {}),
      ...(fromRange.ingressVoaAttenRange ? { ingressVoaAttenRange: fromRange.ingressVoaAttenRange } : {}),
      ...(fromProfile.targetSpanLossOffset !== undefined ? { targetSpanLossOffset: fromProfile.targetSpanLossOffset } : {}),
      ...(fromRange.targetSpanLossOffsetRange ? { targetSpanLossOffsetRange: fromRange.targetSpanLossOffsetRange } : {}),
    };
    return amp;
  }).filter((amp) => Object.keys(amp).length > 1);

  const internalPaths = buildInternalPaths(internalLinks, otsLinks);
  const opticalThresholdEnvelopes = thresholdMap.size ? Object.fromEntries(thresholdMap.entries()) : null;

  const channelPlan = {
    ...(wavelength?.frequencyRange ? { frequencyRange: wavelength.frequencyRange } : {}),
    ...(wavelength?.bandwidthRange ? { bandwidthRange: wavelength.bandwidthRange } : {}),
    ...(gridMHz !== undefined ? { gridMHz } : {}),
    ...(channelMonitor?.supportedProvisionModes?.length ? { supportedProvisionModes: channelMonitor.supportedProvisionModes } : {}),
    ...(channelMonitor?.supportedMapIndexes?.length ? { supportedMapIndexes: channelMonitor.supportedMapIndexes } : {}),
    ...(channelMonitor?.monitorMaps?.length ? { monitorMaps: channelMonitor.monitorMaps } : {}),
  };

  const l0 = {
    ...(internalPaths.length ? { internalPaths } : {}),
    ...(amplifiers.length ? { amplifiers } : {}),
    ...(opticalThresholdEnvelopes ? { opticalThresholdEnvelopes } : {}),
    ...(Object.keys(channelPlan).length ? { channelPlan } : {}),
  };

  return Object.keys(l0).length ? l0 : null;
}

function parseSupportedPluggables(l1Path) {
  const xml = readFileSync(l1Path, 'utf8');
  const supportedPartNoMatch = xml.match(/<supported-part-no>([\s\S]*?)<\/supported-part-no>/);
  if (!supportedPartNoMatch) return [];

  const section = supportedPartNoMatch[1].replace(/<!--[\s\S]*?-->/g, '');

  const merged = new Map();
  for (const item of section.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw = item[1];
    const partNo = (parseTags(raw, 'part-no')[0] ?? parseTags(raw, 'part_no')[0])?.trim();
    if (!partNo) continue;
    const key = partNo.toUpperCase();
    const current = merged.get(key) ?? {
      partNo,
      rawForms: new Set(),
      families: new Set(),
      portTypes: new Set(),
      dco: false,
    };

    for (const form of parseTags(raw, 'form_factor')) {
      const family = normalizeFormFactor(form);
      current.rawForms.add(String(form).trim());
      if (family) current.families.add(family);
      if (String(form).toUpperCase().includes('DCO')) current.dco = true;
    }

    for (const portType of parseTags(raw, 'port-type').map(normalizePortType).filter(Boolean)) {
      current.portTypes.add(portType);
    }

    merged.set(key, current);
  }

  if (!merged.size) {
    throw new Error(`[sync:linecards] Found <supported-part-no> but extracted no part numbers from ${l1Path}`);
  }

  const out = [];
  const seenIds = new Set();

  for (const entry of [...merged.values()].sort((a, b) => a.partNo.localeCompare(b.partNo))) {
    if (entry.families.has('NON_PLUGGABLE')) continue;

    let id = slug(entry.partNo);
    if (!id) id = 'part';
    if (seenIds.has(id)) {
      let i = 2;
      while (seenIds.has(`${id}-${i}`)) i += 1;
      id = `${id}-${i}`;
    }
    seenIds.add(id);

    const families = [...entry.families].filter((family) => family !== 'NON_PLUGGABLE');
    if (!families.length) continue;

    out.push({
      id,
      name: entry.partNo,
      part: entry.partNo,
      formFactor: families[0],
      speed: speedFromPortTypes(entry.portTypes),
      fiber: inferFiber(entry.partNo, entry.portTypes),
      ...(entry.dco ? { dco: true } : {}),
      about: 'Synced from l1_profile.xml supported-part-no.',
      _families: families,
      _portTypes: [...entry.portTypes],
    });
  }

  return out;
}

function parseSupportedServiceTypesByCard(l1Path) {
  const xml = readFileSync(l1Path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = new Map();

  for (const cardMatch of xml.matchAll(/<card>([\s\S]*?)<\/card>/g)) {
    const cardRaw = cardMatch[1];
    const cardTypes = (parseTags(cardRaw, 'card-type')[0] ?? '')
      .split(',')
      .map((type) => type.trim().toUpperCase())
      .filter(Boolean);
    if (!cardTypes.length) continue;

    const supported = cardRaw.match(/<supported-service-port-types>([\s\S]*?)<\/supported-service-port-types>/)?.[1] ?? '';
    if (!supported) continue;

    const groups = {
      line: new Map(),
      client: new Map(),
      general: new Map(),
    };

    for (const group of Object.keys(groups)) {
      const section = supported.match(new RegExp(`<${group}>([\\s\\S]*?)<\\/${group}>`))?.[1] ?? '';
      if (!section) continue;
      for (const item of section.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const raw = item[1];
        const portId = parseTags(raw, 'port-id')[0]?.trim();
        if (!portId) continue;
        const types = parseTags(raw, 'port-type').map(normalizePortType).filter(Boolean);
        if (!types.length) continue;
        const existing = groups[group].get(portId) ?? new Set();
        for (const type of types) existing.add(type);
        groups[group].set(portId, existing);
      }
    }

    for (const cardType of cardTypes) {
      const current = out.get(cardType) ?? {
        line: new Map(),
        client: new Map(),
        general: new Map(),
      };
      for (const group of Object.keys(groups)) {
        for (const [portId, types] of groups[group]) {
          const merged = current[group].get(portId) ?? new Set();
          for (const type of types) merged.add(type);
          current[group].set(portId, merged);
        }
      }
      out.set(cardType, current);
    }
  }

  return out;
}

function collectHints(node, out = { serviceTypes: new Set(), formFactors: new Set() }) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'used-service-port-type-preconf' && typeof value === 'string') {
      for (const token of String(value).split(',').map(normalizePortType).filter(Boolean)) out.serviceTypes.add(token);
    } else if (key === 'form-factor' && typeof value === 'string') {
      const family = normalizeFormFactor(value);
      if (family) out.formFactors.add(family);
    } else if (value && typeof value === 'object') {
      collectHints(value, out);
    }
  }
  return out;
}

function looksLikePortModule(moduleName, className, names, mod, hints) {
  const upModule = String(moduleName).toUpperCase();
  const upClass = String(className ?? '').toUpperCase();
  const nameLikePort = names.some((name) => /^(?:C\d+|L\d+|AD\d+|COM|LINE|OSC\d*|MON\d*|\d+)$/i.test(name));
  const yangKeys = Object.keys(mod?.attributes?.yangattributes ?? {}).map((x) => String(x));
  const hasPortYang = yangKeys.some((key) => key.includes('optical-port/') || key.includes('port/'));
  return upModule.includes('PORT')
    || upModule.includes('ADDDROP')
    || upModule.includes('MONITOR')
    || upModule.includes('COM')
    || upModule.includes('OSC')
    || upClass.includes('PORT')
    || nameLikePort
    || hasPortYang
    || hints.serviceTypes.size > 0
    || hints.formFactors.size > 0;
}

function collectPortModules(node, classMap, acc = [], parentHidden = false) {
  const modules = node?.modules;
  if (!modules || typeof modules !== 'object') return acc;

  for (const [moduleName, mod] of Object.entries(modules)) {
    if (moduleName === 'key' || !mod || typeof mod !== 'object') continue;
    const hidden = parentHidden || mod.attributes?.subcomponent?.hidden === true;
    const names = Array.isArray(mod.identity?.names)
      ? mod.identity.names.filter((name) => typeof name === 'string' && name.trim())
      : [];
    const className = classMap?.[moduleName];
    const hints = collectHints(mod);

    if (!hidden && names.length && looksLikePortModule(moduleName, className, names, mod, hints)) {
      acc.push({
        moduleName,
        className,
        names,
        serviceTypes: [...hints.serviceTypes],
        formFactors: [...hints.formFactors],
      });
    }

    collectPortModules(mod, classMap, acc, hidden);
  }

  return acc;
}

const inferRole = (module, className, name) => {
  const upModule = String(module).toUpperCase();
  const upClass = String(className ?? '').toUpperCase();
  const upName = String(name).toUpperCase();
  if (
    upModule.includes('AMPLIFIERPORT_IN')
    || upClass.includes('AMPLIFIERPORT_IN')
    || /(?:^|_)(?:BAIN|LINEIN|PAIN|LA\d+IN)$/.test(upName)
  ) return 'ampin';
  if (
    upModule.includes('AMPLIFIERPORT_E')
    || upModule.includes('AMPLIFIERPORT_OUT')
    || upClass.includes('AMPLIFIERPORT_E')
    || upClass.includes('AMPLIFIERPORT_OUT')
    || /(?:^|_)(?:BAOUT|LINEOUT|PAOUT|LA\d+OUT)$/.test(upName)
  ) return 'ampout';
  if (upModule.includes('LINEPORT') || upClass === 'LINEPORT' || upName === 'LINE' || /^L\d+$/.test(upName)) return 'line';
  if (upModule.includes('CLIENTPORT') || upClass.startsWith('CLIENTPORT') || /^C\d+$/.test(upName)) return 'client';
  if (upModule.includes('ADDDROP') || /^AD\d+/.test(upName)) return 'adddrop';
  if (upModule.includes('COMPORT') || upName === 'COM') return 'com';
  if (upModule.includes('OSCPORT') || upName.startsWith('OSC')) return 'osc';
  if (upModule.includes('MONITOR') || upName.startsWith('MON')) return 'monitor';
  return 'port';
};

const idPrefix = (moduleName) => {
  const up = String(moduleName).toUpperCase();
  if (up === 'PORT') return 'PORT';
  if (up.endsWith('_PORT')) return up.replace(/_PORT$/, '');
  if (up.endsWith('PORT')) return up;
  return up.replace(/[^A-Z0-9]+/g, '') || 'PORT';
};

const formatPortId = (moduleName, name) => {
  const clean = String(name).trim().replace(/\s+/g, '').toUpperCase();
  if (!clean) return clean;
  if (/^\d+$/.test(clean)) return `${idPrefix(moduleName)}${clean}`;
  return clean;
};

const intersects = (a, b) => a.some((item) => b.has(item));

function pickAllowedPluggables(moduleInfo, partEntries, options = {}) {
  const serviceTypes = new Set((options.serviceTypes ?? moduleInfo.serviceTypes).map(normalizePortType).filter(Boolean));
  const families = new Set((options.formFactors ?? moduleInfo.formFactors).map(normalizeFormFactor).filter(Boolean));
  const strict = !!options.strict;

  if (!serviceTypes.size && !families.size) return [];

  let matches = partEntries;

  if (serviceTypes.size) {
    const byService = matches.filter((part) => intersects(part._portTypes, serviceTypes));
    if (byService.length) {
      matches = byService;
    } else if (strict) {
      return [];
    }
  }

  if (families.size) {
    const byFamily = matches.filter((part) => intersects(part._families, families));
    if (byFamily.length) {
      matches = byFamily;
    } else if (strict) {
      return [];
    } else {
      const fallback = partEntries.filter((part) => intersects(part._families, families));
      if (fallback.length) matches = fallback;
    }
  }

  if (!strict && !matches.length && serviceTypes.size) {
    matches = partEntries.filter((part) => intersects(part._portTypes, serviceTypes));
  }

  return [...new Set(matches.map((part) => part.id))];
}

const outputs = [];

for (const stream of streamIds) {
  const streamPlatformRoot = join(platformRoot, stream);
  const streamL1Path = join(l1Root, stream, 'l1_profile.xml');
  const chassisPath = join(streamPlatformRoot, 'CHASSIS.json');

  if (!existsSync(chassisPath)) throw new Error(`Missing CHASSIS profile: ${chassisPath}`);
  if (!existsSync(streamL1Path)) throw new Error(`Missing l1 profile: ${streamL1Path}`);

  const chassisParsed = JSON.parse(readFileSync(chassisPath, 'utf8'));
  const chassisRoot = chassisParsed.CHASSIS;
  if (!chassisRoot) throw new Error(`CHASSIS root missing in ${chassisPath}`);

  const lineSlots = uniqueSortedNums(chassisRoot.attributes?.linecardslot ?? []);
  if (!lineSlots.length) throw new Error(`linecardslot is empty in ${chassisPath}`);

  const vendorModules = chassisRoot.modules?.LINECARD?.modules ?? {};
  const vendorTypes = (vendorModules.key ?? []).filter((vendorType) => typeof vendorType === 'string');
  if (!vendorTypes.length) throw new Error(`No LINECARD vendor types in ${chassisPath}`);

  const pluggables = parseSupportedPluggables(streamL1Path);
  const l1ServiceTypesByCard = options.strict ? parseSupportedServiceTypesByCard(streamL1Path) : new Map();
  const l0Data = loadL0ProfileData(stream);

  const linecards = [];
  for (const vendorType of vendorTypes) {
    const profile = vendorModules[vendorType]?.filename;
    if (!profile) continue;
    const profilePath = join(streamPlatformRoot, profile);
    if (!existsSync(profilePath)) continue;

    const parsed = JSON.parse(readFileSync(profilePath, 'utf8'));
    const root = parsed[Object.keys(parsed)[0]];
    const classMap = root?.classname ?? {};
    const moduleDefs = collectPortModules(root, classMap);
    const thresholdMap = extractProfileOpticalThresholds(root);
    const profileAmplifierDefaults = extractProfileAmplifierDefaults(root);
    const l0 = buildL0Metadata(vendorType, l0Data, thresholdMap, profileAmplifierDefaults);

    const seenPorts = new Set();
    const ports = [];
    const strictCsp800mx = options.strict && stream.toLowerCase() === 'csp' && String(vendorType).toUpperCase() === '800MX';

    const strictPortServiceTypes = strictCsp800mx
      ? (() => {
        const serviceTypes = l1ServiceTypesByCard.get('800MX')?.general;
        if (!serviceTypes?.size) {
          throw new Error(`[strict:csp] Missing <supported-service-port-types><general> for card-type 800MX in ${streamL1Path}`);
        }
        return serviceTypes;
      })()
      : null;

    for (const moduleInfo of moduleDefs) {
      const roleFromModule = moduleInfo.names.length === 1
        ? inferRole(moduleInfo.moduleName, moduleInfo.className, moduleInfo.names[0])
        : null;

      for (const name of moduleInfo.names) {
        let id = formatPortId(moduleInfo.moduleName, name);
        if (!id) continue;
        if (seenPorts.has(id)) {
          const suffix = idPrefix(moduleInfo.moduleName);
          let next = `${id}-${suffix}`;
          let i = 2;
          while (seenPorts.has(next)) {
            next = `${id}-${suffix}-${i}`;
            i += 1;
          }
          id = next;
        }
        seenPorts.add(id);

        const role = roleFromModule ?? inferRole(moduleInfo.moduleName, moduleInfo.className, name);
        if (!roleSet.has(role)) continue;

        const strictServices = strictCsp800mx
          ? (() => {
            const portKey = String(name).trim();
            if (!/^\d+$/.test(portKey)) {
              throw new Error(`[strict:csp] Expected numeric 800MX port name, got '${name}' in ${profilePath}`);
            }
            const serviceTypes = strictPortServiceTypes.get(portKey);
            if (!serviceTypes?.size) {
              throw new Error(`[strict:csp] Missing 800MX service types for port ${portKey} in ${streamL1Path}`);
            }
            return [...serviceTypes];
          })()
          : null;

        const allowedPluggables = pickAllowedPluggables(moduleInfo, pluggables, {
          strict: strictCsp800mx,
          serviceTypes: strictServices ?? moduleInfo.serviceTypes,
        });

        if (strictCsp800mx && !allowedPluggables.length) {
          throw new Error(`[strict:csp] No pluggables matched 800MX port ${name} in ${profilePath}`);
        }

        const behavior = cleanBehavior(defaultBehaviorByRole[role] ?? {});
        ports.push({
          id,
          role,
          ...(Object.keys(behavior).length ? { behavior } : {}),
          allowedPluggables,
        });
      }
    }

    const profileSlots = uniqueSortedNums(root?.attributes?.slots ?? []);
    const width = linecardWidthOverrideForVendorType(vendorType)
      ?? deriveWidthFromSlots(profileSlots, lineSlots)
      ?? 1;

    linecards.push({
      id: linecardIdForVendorType(vendorType),
      name: linecardNameForVendorType(vendorType),
      ...(width > 1 ? { width } : {}),
      ...(l0 ? { l0 } : {}),
      ports,
    });
  }

  if (!linecards.length) throw new Error(`No linecards generated for stream ${stream}`);

  if (options.strict && stream.toLowerCase() === 'csp') {
    const byId = new Map(pluggables.map((pluggable) => [pluggable.id, pluggable]));
    const card800mx = linecards.find((linecard) => linecard.id === 'lc-800mx');
    if (!card800mx) throw new Error('[strict:csp] Missing lc-800mx in generated linecards');
    for (const port of card800mx.ports) {
      if (!port.allowedPluggables.length) {
        throw new Error(`[strict:csp] ${card800mx.name}/${port.id} has no allowed pluggables`);
      }
      const hasDco = port.allowedPluggables.some((id) => byId.get(id)?.dco);
      if (!hasDco) {
        throw new Error(`[strict:csp] ${card800mx.name}/${port.id} has no DCO pluggables`);
      }
    }
  }

  const cleanedPluggables = pluggables.map(({ _families, _portTypes, ...publicFields }) => publicFields);

  outputs.push({
    stream,
    linecardsPath: join(outRoot, stream, 'linecards.json'),
    pluggablesPath: join(outRoot, stream, 'pluggables.json'),
    linecardsJson: linecards,
    pluggablesJson: cleanedPluggables,
  });
}

if (options.dryRun) {
  for (const output of outputs) {
    console.log(`--- ${output.stream} -> ${output.linecardsPath}`);
    console.log(`${JSON.stringify(output.linecardsJson, null, 2)}\n`);
    console.log(`--- ${output.stream} -> ${output.pluggablesPath}`);
    console.log(`${JSON.stringify(output.pluggablesJson, null, 2)}\n`);
  }
  process.exit(0);
}

for (const output of outputs) {
  const writes = [
    { path: output.linecardsPath, payload: output.linecardsJson },
    { path: output.pluggablesPath, payload: output.pluggablesJson },
  ];

  for (const file of writes) {
    const next = `${JSON.stringify(file.payload, null, 2)}\n`;
    const current = (() => {
      try {
        return readFileSync(file.path, 'utf8');
      } catch {
        return '';
      }
    })();

    if (current === next) {
      console.log(`[sync:linecards] up to date (${file.path})`);
      continue;
    }

    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, next, 'utf8');
    console.log(`[sync:linecards] wrote ${file.path}`);
  }

  console.log(`[sync:linecards] stream ${output.stream}: ${output.linecardsJson.length} linecards, ${output.pluggablesJson.length} pluggables`);
}
