/**
 * NSIS wants the licence as a .txt inside the build resources folder, but the
 * copy people read lives at the repo root. Copy it across at package time so
 * there is only ever one source of truth.
 */
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'LICENSE'), join(root, 'build', 'license.txt'));
console.log('build/license.txt refreshed from LICENSE');
