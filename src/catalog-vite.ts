// The app's catalog: every catalog/<folder>/<kind>.json, bundled by Vite at build time. Node can't run import.meta.glob,
// so code outside Vite reads the same files with catalog-node.ts.
import streamsJson from '../catalog/streams.json';
import { catalogs } from './catalog';
import type { Stream } from './types';

export const streams: Stream[] = streamsJson;

// Not the bridge's own files there: the procedures and the lab file, which the bridge serves, and saving the lab must not
// reload the page.
const files = import.meta.glob(['../catalog/*/*.json', '!../catalog/*/procedures.json', '!../catalog/*/lab.olst.json'], { eager: true, import: 'default' });

export const catalogFor = catalogs((name) => files[`../catalog/${name}`]);
