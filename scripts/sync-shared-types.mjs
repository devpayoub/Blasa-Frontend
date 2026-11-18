#!/usr/bin/env node
/**
 * Copy the generated API contract from the monorepo checkout into this repo.
 *
 * The backend owns the contract: `apps/api/scripts/generate_shared_types.py`
 * turns the drf-spectacular schema into `packages/shared-types/api.ts`. This
 * repo vendors that file so a clone type-checks on its own; run this script
 * after regenerating the client so the two stay in sync.
 *
 * Usage (from a monorepo checkout where ../packages exists):
 *   npm run sync:types
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.resolve(root, '..', 'packages', 'shared-types', 'api.ts');
const target = path.resolve(root, 'shared-types', 'api.ts');

if (!existsSync(source)) {
  console.error(
    `[sync:types] Source not found: ${source}\n` +
      'This script only works inside the Blasa monorepo. In a standalone clone\n' +
      'the vendored shared-types/api.ts is already the contract to use.'
  );
  process.exit(1);
}

const before = existsSync(target) ? await readFile(target, 'utf8') : '';
const incoming = await readFile(source, 'utf8');

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);

if (before === incoming) {
  console.log('[sync:types] shared-types/api.ts already up to date.');
} else {
  console.log(`[sync:types] Updated shared-types/api.ts (${incoming.length} bytes).`);
}
