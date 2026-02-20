/**
 * source-files.ts — bakes section + infra source into the bundle at build time
 *
 * Uses Vite's import.meta.glob with ?raw to embed raw TypeScript source.
 * ~50KB raw text, ~10KB gzipped — negligible bundle impact.
 */

const sections = import.meta.glob('./sections/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const infra = import.meta.glob([
  './wallet.ts',
  './dapp-kit.ts',
  './sui-client.ts',
  './worker.ts',
  './lib/crosschain.ts',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function getSectionSource(id: string): string | null {
  const key = `./sections/${id}.ts`;
  return sections[key] ?? null;
}

export function getInfraSource(filename: string): string | null {
  const key = `./${filename}`;
  return infra[key] ?? null;
}
