// The catalog in Node, such as for the MCP server: catalog/'s files read from disk, the same ones Vite bundles for the
// app (catalog-vite.ts).
import { existsSync, readFileSync } from 'node:fs';
import { catalogs } from './catalog';

const file = (name: string) => new URL(`../catalog/${name}`, import.meta.url);

export const catalogFor = catalogs((name) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : undefined));
