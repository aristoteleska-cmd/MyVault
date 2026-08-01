/**
 * NSIS wants the licence as a .txt inside the build resources folder, but the
 * copy people read lives at the repo root. Copy it across at package time so
 * there is only ever one source of truth.
 *
 * The copy is written with a UTF-8 byte-order mark and Windows line endings:
 * without the mark the installer misreads non-ASCII characters, which would
 * mangle the Greek in the copyright line on the licence screen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const licence = readFileSync(join(root, 'LICENSE'), 'utf8').replace(/^﻿/, '');
const forWindows = licence.replace(/\r?\n/g, '\r\n');

writeFileSync(join(root, 'build', 'license.txt'), `﻿${forWindows}`, 'utf8');
console.log('build/license.txt refreshed from LICENSE (UTF-8 with BOM, CRLF)');
