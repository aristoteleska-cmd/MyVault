/**
 * Who is allowed to do what, and the promise that PINs are never kept as typed.
 *
 * The matrix is written out here a second time, by hand, rather than looped
 * over the one in the source. A test that asks the code what it does and then
 * agrees with it proves nothing; this one states what the shop was promised —
 * a junior sells and searches, a senior runs the floor but not the catalogue —
 * and fails if the code drifts from it.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ROLES, CAPABILITIES, APPEARANCE_SETTINGS,
  can, isLocked, effectiveRole, allows, isAppearanceOnly,
  isValidPin, hashPin, verifyPin, MIN_PIN_LENGTH, MAX_PIN_LENGTH,
  generateRecoveryCode, isValidRecoveryCode, normalizeRecoveryCode, RECOVERY_ALPHABET,
} = require('../electron/roles');
const { Store } = require('../electron/store');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const freshStore = () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-roles-')), '1.2.0');
  store.init();
  return store;
};

// ------------------------------------------------------------- the three roles
assert.deepStrictEqual(ROLES, ['admin', 'senior', 'junior']);
ok('three roles, most trusted first');

// What each role was promised, spelled out independently of the source.
const EXPECTED = {
  admin: {
    yes: [...CAPABILITIES],
    no: [],
  },
  senior: {
    // "add item and stock, but not categories" — plus the two that come with
    // running the floor: knowing what is selling, and writing down a regular.
    yes: ['items.view', 'items.sell', 'items.receive', 'items.create', 'items.edit',
      'data.export', 'clients.view', 'clients.manage', 'stats.view'],
    no: ['categories.manage', 'fields.manage', 'settings.manage', 'staff.manage',
      'items.delete', 'data.import'],
  },
  junior: {
    // "only stock search, and remove when something is sold". They may see the
    // customer list, because putting a sale against the right regular is the
    // till's job; they may not add one, and they may not see the takings.
    yes: ['items.view', 'items.sell', 'clients.view'],
    no: ['items.receive', 'items.create', 'items.edit', 'items.delete',
      'categories.manage', 'fields.manage', 'settings.manage', 'staff.manage',
      'data.export', 'data.import', 'clients.manage', 'stats.view'],
  },
};

for (const [role, { yes, no }] of Object.entries(EXPECTED)) {
  for (const capability of yes) {
    assert.ok(can(role, capability), `${role} may ${capability}`);
  }
  for (const capability of no) {
    assert.ok(!can(role, capability), `${role} may NOT ${capability}`);
  }
  // Nothing granted beyond the list above — this is what catches a new
  // capability being handed out to everyone by accident.
  const granted = CAPABILITIES.filter((capability) => can(role, capability));
  assert.deepStrictEqual(
    granted.sort(),
    [...yes].sort(),
    `${role} holds exactly what it was promised`,
  );
}
ok('admin does everything; senior runs the floor but not the catalogue');
ok('junior can look something up and sell it, and nothing else');

// The specific line the shop drew: senior adds stock, senior does not touch categories.
assert.ok(can('senior', 'items.create') && can('senior', 'items.receive'));
assert.ok(!can('senior', 'categories.manage'), 'senior cannot manage categories');
// And the one the till depends on: a junior sells but cannot invent stock.
assert.ok(can('junior', 'items.sell') && !can('junior', 'items.receive'));
ok('the two lines that matter: senior stops at categories, junior stops at selling');

// The takings are the manager's and the floor's, never the Saturday assistant's.
assert.ok(can('admin', 'stats.view') && can('senior', 'stats.view'));
assert.ok(!can('junior', 'stats.view'), 'a junior cannot read the shop\'s takings');
// But they can say who they are serving, or half the shop's sales go unattributed.
assert.ok(can('junior', 'clients.view') && !can('junior', 'clients.manage'));
ok('the till can name a customer without being shown the profit');

assert.ok(!can('nonsense', 'items.view'), 'an unknown role is refused everything');
assert.ok(!can('admin', 'items.teleport'), 'an unknown capability is refused');
assert.ok(!can(undefined, 'items.view'));
ok('unknown roles and unknown actions are refused, not waved through');

// ------------------------------------------------------- before anyone sets up
assert.strictEqual(isLocked([]), false, 'no staff list means no roles yet');
assert.strictEqual(effectiveRole([], null), 'admin', 'an untouched shop keeps full access');
assert.ok(allows([], null, 'staff.manage'), 'and can therefore set roles up');
ok('a shop that has never set up staff is not locked out by the update');

const staff = [
  { id: 'a', name: 'Owner', role: 'admin' },
  { id: 'j', name: 'Saturday', role: 'junior' },
];
assert.strictEqual(isLocked(staff), true);
assert.strictEqual(effectiveRole(staff, null), null, 'nobody signed in is nobody');
assert.strictEqual(allows(staff, null, 'items.view'), false, 'not even looking, before signing in');
assert.strictEqual(effectiveRole(staff, 'j'), 'junior');
assert.strictEqual(effectiveRole(staff, 'ghost'), null, 'an id that left the list is nobody');
ok('once staff exist, nothing happens until somebody signs in');

// --------------------------------------------------------------- appearance
for (const key of APPEARANCE_SETTINGS) {
  assert.ok(isAppearanceOnly({ [key]: 'x' }), `${key} is anyone's to change`);
}
assert.ok(!isAppearanceOnly({ theme: 'dark', currency: '$' }), 'one shop setting spoils the batch');
assert.ok(!isAppearanceOnly({ shopName: 'X' }));
assert.ok(!isAppearanceOnly({}), 'an empty change is not an appearance change');
ok('turning the text up is nobody\'s business but the person at the screen');

// --------------------------------------------------------------------- PINs
assert.ok(isValidPin('1234'));
assert.ok(!isValidPin('123'), `fewer than ${MIN_PIN_LENGTH} digits is refused`);
assert.ok(!isValidPin('1'.repeat(MAX_PIN_LENGTH + 1)), 'and there is an upper limit');
assert.ok(!isValidPin('12a4'), 'a PIN is digits');
assert.ok(!isValidPin(''), 'an empty PIN is not a PIN');
assert.ok(!isValidPin(1234), 'a number is not a string of digits');
assert.ok(!isValidPin(null));
ok('a PIN is four to twelve digits, and nothing else counts');

const stored = hashPin('4821');
assert.ok(!JSON.stringify(stored).includes('4821'), 'the PIN itself is nowhere in what is stored');
assert.strictEqual(stored.hash.length, 64, 'a 32-byte derived key, in hex');
assert.ok(verifyPin('4821', stored), 'the right PIN verifies');
assert.ok(!verifyPin('4822', stored), 'a wrong PIN does not');
assert.ok(!verifyPin('482', stored), 'nor a prefix of it');
assert.ok(!verifyPin('4821', { salt: stored.salt, hash: 'ff' }), 'nor a truncated hash');
assert.ok(!verifyPin('4821', {}), 'nor nothing at all');
// Same PIN, two people: the salt has to make the stored values differ, or the
// file would show at a glance who shares a PIN with whom.
const twin = hashPin('4821');
assert.notStrictEqual(twin.salt, stored.salt, 'each person gets their own salt');
assert.notStrictEqual(twin.hash, stored.hash, 'so identical PINs are stored differently');
assert.throws(() => hashPin('12'), /4 to 12 digits/);
ok('PINs are salted and hashed, never stored as typed');

// -------------------------------------------------------- recovery codes
{
  const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
  assert.strictEqual(codes.size, 200, 'two hundred codes, no repeats');
  const sample = [...codes][0];
  assert.match(sample, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/, `four groups of five: ${sample}`);
  // Written on paper and typed back months later, so the characters people
  // confuse must not be in the alphabet at all.
  for (const confusable of ['O', 'I', 'L', '0', '1']) {
    assert.ok(!RECOVERY_ALPHABET.includes(confusable), `${confusable} is not in the alphabet`);
  }
  assert.strictEqual(normalizeRecoveryCode('abcde fghjk-mnpqr stuvw'), 'ABCDEFGHJKMNPQRSTUVW');
  assert.ok(!isValidRecoveryCode('ABCDE-FGHJK-MNPQR'), 'a short code is not a code');
  assert.ok(!isValidRecoveryCode('ABCDE-FGHJK-MNPQR-STUV0'), 'nor one with a character we never mint');
  assert.ok(!isValidRecoveryCode(''), 'nor nothing');
  ok('recovery codes are unique, unambiguous and forgiving to type');
}

// ------------------------------------------------------- the staff list itself
const store = freshStore();
assert.deepStrictEqual(store.listUsers(), [], 'a new shop has no staff list');

const owner = store.addUser({ name: 'Aristotelis', role: 'admin', pin: '1111' });
const senior = store.addUser({ name: 'Maria', role: 'senior', pin: '2222' });
store.addUser({ name: 'Saturday', role: 'junior', pin: '3333' });
assert.strictEqual(store.listUsers().length, 3);
ok('staff can be added with a name, a role and a PIN');

// The list that reaches the interface must not carry PIN material.
const listed = store.listUsers();
const asText = JSON.stringify(listed);
assert.ok(!asText.includes('salt') && !asText.includes('hash'), 'no PIN material in the list');
assert.deepStrictEqual(Object.keys(listed[0]).sort(), ['createdAt', 'id', 'name', 'role']);
const published = JSON.stringify(store.publicState());
assert.ok(!published.includes(store.db.users[0].hash), 'nor anywhere in the state the window gets');
ok('the interface is never handed a salt or a hash');

assert.deepStrictEqual(store.findByPin('2222'), { id: senior.id, name: 'Maria', role: 'senior' });
assert.strictEqual(store.findByPin('9999'), null, 'an unknown PIN signs nobody in');
assert.strictEqual(store.findByPin('22'), null, 'nor a malformed one');
ok('a PIN identifies the person who owns it, and only them');

assert.throws(() => store.addUser({ name: 'Maria', role: 'junior', pin: '4444' }), /already someone/);
assert.throws(() => store.addUser({ name: 'New', role: 'junior', pin: '2222' }), /already uses that PIN/);
assert.throws(() => store.addUser({ name: '', role: 'junior', pin: '4444' }), /Give this person a name/);
assert.throws(() => store.addUser({ name: 'X', role: 'boss', pin: '4444' }), /not a role/);
assert.throws(() => store.addUser({ name: 'X', role: 'junior', pin: '12' }), /4 to 12 digits/);
ok('duplicate names, shared PINs and invented roles are all refused');

// ------------------------------------------- nobody can lock the shop out
assert.throws(() => store.deleteUser(owner.id), /only manager/);
assert.throws(() => store.updateUser(owner.id, { role: 'junior' }), /only manager/);
ok('the last manager cannot be deleted or demoted');

const second = store.addUser({ name: 'Kostas', role: 'admin', pin: '5555' });
store.updateUser(owner.id, { role: 'senior' });
assert.strictEqual(store.listUsers().find((u) => u.id === owner.id).role, 'senior');
assert.throws(() => store.deleteUser(second.id), /only manager/, 'now Kostas is the last one');
ok('with a second manager in place, the first can step down');

// A changed PIN takes effect, and the old one stops working.
store.updateUser(senior.id, { pin: '7777' });
assert.strictEqual(store.findByPin('2222'), null, 'the old PIN no longer signs anyone in');
assert.strictEqual(store.findByPin('7777').id, senior.id, 'the new one does');
assert.throws(() => store.updateUser(senior.id, { pin: '3333' }), /already uses that PIN/);
ok('a PIN can be changed, and the old one stops working at once');

// ---------------------------------------------------- surviving a restart
const reopened = new Store(store.dataDir, '1.2.0');
reopened.init();
assert.strictEqual(reopened.listUsers().length, 4, 'the staff list is remembered');
assert.strictEqual(reopened.findByPin('7777').name, 'Maria', 'and so are their PINs');
ok('staff and their PINs survive closing the app');

// -------------------------------------- a file that lost its last manager
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-noadmin-'));
  const shop = new Store(dir, '1.2.0');
  shop.init();
  shop.addUser({ name: 'Only', role: 'admin', pin: '1234' });

  // Hand-edit the file down to no manager at all, the way a well-meaning tidy-up
  // might. Opening that must not leave the shop unable to reach its own stock.
  const file = JSON.parse(fs.readFileSync(shop.file, 'utf8'));
  file.users = file.users.map((user) => ({ ...user, role: 'junior' }));
  fs.writeFileSync(shop.file, JSON.stringify(file), 'utf8');

  const rescued = new Store(dir, '1.2.0');
  rescued.init();
  assert.deepStrictEqual(rescued.listUsers(), [], 'the unusable list is dropped');
  assert.ok(allows(rescued.getState().users, null, 'staff.manage'), 'and the shop can set it up again');
  ok('a staff list with no manager left is dropped rather than locking the shop out');
}

// A staff entry with no PIN could never be signed into and must not linger.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-nopin-'));
  const shop = new Store(dir, '1.2.0');
  shop.init();
  shop.addUser({ name: 'Real', role: 'admin', pin: '1234' });
  const file = JSON.parse(fs.readFileSync(shop.file, 'utf8'));
  file.users.push({ id: 'ghost', name: 'Ghost', role: 'admin' });
  fs.writeFileSync(shop.file, JSON.stringify(file), 'utf8');

  const reloaded = new Store(dir, '1.2.0');
  reloaded.init();
  assert.deepStrictEqual(reloaded.listUsers().map((u) => u.name), ['Real'], 'the PIN-less entry is gone');
  ok('a staff entry with no PIN is dropped, not left looking like a way in');
}

// --------------------------------------------------- forgetting the PIN
{
  const shop = freshStore();
  const owner = shop.addUser({ name: 'Owner', role: 'admin', pin: '1111' });
  shop.addUser({ name: 'Saturday', role: 'junior', pin: '2222' });

  assert.strictEqual(shop.recoveryStatus().exists, false, 'no code until one is issued');
  const code = shop.issueRecoveryCode();
  assert.ok(isValidRecoveryCode(code), `a well-formed code: ${code}`);
  assert.strictEqual(shop.recoveryStatus().exists, true);

  // The point of the whole thing: the code must not be recoverable from the file.
  const onDisk = fs.readFileSync(shop.file, 'utf8');
  assert.ok(!onDisk.includes(code), 'the code itself is nowhere in the data file');
  assert.ok(!onDisk.includes(code.replace(/-/g, '')), 'not even without its dashes');
  ok('a recovery code is issued once and never stored in readable form');

  // Read off a piece of paper months later, in whatever shape it arrives.
  const sloppy = ` ${code.toLowerCase().replace(/-/g, ' ')} `;
  const recovered = shop.useRecoveryCode(sloppy, '8888');
  assert.strictEqual(recovered.user.id, owner.id, 'the shop is handed back to its manager');
  assert.strictEqual(shop.findByPin('8888').id, owner.id, 'with the new PIN working');
  assert.strictEqual(shop.findByPin('1111'), null, 'and the forgotten one dead');
  ok('a code typed in lower case, without dashes, still gets the shop back');

  // Single use: a slip of paper someone has already used is worth nothing.
  assert.throws(() => shop.useRecoveryCode(code, '7777'), /not recognised/);
  assert.ok(isValidRecoveryCode(recovered.nextCode), 'and a fresh code takes its place');
  assert.notStrictEqual(recovered.nextCode, code);
  assert.strictEqual(shop.useRecoveryCode(recovered.nextCode, '7777').user.id, owner.id);
  ok('a used code stops working, and a new one is issued in its place');

  assert.throws(() => shop.useRecoveryCode(generateRecoveryCode(), '5555'), /not recognised/);
  assert.throws(() => shop.useRecoveryCode('nonsense', '5555'), /not recognised/);
  assert.throws(() => shop.useRecoveryCode(shop.issueRecoveryCode(), '12'), /4 to 12 digits/);
  ok('a wrong code, a malformed code and a bad new PIN are all refused');

  // Recovery restores the manager, never anybody else.
  assert.strictEqual(shop.listUsers().length, 2, 'the staff list is untouched');
  assert.strictEqual(shop.findByPin('2222').name, 'Saturday', 'the assistant keeps their PIN');
  ok('recovery changes one manager PIN and nothing else');
}

// -------------------------------------------- a one-person shop opting out
{
  const shop = freshStore();
  shop.addUser({ name: 'Owner', role: 'admin', pin: '1111' });
  shop.issueRecoveryCode();
  shop.addItem({ name: 'Olive oil', quantity: 12 });

  shop.disableStaff();
  assert.deepStrictEqual(shop.listUsers(), [], 'the staff list is emptied');
  assert.strictEqual(shop.recoveryStatus().exists, false, 'and the code goes with it');
  assert.strictEqual(shop.getState().items.length, 1, 'the stock is untouched');
  assert.ok(allows(shop.getState().users, null, 'items.create'), 'MyVault opens freely again');
  ok('a one-person shop can turn roles off without losing anything');
}

console.log('\n' + passed + ' checks passed.');
