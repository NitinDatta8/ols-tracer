#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const options = {
  iiviRoot: '../IIVI_Platform',
  stream: 'csp',
  box: 'box3',
  out: 'data',
  dryRun: false,
};

const usage = [
  'Build CSP CLI branch/index/observed/merged artifacts under data/.',
  '',
  'Usage:',
  '  npm run sync:cli-data:csp -- [--iivi-root <path>] [--box <id>] [--out <path>] [--dry-run]',
  '',
  'Notes:',
  '  - This command currently supports stream csp only.',
  '  - Artifacts are written to data/cli/csp and data/boxes/<box>.',
].join('\n');

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--help' || arg === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (arg === '--dry-run') {
    options.dryRun = true;
    continue;
  }
  if (arg === '--iivi-root' || arg === '--stream' || arg === '--box' || arg === '--out') {
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

if (options.stream !== 'csp') {
  throw new Error(`This command is CSP-only for now. Received --stream ${options.stream}`);
}

const fromRepo = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));
const toPosix = (path) => path.replace(/\\/g, '/');
const relRepo = (path) => toPosix(relative(repoRoot, path));
const nowIso = new Date().toISOString();

const slug = (text) => String(text ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unknown';

const normalizeText = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text : null;
};

const stripXmlComments = (xml) => xml.replace(/<!--[\s\S]*?-->/g, '');

const parseCsv = (value) => (String(value ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean));

const parseCmdTypes = (raw) => parseCsv(raw).map((type) => type.toLowerCase()).filter((type) => (
  type === 'set' || type === 'show' || type === 'delete' || type === 'add' || type === 'rpc'
));

const parseNodeType = (raw) => {
  const type = String(raw ?? '').trim().toLowerCase();
  if (type === 'container' || type === 'list' || type === 'leaf') return type;
  return 'unknown';
};

const boolYes = (value) => String(value ?? '').trim().toLowerCase() === 'yes';

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function parseCmdNodeTree(xml) {
  const roots = [];
  const stack = [];
  const tag = /<\/?cmd-node\b[^>]*>/g;
  let seq = 0;

  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    const text = match[0];
    const isClose = text.startsWith('</');
    const isSelfClosing = /\/>$/.test(text);

    if (isClose) {
      const node = stack.pop();
      if (!node) throw new Error('Unbalanced cmd-node close tag');
      node.innerStart = node.openEnd;
      node.innerEnd = match.index;
      node.closeStart = match.index;
      node.end = tag.lastIndex;
      continue;
    }

    const attributes = parseAttributes(text);
    const node = {
      seq: seq += 1,
      attributes,
      children: [],
      start: match.index,
      openEnd: tag.lastIndex,
      innerStart: tag.lastIndex,
      innerEnd: tag.lastIndex,
      closeStart: tag.lastIndex,
      end: tag.lastIndex,
    };

    if (stack.length) stack.at(-1).children.push(node);
    else roots.push(node);

    if (isSelfClosing) continue;
    stack.push(node);
  }

  if (stack.length) throw new Error('Unbalanced cmd-node open tag');
  return roots;
}

function stripNestedCmdNodes(innerXml) {
  const tag = /<\/?cmd-node\b[^>]*>/g;
  let depth = 0;
  let cursor = 0;
  let out = '';

  for (let match = tag.exec(innerXml); match; match = tag.exec(innerXml)) {
    if (depth === 0) out += innerXml.slice(cursor, match.index);
    const text = match[0];
    const isClose = text.startsWith('</');
    const isSelfClosing = /\/>$/.test(text);
    if (isClose) depth = Math.max(0, depth - 1);
    else if (!isSelfClosing) depth += 1;
    cursor = tag.lastIndex;
  }
  if (depth === 0) out += innerXml.slice(cursor);
  return out;
}

const tagValue = (xml, name) => {
  const hit = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return hit ? normalizeText(hit[1]) : null;
};

const tagValues = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))]
  .map((hit) => normalizeText(hit[1]))
  .filter(Boolean);

