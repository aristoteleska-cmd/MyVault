/**
 * Guards the parts of the Windows installer that cannot be exercised from
 * Linux.
 *
 * None of this is testable by running it here — makensis only runs on the
 * Windows job — so what is pinned instead is the handful of decisions that are
 * easy to lose in a refactor and expensive to discover afterwards, when someone
 * is standing in a shop with a laptop.
 */
import assert from 'assert';
import { readFileSync } from 'fs';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log('  ok  ' + label); };

const nsh = readFileSync('build/installer.nsh', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const nsis = pkg.build.nsis;

// -------------------------------------------------- the folder can be chosen
assert.strictEqual(nsis.oneClick, false, 'the installer asks rather than assuming');
assert.strictEqual(
  nsis.allowToChangeInstallationDirectory,
  true,
  'the shop chooses where MyVault goes',
);
ok('the installer shows a folder page at all');

// NSIS otherwise re-checks the box on every keystroke and greys out Install
// with no explanation — including for a bare drive root like D:\. Both spellings
// matter: the !define is what the Modern UI reads, the bare instruction is the
// NSIS attribute underneath it.
assert.match(
  nsh,
  /^\s*!define MUI_DIRECTORYPAGE_VERIFYONLEAVE\s*$/m,
  'the Modern UI is told to verify on leave',
);
assert.match(nsh, /^\s*DirVerify leave\s*$/m, 'NSIS itself is told to verify on leave');
assert.doesNotMatch(nsh, /DirVerify\s+auto/, 'nothing puts the keystroke check back');
ok('Install is never greyed out while the folder is being typed');

// The check has to happen somewhere, and it has to be able to answer back.
assert.match(nsh, /!macro customPageAfterChangeDir/, 'the chosen folder is inspected');
assert.match(nsh, /MessageBox/, 'a folder that cannot be used is explained in words');
assert.match(nsh, /StrCpy \$INSTDIR \$defaultInstallDir/, 'and the install still goes ahead');
ok('an unwritable folder is reported and worked around, not a dead end');

// A write test that leaves its probe behind would ship a stray file.
const probes = [...nsh.matchAll(/\.myvault-write-test/g)].length;
assert.ok(probes >= 2, 'the write probe is deleted as well as created');
assert.match(nsh, /Delete "\$INSTDIR\\\.myvault-write-test"/, 'the probe is cleaned up');
ok('the writability probe does not leave a file behind');

// ------------------------------------------------------------- script health
const macros = [...nsh.matchAll(/^\s*!macro\s+(\w+)/gm)].map((m) => m[1]);
const macroEnds = [...nsh.matchAll(/^\s*!macroend\s*$/gm)].length;
assert.strictEqual(macros.length, macroEnds, 'every !macro is closed');
for (const required of ['customInit', 'customPageAfterChangeDir', 'customInstall', 'customUnInstall']) {
  assert.ok(macros.includes(required), `${required} is defined`);
}
ok(`${macros.length} installer macros, all closed`);

const functions = [...nsh.matchAll(/^\s*Function\s+(\w+)/gm)].map((m) => m[1]);
const functionEnds = [...nsh.matchAll(/^\s*FunctionEnd\s*$/gm)].length;
assert.strictEqual(functions.length, functionEnds, 'every Function is closed');
for (const name of functions) {
  assert.ok(
    new RegExp(`Page custom ${name}\\b`).test(nsh),
    `${name} is actually wired to a page`,
  );
}
ok('installer functions are closed and reachable');

// ------------------------------------------------------------- wiring to the build
assert.strictEqual(nsis.include, 'build/installer.nsh', 'electron-builder compiles this file');
assert.strictEqual(nsis.perMachine, false, 'a shop assistant can install without an admin password');
ok('the script is wired into the build');

console.log('\n' + passed + ' checks passed.');
