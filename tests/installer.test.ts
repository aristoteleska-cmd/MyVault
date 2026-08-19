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
// with no explanation — including for a bare drive root like D:\.
assert.match(
  nsh,
  /^\s*!define MUI_DIRECTORYPAGE_VERIFYONLEAVE\s*$/m,
  'the Modern UI is told to verify on leave',
);
// The Modern UI expands that define into a DirVerify inside its own PageEx
// block. Writing the instruction here as well does not double up — it fails the
// build with "command DirVerify not valid outside PageEx".
assert.doesNotMatch(nsh, /^\s*DirVerify\b/m, 'DirVerify is left to the Modern UI to emit');
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
  // Either the page's creator or its leave handler — "Page custom a b".
  assert.ok(
    new RegExp(`Page custom (\\w+ )?${name}\\b`).test(nsh),
    `${name} is actually wired to a page`,
  );
}
ok('installer functions are closed and reachable');

// ------------------------------------------- the manager set up at install time
assert.match(nsh, /Page custom managerPage managerPageLeave/, 'the installer asks who manages');
assert.match(nsh, /NSD_CreatePassword/, 'and the PIN is typed masked, not in the clear');
assert.match(nsh, /"SetupName"/, 'the name is handed to the app');
assert.match(nsh, /"SetupPin"/, 'and so is the PIN');
// LogicLib's < and > are numeric, so a letter would read as zero and pass. The
// digits have to be matched by name; this pins that they still are.
assert.match(nsh, /\$\{OrIf\} \$R4 == "9"/, 'each character is checked against a real digit');
assert.doesNotMatch(nsh, /\$R4 < "0"/, 'not with a numeric comparison that letters slip through');
ok('the installer collects a manager and a masked PIN, validated digit by digit');

// The page functions must be built where nsDialogs exists, which is inside the
// macro — at the top of this file the Modern UI has not been included yet.
const macroBody = nsh.slice(nsh.indexOf('!macro customPageAfterChangeDir'));
assert.ok(
  macroBody.indexOf('Function managerPage') < macroBody.indexOf('!macroend'),
  'the manager page is defined inside the macro, where nsDialogs exists',
);
ok('the page is built where its dialog toolkit is available');

// ------------------------------------ each complaint names the box it means
//
// An empty "type it again" box was reported as "the two PINs are different".
// Nothing had been typed to differ, and the message sends a person back to
// check the field that was already right. An empty PIN was reported as being
// the wrong length, which reads as a complaint about a PIN nobody has chosen.
// This is the first screen of a program somebody has just decided to trust with
// their stock, and it was telling them something untrue about their own typing.
const leaveStart = nsh.indexOf('Function managerPageLeave');
const leaveBody = nsh.slice(leaveStart, nsh.indexOf('!macroend', leaveStart));

// Empty PIN and short PIN are different complaints, and the empty one is asked
// about first — otherwise the length message answers for both again.
const emptyPin = leaveBody.indexOf('Choose a PIN for opening MyVault');
const shortPin = leaveBody.indexOf('The PIN must be between 4 and 12 digits');
assert.ok(emptyPin > 0, 'an empty PIN has its own message');
assert.ok(shortPin > 0, 'and a wrong-length one still has its own');
assert.ok(emptyPin < shortPin, 'the empty case is checked first, or the length message answers it');
assert.match(leaveBody, /StrLen \$R2 \$managerPin[\s\S]*\$\{If\} \$R2 == 0/, 'by measuring what was typed');
ok('an empty PIN is not reported as a PIN of the wrong length');

// Same for the second box: blank and different are not the same thing.
const emptyConfirm = leaveBody.indexOf('Type the PIN a second time');
const mismatch = leaveBody.indexOf('The two PINs are different');
assert.ok(emptyConfirm > 0, 'an empty confirmation has its own message');
assert.ok(mismatch > 0, 'and a genuine mismatch keeps its own');
assert.ok(emptyConfirm < mismatch, 'blank is checked before different, or it never reports blank');
assert.match(leaveBody, /StrLen \$R6 \$R1[\s\S]*\$\{If\} \$R6 == 0/, 'measured, not guessed at');
ok('an empty second box is not reported as the two PINs disagreeing');

// Every complaint must stop the page, or the installer would grumble and then
// carry on with a manager it just refused.
const complaints = (leaveBody.match(/MessageBox MB_OK\|MB_ICONEXCLAMATION/g) || []).length;
const aborts = (leaveBody.match(/^\s*Abort\s*$/gm) || []).length;
// Name, PIN missing, PIN too short or too long, PIN not digits, confirmation
// missing, confirmation different.
assert.strictEqual(complaints, 6, 'six things can be wrong on that page');
assert.strictEqual(aborts, complaints, 'and each one stops the page rather than warning and proceeding');
ok('every complaint keeps the person on the page instead of accepting it anyway');

// ------------------------------------------- an update is not a new shop
//
// The manager page appeared on every install, including over a copy that had
// been in use for a year. The owner typed a new PIN, MyVault ignored it — an
// existing staff list is never overwritten — and they were left holding a PIN
// that does not open their own program, wondering why an update had reset it.
const managerBody = nsh.slice(nsh.indexOf('Function managerPage'), nsh.indexOf('Function managerPageLeave'));

assert.match(
  managerBody,
  /IfFileExists\s+"\$APPDATA\\MyVault\\data\\myvault\.json"/,
  'the page looks for an existing shop before asking anything',
);
// The check has to come before the page is drawn, or it asks and then leaves.
assert.ok(
  managerBody.indexOf('IfFileExists') < managerBody.indexOf('MUI_HEADER_TEXT'),
  'and does so before putting anything on screen',
);
assert.ok(
  managerBody.indexOf('Abort') < managerBody.indexOf('nsDialogs::Create'),
  'skipping the page happens before the dialog is created',
);
// And it must not leave a name behind, or customInstall would write registry
// values for a manager this install never collected.
assert.match(managerBody, /StrCpy \$managerName ""/, 'no half-filled manager is left behind');
assert.match(
  nsh,
  /\$\{If\} \$managerName != ""/,
  'and the registry values are only written when a manager was actually asked for',
);
ok('installing over an existing shop does not ask for a new PIN');

// ------------------------------------------------------------- wiring to the build
assert.strictEqual(nsis.include, 'build/installer.nsh', 'electron-builder compiles this file');
assert.strictEqual(nsis.perMachine, false, 'a shop assistant can install without an admin password');
ok('the script is wired into the build');

console.log('\n' + passed + ' checks passed.');
