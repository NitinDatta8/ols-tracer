#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  out: '',
  stream: '',
  dryRun: false,
};

const usage = [
  'Sync OLS CLI templates from IIVI profile XML.',
  '',
  'Usage:',
  '  npm run sync:cli -- [--iivi-root <path>] [--stream <id>] [--out <path>] [--dry-run]',
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
const cliRoot = join(iiviRoot, 'profile/cu/cli');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function topLevelNodes(xml) {
  const tags = /<\/?cmd-node\b[^>]*>/g;
  const stack = [];
  const nodes = [];
  for (let m = tags.exec(xml); m; m = tags.exec(xml)) {
    const text = m[0];
    if (text.startsWith('</')) {
      const open = stack.pop();
      if (!open) throw new Error('Unbalanced cmd-node closing tag');
      if (stack.length === 0) nodes.push({ name: open.name, raw: xml.slice(open.start, tags.lastIndex) });
      continue;
    }
    const name = /name\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? '';
    stack.push({ name, start: m.index });
  }
  if (stack.length) throw new Error('Unbalanced cmd-node opening tag');
  return nodes;
}

const hasKeyPattern = (raw, keyPattern) => new RegExp(`<key-pattern>\\s*${escapeRegExp(keyPattern)}\\s*</key-pattern>`).test(raw);

function pick(nodes, check, label, sourcePath) {
  const node = nodes.find(check);
  if (node) return node;
  const names = nodes.map((n) => n.name).join(', ');
  throw new Error(`Could not find ${label} command root in ${sourcePath} (top-level: ${names || 'none'})`);
}

const streamIds = (() => {
  if (options.stream) return [options.stream];
  return readdirSync(cliRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'common')
    .map((entry) => entry.name)
    .sort();
})();

if (!streamIds.length) throw new Error(`No stream folders under ${cliRoot}`);

const extractFromStream = (stream) => {
  const eqptPath = join(cliRoot, stream, 'cli_shortcut_cmds_eqpt.xml');
  const l1Path = join(cliRoot, stream, 'cli_shortcut_cmds_l1.xml');
  if (!existsSync(eqptPath) || !existsSync(l1Path)) {
    throw new Error(`Missing CLI shortcut XML for stream ${stream}: ${eqptPath}, ${l1Path}`);
  }
  const eqpt = topLevelNodes(readFileSync(eqptPath, 'utf8'));
  const l1 = topLevelNodes(readFileSync(l1Path, 'utf8'));

  const chassis = pick(eqpt, (n) => hasKeyPattern(n.raw, 'CHASSIS-') || n.name === 'chassis', 'chassis', eqptPath);
  const card = pick(eqpt, (n) => n.name === 'card', 'card', eqptPath);
  const transceiver = pick(eqpt, (n) => hasKeyPattern(n.raw, 'TRANSCEIVER-') || n.name === 'transceiver', 'transceiver', eqptPath);
  const port = pick(l1, (n) => hasKeyPattern(n.raw, 'PORT-') || n.name === 'port', 'port', l1Path);

  return {
    stream,
    sources: [eqptPath, l1Path],
    generated: {
      chassis: `show ${chassis.name} {chassis}`,
      card: `show ${card.name} {chassis}-{slot}`,
      port: `show ${port.name} {chassis}-{slot}-{port}`,
      pluggable: `show ${transceiver.name} {chassis}-{slot}-{port}`,
    },
  };
};

const preferredFallback = streamIds.includes('csp') ? 'csp' : streamIds[0];
const fallbackBase = extractFromStream(preferredFallback);
const generatedByStream = streamIds.map((stream) => {
  try {
    return extractFromStream(stream);
  } catch (error) {
    if (stream === fallbackBase.stream) throw error;
    return {
      stream,
      sources: [...fallbackBase.sources],
      generated: fallbackBase.generated,
      warning: `Falling back to ${fallbackBase.stream} templates for ${stream}: ${error.message}`,
    };
  }
});

if (options.out && streamIds.length !== 1) {
  throw new Error('--out is only valid with a single stream (use --stream <id>)');
}

const outputs = generatedByStream.map(({ stream, generated, sources, warning }) => ({
  stream,
  sources,
  warning,
  outPath: fromRepo(options.out || `catalog/${stream}/cli.json`),
  next: `${JSON.stringify(generated, null, 2)}\n`,
}));

if (options.dryRun) {
  for (const output of outputs) {
    console.log(`--- ${output.stream} -> ${output.outPath}`);
    process.stdout.write(output.next);
  }
  process.exit(0);
}

for (const output of outputs) {
  const current = (() => {
    try {
      return readFileSync(output.outPath, 'utf8');
    } catch {
      return '';
    }
  })();
  if (current === output.next) {
    console.log(`[sync:cli] up to date (${output.outPath})`);
  } else {
    mkdirSync(dirname(output.outPath), { recursive: true });
    writeFileSync(output.outPath, output.next, 'utf8');
    console.log(`[sync:cli] wrote ${output.outPath}`);
  }
  if (output.warning) console.warn(`[sync:cli] ${output.warning}`);
  console.log(`[sync:cli] sources (${output.stream}): ${output.sources.join(', ')}`);
}
