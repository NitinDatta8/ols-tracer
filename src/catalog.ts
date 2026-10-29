import streamsJson from '../catalog/streams.json';
import type { Catalog, CliLevel, Stream } from './types';

export const streams: Stream[] = streamsJson;

// Every catalog/<folder>/<kind>.json, bundled at build time.
const files = import.meta.glob<{ id: string }[]>('../catalog/*/*.json', { eager: true, import: 'default' });
const cliFiles = import.meta.glob<Catalog['cli']>('../catalog/*/cli.json', { eager: true, import: 'default' });

const cache = new Map<string, Catalog>();

/** catalog/common merged with catalog/<stream>. Stream items override common items with the same id, stream CLI templates common ones. */
export function catalogFor(stream: string): Catalog {
  const merge = (kind: keyof Catalog) => {
    const items = ['common', stream].flatMap((dir) => files[`../catalog/${dir}/${kind}.json`] ?? []);
    return [...new Map(items.map((x) => [x.id, x])).values()];
  };
  if (!cache.has(stream)) {
    cache.set(stream, { chassis: merge('chassis'), linecards: merge('linecards'), pluggables: merge('pluggables'),
      cli: { ...cliFiles['../catalog/common/cli.json'], ...cliFiles[`../catalog/${stream}/cli.json`] } } as Catalog);
  }
  return cache.get(stream)!;
}

export const byId = <T extends { id: string }>(items: T[], id: string | undefined) => items.find((x) => x.id === id);

/** The CLI command for one level, e.g. `show card 1-3`. */
export const cli = (cat: Catalog, level: CliLevel, vars: { chassis?: number; slot?: string; port?: string }) =>
  cat.cli[level]?.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k as keyof typeof vars] ?? m)) ?? '';

/** The CLI mode (index into `cli.modes`) after `command` ran in `mode`: the next mode's `enter` goes one deeper, `exit` one back. */
export const nextMode = (cat: Catalog, mode: number, command: string) =>
  command === cat.cli.modes[mode + 1]?.enter ? mode + 1 : command === 'exit' ? Math.max(0, mode - 1) : mode;
