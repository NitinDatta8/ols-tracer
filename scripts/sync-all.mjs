#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iiviRoot = resolve(repoRoot, '../IIVI_Platform');
const platformRoot = join(iiviRoot, 'profile/cu/platform');
const cliRoot = join(iiviRoot, 'profile/cu/cli');

if (!existsSync(platformRoot) || !existsSync(cliRoot)) {
  console.warn(`[sync:auto] skipped: IIVI profiles not found under ${iiviRoot}`);
  process.exit(0);
}

const args = process.argv.slice(2);
const scripts = [
  'scripts/sync-streams-chassis-from-iivi.mjs',
  'scripts/sync-linecards-from-iivi.mjs',
  'scripts/sync-cli-from-iivi.mjs',
];

for (const script of scripts) {
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