function nodeStats(node, depth = 1) {
  const children = node.children.map((child) => nodeStats(child, depth + 1));
  return {
    nodeCount: 1 + children.reduce((sum, item) => sum + item.nodeCount, 0),
    leafCount: (node.children.length ? 0 : 1) + children.reduce((sum, item) => sum + item.leafCount, 0),
    maxDepth: Math.max(depth, ...children.map((item) => item.maxDepth)),
  };
}

function toBranchNode(rawNode, context, path) {
  const name = normalizeText(rawNode.attributes.name) ?? `unnamed-${rawNode.seq}`;
  const currentPath = [...path, name];
  const nodeId = `${context.branchId}:n${context.nodeSeq += 1}`;
  const rawInner = context.xml.slice(rawNode.innerStart, rawNode.innerEnd);
  const directInner = stripNestedCmdNodes(rawInner);
  const keyElemRaw = tagValue(directInner, 'key-elem');
  const keyElem = keyElemRaw ? parseCsv(keyElemRaw) : null;
  const idName = tagValue(directInner, 'id-name');
  const values = parseCsv(tagValue(directInner, 'values') ?? '');
  const cmdTypeRaw = normalizeText(rawNode.attributes['cmd-type']) ?? '';

  const node = {
    nodeId,
    name,
    aliasName: tagValue(directInner, 'alias-name'),
    type: parseNodeType(tagValue(directInner, 'type')),
    path: currentPath,
    cmdTypeRaw,
    cmdTypes: parseCmdTypes(cmdTypeRaw),
    key: tagValue(directInner, 'key'),
    keyQuery: tagValue(directInner, 'key-query'),
    keyElem: keyElem?.length ? keyElem : null,
    idName,
    keyPattern: tagValue(directInner, 'key-pattern'),
    keyRegex: tagValue(directInner, 'key-regex'),
    keyPrefixReplacement: tagValue(directInner, 'key-prefix-replacement'),
    permissionRule: tagValue(directInner, 'permission-rule'),
    helperInfo: tagValue(directInner, 'helper-info'),
    unit: tagValue(directInner, 'unit'),
    values,
    flags: {
      keyPatternMatchOnly: boolYes(tagValue(directInner, 'key-pattern-match-only')),
      tableShowOnly: boolYes(tagValue(directInner, 'table-show-only')),
      noAutoCompletionForShow: boolYes(tagValue(directInner, 'no-auto-completion-for-show')),
      keyCaseSensitive: boolYes(tagValue(directInner, 'key-case-sensitive')),
      valueCaseSensitive: boolYes(tagValue(directInner, 'value-case-sensitive')),
    },
    children: [],
  };

  node.children = rawNode.children.map((child) => toBranchNode(child, context, currentPath));
  return node;
}

const paramName = (node) => {
  if (node.keyElem?.length) return { name: slug(node.keyElem[0]), source: 'key-elem' };
  if (node.idName) return { name: slug(node.idName), source: 'id-name' };
  return { name: `${slug(node.name)}-id`, source: 'implicit' };
};

const commandTagHints = (path) => {
  const haystack = path.map((item) => item.toLowerCase()).join(' ');
  const tags = new Set();
  if (haystack.includes('inventory') || haystack.includes('transceiver') || haystack.includes('card') || haystack.includes('chassis')) {
    tags.add('inventory');
  }
  if (haystack.includes('alarm')) tags.add('alarm');
  if (haystack.includes('pm')) tags.add('pm');
  if (haystack.includes('power')) tags.add('power');
  if (haystack.includes('port') || haystack.includes('eth')) tags.add('port-state');
  if (haystack.includes('osc') || haystack.includes('lldp') || haystack.includes('neighbor')) tags.add('neighbor');
  return [...tags];
};

