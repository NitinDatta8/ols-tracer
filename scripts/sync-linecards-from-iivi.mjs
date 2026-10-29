#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  stream: 'csp',
  linecards: 'catalog/common/linecards.json',
  dryRun: false,
};

const usage = [
  'Sync common linecard ports from IIVI platform profiles (extraction + tracer behavior overlays).',
  '',
  'Usage:',
  '  npm run sync:linecards -- [--iivi-root <path>] [--stream <id>] [--linecards <path>] [--dry-run]',
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
  if (arg === '--iivi-root' || arg === '--stream' || arg === '--linecards') {
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
const streamRoot = join(iiviRoot, 'profile/cu/platform', options.stream);
const platformPath = join(streamRoot, 'PLATFORM.json');
const linecardsPath = fromRepo(options.linecards);

if (!existsSync(platformPath)) throw new Error(`Missing PLATFORM profile: ${platformPath}`);
if (!existsSync(linecardsPath)) throw new Error(`Missing linecard catalog: ${linecardsPath}`);

const platformParsed = JSON.parse(readFileSync(platformPath, 'utf8'));
const platformRoot = platformParsed.PLATFORM ?? platformParsed[Object.keys(platformParsed)[0]];
const classMap = platformRoot?.classname ?? {};

const roles = new Set(['line', 'client', 'adddrop', 'com', 'osc', 'monitor', 'port']);

const defaultBehaviorByRole = {
  line: { showsInL1: true, canLoopback: true },
  client: { showsInData: true },
  adddrop: { showsInData: true },
  com: { showsInData: true },
  osc: {},
  monitor: {},
  port: {},
};

const defaultPluggablesByRole = {
  line: [],
  client: [],
  adddrop: [],
  com: [],
  osc: [],
  monitor: [],
  port: [],
};

const cardConfigs = [
  {
    id: 'lc-c925',
    profile: 'TMUXC925.json',
    root: 'TMUXC925',
    modules: ['COMPORT', 'LINEPORT', 'OSCPORT', 'MONITOR_PORT1', 'MONITOR_PORT2', 'ADDDROP_PORT'],
    roleByModule: {
      COMPORT: 'com',
      LINEPORT: 'line',
      OSCPORT: 'osc',
      MONITOR_PORT1: 'monitor',
      MONITOR_PORT2: 'monitor',
      ADDDROP_PORT: 'adddrop',
    },
    behaviorByRole: {
      com: { showsInData: true, serviceGroup: 'adddrop' },
      adddrop: { showsInData: true, serviceGroup: 'adddrop' },
      line: { showsInL1: true, canLoopback: true, serviceGroup: 'line' },
    },
  },
  {
    id: 'lc-400mx',
    profile: '400MX-S.json',
    root: '400MXS',
    modules: ['CLIENTPORT', 'LINEPORT'],
    roleByModule: {
      CLIENTPORT: 'client',
      LINEPORT: 'line',
    },
    pluggablesByRole: {
      client: ['SFP'],
      line: ['QSFP'],
    },
  },
  {
    id: 'lc-800mx',
    profile: '800MX.json',
    root: '800MX',
    modules: ['PORT'],
    roleByModule: {
      PORT: 'port',
    },
    formatPortId: (_module, name) => `PORT${name}`,
    behaviorByPort: {
      PORT1: { showsInData: true },
      PORT2: { showsInData: true },
      PORT3: { showsInData: true },
      PORT4: { showsInData: true },
      PORT5: { showsInData: true },
      PORT6: { showsInData: true },
      PORT7: { showsInData: true },
      PORT8: { showsInData: true },
      PORT9: { showsInData: true },
      PORT10: { showsInL1: true, canLoopback: true },
    },
    pluggablesByPort: {
      PORT1: ['SFP'],
      PORT2: ['SFP'],
      PORT3: ['SFP'],
      PORT4: ['SFP'],
      PORT5: ['SFP'],
      PORT6: ['SFP'],
      PORT7: ['SFP'],
      PORT8: ['SFP'],
      PORT9: ['SFP'],
      PORT10: ['QSFP'],
    },
  },
];

const inferRole = (module, className, name) => {
  const upModule = String(module).toUpperCase();
  const upClass = String(className ?? '').toUpperCase();
  const upName = String(name).toUpperCase();
  if (upModule.includes('LINEPORT') || upClass === 'LINEPORT' || upName === 'LINE' || /^L\d+$/.test(upName)) return 'line';
  if (upModule.includes('CLIENTPORT') || upClass.startsWith('CLIENTPORT') || /^C\d+$/.test(upName)) return 'client';
  if (upModule.includes('ADDDROP')) return 'adddrop';
  if (upModule.includes('COMPORT') || upName === 'COM') return 'com';
  if (upModule.includes('OSCPORT') || upName.startsWith('OSC')) return 'osc';
  if (upModule.includes('MONITOR')) return 'monitor';
  return 'port';
};

const cleanBehavior = (behavior) => {
  const out = {};
  if (behavior.showsInL1 !== undefined) out.showsInL1 = !!behavior.showsInL1;
  if (behavior.showsInData !== undefined) out.showsInData = !!behavior.showsInData;
  if (behavior.canLoopback !== undefined) out.canLoopback = !!behavior.canLoopback;
  if (behavior.serviceGroup !== undefined) out.serviceGroup = String(behavior.serviceGroup);
  return out;
};

const collectModules = (node, acc = new Map(), parentHidden = false) => {
  const modules = node?.modules;
  if (!modules || typeof modules !== 'object') return acc;
  for (const [moduleName, mod] of Object.entries(modules)) {
    if (moduleName === 'key' || !mod || typeof mod !== 'object') continue;
    const hidden = parentHidden || mod.attributes?.subcomponent?.hidden === true;
    const names = Array.isArray(mod.identity?.names) ? mod.identity.names.filter((x) => typeof x === 'string') : [];
    if (!hidden && names.length) {
      const prev = acc.get(moduleName) ?? [];
      acc.set(moduleName, [...prev, ...names]);
    }
    collectModules(mod, acc, hidden);
  }
  return acc;
};

const buildPorts = (config) => {
  const profilePath = join(streamRoot, config.profile);
  if (!existsSync(profilePath)) throw new Error(`Missing profile for ${config.id}: ${profilePath}`);
  const parsed = JSON.parse(readFileSync(profilePath, 'utf8'));
  const root = parsed[config.root] ?? parsed[Object.keys(parsed)[0]];
  if (!root?.modules) throw new Error(`modules missing in ${profilePath}`);

  const namesByModule = collectModules(root);
  const seen = new Set();
  const ports = [];

  for (const moduleName of config.modules) {
    const names = namesByModule.get(moduleName);
    if (!names?.length) throw new Error(`No identity.names extracted for ${config.id}:${moduleName} (${profilePath})`);

    for (const name of names) {
      const id = config.formatPortId ? config.formatPortId(moduleName, name) : name;
      if (seen.has(id)) throw new Error(`Duplicate port id ${id} while syncing ${config.id}`);
      seen.add(id);

      const role = config.roleByModule?.[moduleName]
        ?? inferRole(moduleName, classMap[moduleName], name);
      if (!roles.has(role)) throw new Error(`Unsupported role ${role} for ${config.id}/${id}`);

      const behavior = cleanBehavior({
        ...(defaultBehaviorByRole[role] ?? {}),
        ...(config.behaviorByRole?.[role] ?? {}),
        ...(config.behaviorByPort?.[id] ?? {}),
      });

      const allowedPluggables = config.pluggablesByPort?.[id]
        ?? config.pluggablesByRole?.[role]
        ?? defaultPluggablesByRole[role]
        ?? [];

      ports.push({
        id,
        role,
        ...(Object.keys(behavior).length ? { behavior } : {}),
        allowedPluggables,
      });
    }
  }

  return ports;
};

const linecards = JSON.parse(readFileSync(linecardsPath, 'utf8'));
const byId = new Map(linecards.map((linecard) => [linecard.id, linecard]));

for (const config of cardConfigs) {
  const existing = byId.get(config.id);
  if (!existing) throw new Error(`Cannot update missing linecard ${config.id} in ${linecardsPath}`);
  byId.set(config.id, {
    ...existing,
    ports: buildPorts(config),
  });
}

const next = linecards.map((linecard) => byId.get(linecard.id) ?? linecard);
const out = `${JSON.stringify(next, null, 2)}\n`;

if (options.dryRun) {
  console.log(out);
  process.exit(0);
}

const current = readFileSync(linecardsPath, 'utf8');
if (current === out) {
  console.log(`[sync:linecards] up to date (${linecardsPath})`);
  process.exit(0);
}

writeFileSync(linecardsPath, out, 'utf8');
console.log(`[sync:linecards] wrote ${linecardsPath}`);
