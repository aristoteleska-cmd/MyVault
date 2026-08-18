/**
 * Runs the test files in tests/.
 *
 * The store tests are plain CommonJS and run directly on Node. The search tests
 * are TypeScript and share types with the app, so they are bundled with esbuild
 * (already part of the Vite toolchain) before running. No test framework, no
 * extra dependencies.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'myvault-tests-'));

const suites = [
  { name: 'store + CSV', file: 'tests/store.test.js', typescript: false },
  { name: 'search + sort', file: 'tests/search.test.ts', typescript: true },
  { name: 'translations', file: 'tests/i18n.test.ts', typescript: true },
  { name: 'installer script', file: 'tests/installer.test.ts', typescript: true },
  { name: 'files and injection', file: 'tests/files.test.js', typescript: false },
  { name: 'updates', file: 'tests/updates.test.js', typescript: false },
  { name: 'roles + staff', file: 'tests/roles.test.js', typescript: false },
  { name: 'updater flow', file: 'tests/updater-flow.test.js', typescript: false },
  { name: 'movement log', file: 'tests/movements.test.js', typescript: false },
  { name: 'statistics', file: 'tests/statistics.test.js', typescript: false },
  { name: 'shop floor', file: 'tests/shopfloor.test.js', typescript: false },
  { name: 'VAT', file: 'tests/vat.test.js', typescript: false },
  { name: 'invoices', file: 'tests/documents.test.js', typescript: false },
  { name: 'a real invoice', file: 'tests/real-invoice.test.js', typescript: false },
  { name: 'prices and margins', file: 'tests/pricing.test.js', typescript: false },
  { name: 'services and discounts', file: 'tests/services.test.js', typescript: false },
  { name: 'awkward days', file: 'tests/edges.test.js', typescript: false },
  { name: 'a month in a shop', file: 'tests/workflow.test.js', typescript: false },
  { name: 'barcode photos', file: 'tests/barcode.test.ts', typescript: true },
];

let failed = false;

try {
  for (const suite of suites) {
    console.log(`\n▶ ${suite.name}`);
    let entry = join(root, suite.file);

    if (suite.typescript) {
      entry = join(scratch, 'suite.cjs');
      await esbuild.build({
        entryPoints: [join(root, suite.file)],
        outfile: entry,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        loader: { '.json': 'json' },
        logLevel: 'error',
      });
    }

    try {
      execFileSync(process.execPath, [entry], { cwd: root, stdio: 'inherit' });
    } catch {
      failed = true;
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failed) {
  console.error('\nSome tests failed.');
  process.exit(1);
}
console.log('\nAll test suites passed.');