function commandFromPath(branchId, nodes, op) {
  const tokens = [{ kind: 'literal', text: op }];

  for (const node of nodes) {
    tokens.push({ kind: 'literal', text: node.name });
    if (node.type === 'list') {
      const param = paramName(node);
      tokens.push({
        kind: 'param',
        name: param.name,
        source: param.source,
        pattern: node.keyRegex ?? node.keyPattern ?? null,
      });
    } else if (node.type === 'leaf' && op !== 'show') {
      tokens.push({
        kind: 'param',
        name: `${slug(node.name)}-value`,
        source: 'value',
        pattern: null,
      });
    }
  }

  const syntax = tokens.map((token) => (token.kind === 'literal' ? token.text : `<${token.name}>`)).join(' ');
  const path = nodes.map((node) => node.name);
  const tail = nodes.at(-1);

  return {
    commandId: `${branchId}__${op}__${path.map((part) => slug(part)).join('__')}`,
    branchId,
    nodeRef: { nodeId: tail.nodeId, path },
    op,
    syntax,
    tokens,
    cmdTypeRaw: tail.cmdTypeRaw,
    cmdTypes: tail.cmdTypes,
    nodeType: tail.type,
    keyPattern: tail.keyPattern,
    keyRegex: tail.keyRegex,
    helperInfo: tail.helperInfo,
    permissionRule: tail.permissionRule,
    safe: op === 'show',
    tags: commandTagHints(path),
  };
}

function flattenCommands(branchId, root) {
  const commands = [];

  const walk = (node, ancestry) => {
    const path = [...ancestry, node];
    for (const op of node.cmdTypes) {
      commands.push(commandFromPath(branchId, path, op));
    }
    for (const child of node.children) walk(child, path);
  };

  walk(root, []);
  return commands;
}

function ensureUniqueCommandIds(commands) {
  const seen = new Map();
  return commands.map((command) => {
    const next = (seen.get(command.commandId) ?? 0) + 1;
    seen.set(command.commandId, next);
    if (next === 1) return command;
    return { ...command, commandId: `${command.commandId}-${next}` };
  });
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value, dryRun) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current === text) {
    console.log(`[sync:cli-data:csp] up to date (${relRepo(path)})`);
    return;
  }
  if (current) {
    try {
      const oldJson = JSON.parse(current);
      const dropGeneratedAt = (node) => {
        if (Array.isArray(node)) return node.map(dropGeneratedAt);
        if (node && typeof node === 'object') {
          const out = {};
          for (const [key, item] of Object.entries(node)) {
            if (key === 'generatedAt') continue;
            out[key] = dropGeneratedAt(item);
          }
          return out;
        }
        return node;
      };
      if (JSON.stringify(dropGeneratedAt(oldJson)) === JSON.stringify(dropGeneratedAt(value))) {
        console.log(`[sync:cli-data:csp] up to date (${relRepo(path)})`);
        return;
      }
    } catch {
      // Keep going: invalid existing JSON means we should overwrite.
    }
  }
  if (dryRun) {
    console.log(`[sync:cli-data:csp] would write ${relRepo(path)}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  console.log(`[sync:cli-data:csp] wrote ${relRepo(path)}`);
}

const iiviRoot = fromRepo(options.iiviRoot);
const outRoot = fromRepo(options.out);
const stream = options.stream;
const box = options.box;

const profileDir = join(iiviRoot, 'profile', 'cu', 'cli', stream);
// Without the IIVI source (a machine with only this repo), the committed index stays as it is and only the observed
// and merged artifacts are rebuilt from the runs.
const xmlFiles = existsSync(profileDir)
  ? readdirSync(profileDir).filter((name) => /^cli_shortcut_cmds_.*\.xml$/.test(name)).sort()
  : [];

const cliRoot = join(outRoot, 'cli', stream);
const branchesRoot = join(cliRoot, 'branches');
const boxRoot = join(outRoot, 'boxes', box);
const runsRoot = join(boxRoot, 'runs');
const ttpTemplatesRoot = join(boxRoot, 'ttp', 'templates');
const ttpFixturesRoot = join(boxRoot, 'ttp', 'fixtures');

if (!options.dryRun) {
  mkdirSync(branchesRoot, { recursive: true });
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(ttpTemplatesRoot, { recursive: true });
  mkdirSync(ttpFixturesRoot, { recursive: true });
}

const branches = [];
const commands = [];
const branchIdSeen = new Map();

for (const fileName of xmlFiles) {
  const filePath = join(profileDir, fileName);
  const xml = stripXmlComments(readFileSync(filePath, 'utf8'));
  const roots = parseCmdNodeTree(xml);
  const sourceBase = fileName.replace(/\.xml$/i, '');

  for (const rawRoot of roots) {
    const rootName = normalizeText(rawRoot.attributes.name) ?? `root-${rawRoot.seq}`;
    const baseBranchId = `${sourceBase}__${slug(rootName)}`;
    const seq = (branchIdSeen.get(baseBranchId) ?? 0) + 1;
    branchIdSeen.set(baseBranchId, seq);
    const branchId = seq === 1 ? baseBranchId : `${baseBranchId}-${seq}`;
    const context = { xml, branchId, nodeSeq: 0 };
    const root = toBranchNode(rawRoot, context, []);
    const stats = nodeStats(root);
    const doc = {
      schemaVersion: '1.0',
      kind: 'branch',
      stream,
      branchId,
      source: {
        iiviRoot: relRepo(iiviRoot),
        profileDir: relRepo(profileDir),
        sourceFile: relRepo(filePath),
        generatedAt: nowIso,
        extractor: 'scripts/sync-cli-index-csp.mjs',
        extractorVersion: '1.0',
      },
      root,
      stats,
    };
    writeJson(join(branchesRoot, `${branchId}.json`), doc, options.dryRun);

    branches.push({
      branchId,
      sourceFile: relRepo(filePath),
      rootName,
      rootNodeId: root.nodeId,
    });

    commands.push(...flattenCommands(branchId, root));
  }
}

const indexPath = join(cliRoot, 'cli-index.source.json');
const uniqueCommands = xmlFiles.length ? ensureUniqueCommandIds(commands) : readJson(indexPath)?.commands;
if (!uniqueCommands) throw new Error(`No cli_shortcut_cmds_*.xml under ${profileDir} and no ${relRepo(indexPath)}`);
if (!xmlFiles.length) console.log(`[sync:cli-data:csp] no CLI XML under ${relRepo(profileDir)}: using ${relRepo(indexPath)}`);

const indexDoc = {
  schemaVersion: '1.0',
  kind: 'index',
  stream,
  generatedAt: nowIso,
  source: {
    iiviRoot: relRepo(iiviRoot),
    profileDir: relRepo(profileDir),
    xmlFiles: xmlFiles.map((name) => relRepo(join(profileDir, name))),
    extractor: 'scripts/sync-cli-index-csp.mjs',
    extractorVersion: '1.0',
  },
  branches,
  commands: uniqueCommands,
  stats: {
    branchCount: branches.length,
    commandCount: uniqueCommands.length,
    safeCount: uniqueCommands.filter((command) => command.safe === true).length,
    unsafeCount: uniqueCommands.filter((command) => command.safe === false).length,
  },
};

if (xmlFiles.length) writeJson(indexPath, indexDoc, options.dryRun);

const runIds = existsSync(runsRoot)
  ? readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];

/**
 * The index command a command line runs. The syntax's words match the line's, a <key> matches any word, and a list's
 * last key may be left out (`show och` lists them all); only options (`-l 200`) may follow. An rpc is typed without
 * its `rpc`. The match with the most literal words wins, so typos and commands the index lacks match nothing.
 */
function commandFor(line) {
  const typed = line.trim().split(/\s+/);
  const key = (word) => word.startsWith('<');
  let best = null;
  let bestScore = -1;
  for (const command of uniqueCommands) {
    const words = command.syntax.split(' ').slice(command.op === 'rpc' && typed[0] !== 'rpc' ? 1 : 0);
    const fits = words.every((word, i) => (i < typed.length ? key(word) || word === typed[i] : key(word) && i === words.length - 1))
      && (typed.length <= words.length || typed[words.length].startsWith('-'));
    const score = words.filter((word) => !key(word)).length;
    if (fits && score > bestScore) [best, bestScore] = [command, score];
  }
  return best;
}

/** Each run's raw/index.jsonl, one { n, cmd, at, source, file, ok } per command run, grouped by the index command. */
const runCaptures = new Map();
for (const runId of runIds) {
  const runRoot = join(runsRoot, runId);
  const indexFile = join(runRoot, 'raw', 'index.jsonl');
  if (!existsSync(indexFile)) continue;
  const meta = readJson(join(runRoot, 'meta.json'), {});
  for (const entry of readFileSync(indexFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))) {
    const command = commandFor(entry.cmd);
    if (!command) continue;
    if (!runCaptures.has(command.commandId)) runCaptures.set(command.commandId, []);
    runCaptures.get(command.commandId).push({ runId, runRoot, meta, entry });
  }
}

const observations = uniqueCommands.map((command) => {
  const captures = [];
  for (const { runId, runRoot, meta, entry } of runCaptures.get(command.commandId) ?? []) {
    const rawPath = join(runRoot, 'raw', entry.file);
    const parsedPath = join(runRoot, 'parsed', entry.file.replace(/\.txt$/, '.json'));

    let parseStatus = 'not-attempted';
    let parseError = null;
    let parseResultPath = null;

    if (existsSync(parsedPath)) {
      parseResultPath = relRepo(parsedPath);
      const parsed = readJson(parsedPath, null);
      if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'error')) {
        parseStatus = 'error';
        parseError = String(parsed.error ?? 'parse error');
      } else {
        parseStatus = 'ok';
      }
    }

    captures.push({
      runId,
      command: entry.cmd,
      rawPath: relRepo(rawPath),
      startedAt: entry.at ?? (typeof meta.started === 'string' ? meta.started : nowIso),
      endedAt: entry.at ?? (typeof meta.ended === 'string' ? meta.ended : nowIso),
      promptBefore: true,
      promptAfter: entry.ok === true,
      terminalCols: 250,
      redacted: false,
      parse: {
        status: parseStatus,
        templateId: existsSync(join(ttpTemplatesRoot, `${command.commandId}.ttp`)) ? command.commandId : null,
        resultPath: parseResultPath,
        error: parseError,
      },
    });
  }

  const parseOk = captures.some((capture) => capture.parse.status === 'ok');
  const parseError = captures.some((capture) => capture.parse.status === 'error');
  const captured = captures.length > 0;

  let status = 'not-run';
  if (parseError) status = 'parse-error';
  else if (parseOk) status = 'parse-ok';
  else if (captured) status = 'captured';

  return {
    commandId: command.commandId,
    status,
    onBox: captured ? 'yes' : 'unknown',
    helpEvidence: {
      sourcePath: null,
      matched: false,
    },
    captures,
    notes: '',
  };
});

const observedDoc = {
  schemaVersion: '1.0',
  kind: 'observed',
  stream,
  boxId: box,
  generatedAt: nowIso,
  source: {
    runsRoot: relRepo(runsRoot),
    runIds,
    captureRules: {
      pagingOffCommand: 'set cli length 0',
      minTerminalCols: 250,
      preservePrompt: false, // raw files hold the lines between the echo and the next prompt
      allowEdits: false,
    },
  },
  observations,
  stats: {
    commandCount: observations.length,
    onBoxYes: observations.filter((item) => item.onBox === 'yes').length,
    onBoxNo: observations.filter((item) => item.onBox === 'no').length,
    onBoxUnknown: observations.filter((item) => item.onBox === 'unknown').length,
    capturedCount: observations.filter((item) => item.captures.length > 0).length,
    parseOkCount: observations.filter((item) => item.status === 'parse-ok').length,
    parseErrorCount: observations.filter((item) => item.status === 'parse-error').length,
  },
};

writeJson(join(boxRoot, 'cli-observed.json'), observedDoc, options.dryRun);

const observationsByCommand = new Map(observedDoc.observations.map((observation) => [observation.commandId, observation]));

const mergedCommands = uniqueCommands.map((command) => {
  const observation = observationsByCommand.get(command.commandId);
  const captures = observation?.captures ?? [];
  const runsSeen = [...new Set(captures.map((capture) => capture.runId))];
  const parseOkCount = captures.filter((capture) => capture.parse.status === 'ok').length;
  const parseErrorCount = captures.filter((capture) => capture.parse.status === 'error').length;
  const parseStatus = observation?.status === 'parse-ok'
    ? 'parse-ok'
    : observation?.status === 'parse-error'
      ? 'parse-error'
      : observation?.status === 'captured'
        ? 'no-template'
        : 'not-run';

  const templatePath = join(ttpTemplatesRoot, `${command.commandId}.ttp`);
  const fixtureTxtPath = join(ttpFixturesRoot, `${command.commandId}.txt`);
  const fixtureJsonPath = join(ttpFixturesRoot, `${command.commandId}.json`);

  const pollEligible = command.op === 'show' && observation?.onBox === 'yes' && parseStatus === 'parse-ok';
  const pollReason = pollEligible
    ? 'show command observed and parse-ok'
    : command.op !== 'show'
      ? 'non-show command'
      : observation?.onBox !== 'yes'
        ? 'not observed on box'
        : 'missing parse-ok capture';

  return {
    commandId: command.commandId,
    branchId: command.branchId,
    op: command.op,
    syntax: command.syntax,
    onBox: observation?.onBox ?? 'unknown',
    observed: (observation?.captures.length ?? 0) > 0,
    parseStatus,
    coverage: {
      runsSeen,
      captureCount: captures.length,
      parseOkCount,
      parseErrorCount,
    },
    sourceMeta: {
      nodeType: command.nodeType,
      cmdTypeRaw: command.cmdTypeRaw,
      cmdTypes: command.cmdTypes,
      keyPattern: command.keyPattern,
      keyRegex: command.keyRegex,
      helperInfo: command.helperInfo,
      permissionRule: command.permissionRule,
    },
    runtime: {
      safe: command.safe,
      tags: command.tags,
    },
    pollCandidate: {
      eligible: pollEligible,
      reason: pollReason,
      templateId: pollEligible ? command.commandId : null,
      everySec: pollEligible ? 30 : null,
    },
    template: {
      templatePath: existsSync(templatePath) ? relRepo(templatePath) : null,
      fixtureTxtPath: existsSync(fixtureTxtPath) ? relRepo(fixtureTxtPath) : null,
      fixtureJsonPath: existsSync(fixtureJsonPath) ? relRepo(fixtureJsonPath) : null,
    },
  };
});

const mergedDoc = {
  schemaVersion: '1.0',
  kind: 'merged',
  stream,
  boxId: box,
  generatedAt: nowIso,
  refs: {
    indexPath: relRepo(join(cliRoot, 'cli-index.source.json')),
    observedPath: relRepo(join(boxRoot, 'cli-observed.json')),
  },
  commands: mergedCommands,
  stats: {
    commandCount: mergedCommands.length,
    onBoxYes: mergedCommands.filter((command) => command.onBox === 'yes').length,
    onBoxNo: mergedCommands.filter((command) => command.onBox === 'no').length,
    onBoxUnknown: mergedCommands.filter((command) => command.onBox === 'unknown').length,
    observedYes: mergedCommands.filter((command) => command.observed).length,
    parseOkCount: mergedCommands.filter((command) => command.parseStatus === 'parse-ok').length,
    pollEligibleCount: mergedCommands.filter((command) => command.pollCandidate.eligible).length,
  },
};

writeJson(join(boxRoot, 'cli-index.merged.json'), mergedDoc, options.dryRun);

console.log(`[sync:cli-data:csp] stream=${stream}, box=${box}, branches=${branches.length}, commands=${uniqueCommands.length}`);
