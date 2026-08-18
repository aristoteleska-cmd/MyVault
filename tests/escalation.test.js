/**
 * Three ways somebody could get more than their role was given.
 *
 * None of these is exotic. Each one is a place where the program trusted a value
 * that came from the window, or wrote half of a change it had already refused.
 *
 *  1. The reason on a movement arrived as free text and was passed straight
 *     through. The permission check only looked at the sign of the number, so a
 *     junior with nothing but the till could take stock off the shelf and file
 *     it as a "correction": the shelf goes down, the takings do not go up, the
 *     VAT return has no sale in it, and every screen agrees that nothing was
 *     sold. That is not a permissions nicety, it is a way to empty a shop.
 *
 *  2. Changing a person applied each field as it validated. Refusing the second
 *     field left the first one applied in memory, so the screen showed one name
 *     and the next save wrote another.
 *
 *  3. A full backup contains every PIN's salt and hash. A PIN is four digits.
 *     Writing that file wherever one likes was allowed to anybody who could
 *     export a CSV.
 *
 * The reason table is tested directly rather than through Electron, which is why
 * it lives in roles.js: a rule about who may do what belongs with the other
 * rules about who may do what, and can then be checked without a window.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { COUNTER_REASONS, requestedReason, can, ROLES } = require('../electron/roles');
const { REASONS } = require('../electron/movements');
const { Store } = require('../electron/store');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-escalation-'));
  dirs.push(dir);
  const store = new Store(dir, '1.10.1');
  store.init();
  return store;
}

function refused(fn, expected) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert.ok(message, 'expected this to be refused, and it was not');
  if (expected) {
    assert.ok(message.includes(expected), `refusal did not mention "${expected}": ${message}`);
  }
  return message;
}

// ============================================ 1. what the counter may call it
{
  // Nothing named: the direction decides, exactly as before.
  assert.deepStrictEqual(requestedReason(undefined, true), { reason: 'sale' });
  assert.deepStrictEqual(requestedReason(undefined, false), { reason: 'delivery' });
  assert.deepStrictEqual(requestedReason('', true), { reason: 'sale' });
  ok('with no reason given, stock going down is a sale and stock coming up is a delivery');

  // The reasons the engine writes for itself are not the window's to claim.
  for (const internal of ['new', 'import', 'delete', 'restore']) {
    assert.ok(REASONS.includes(internal), `${internal} is a real movement reason`);
    refused(() => requestedReason(internal, true), 'is not a reason MyVault records stock under');
  }
  ok('the reasons the engine writes for itself cannot be claimed from the window');

  // Nor can anything invented.
  refused(() => requestedReason('shrinkage', true), 'not a reason');
  refused(() => requestedReason('__proto__', true), 'not a reason');
  refused(() => requestedReason({ toString: () => 'sale' }, true), 'not a reason');
  ok('and neither can a reason that does not exist, however it is dressed up');

  // A reason has to match the way the stock is actually moving.
  refused(() => requestedReason('sale', false), 'cannot add any');
  refused(() => requestedReason('delivery', true), 'cannot take any off');
  refused(() => requestedReason('return', true), 'cannot take any off');
  ok('a sale cannot put stock on the shelf, and a delivery cannot take any off');

  // A correction and a stock take genuinely go both ways.
  assert.deepStrictEqual(requestedReason('correction', true), { reason: 'correction' });
  assert.deepStrictEqual(requestedReason('correction', false), { reason: 'correction' });
  assert.deepStrictEqual(requestedReason('stocktake', true), { reason: 'stocktake' });
  ok('a correction and a stock take may go either way, because they do');
}

// ================================== and the permission each reason then needs
{
  // The whole point: what a junior can name, and what they cannot.
  assert.strictEqual(can('junior', COUNTER_REASONS.sale.capability), true);
  assert.strictEqual(can('junior', COUNTER_REASONS.correction.capability), false);
  assert.strictEqual(can('junior', COUNTER_REASONS.stocktake.capability), false);
  assert.strictEqual(can('junior', COUNTER_REASONS.return.capability), false);
  assert.strictEqual(can('junior', COUNTER_REASONS.delivery.capability), false);
  ok('a junior may record a sale and may not describe it as anything else');

  // A senior runs the floor, so all five are theirs.
  for (const [reason, rule] of Object.entries(COUNTER_REASONS)) {
    assert.strictEqual(can('senior', rule.capability), true, `a senior should be able to ${reason}`);
  }
  ok('a senior may record any of them, which is what running the floor means');

  // Every reason names a capability that actually exists, so a typo cannot
  // silently become "nobody needs a permission for this".
  for (const [reason, rule] of Object.entries(COUNTER_REASONS)) {
    assert.ok(rule.capability, `${reason} names no capability`);
    assert.ok(
      ROLES.some((role) => can(role, rule.capability)),
      `${reason} needs "${rule.capability}", which no role has — is it a real capability?`,
    );
    assert.ok(['up', 'down', 'both'].includes(rule.direction), `${reason} has no direction`);
  }
  ok('every reason names a real permission and a direction');

  // And each one is a reason the log will actually keep. A reason the log does
  // not know is rewritten to "correction" when it is stored, which would put the
  // permission check and the record quietly out of step.
  for (const reason of Object.keys(COUNTER_REASONS)) {
    assert.ok(REASONS.includes(reason), `the movement log does not record "${reason}"`);
  }
  ok('and every reason survives being written to the history unchanged');
}

// ============================== 2. changing a person is all of it or none of it
{
  const store = freshStore();
  const boss = store.addUser({ name: 'Maria', role: 'admin', pin: '1234' });
  store.addUser({ name: 'Petros', role: 'senior', pin: '5678' });

  // Renaming the only manager while demoting them: the demotion is refused, so
  // the rename must not have happened either.
  refused(
    () => store.updateUser(boss.id, { name: 'Maria K', role: 'senior' }),
    'only manager',
  );
  assert.strictEqual(store.listUsers().find((u) => u.id === boss.id).name, 'Maria');
  assert.strictEqual(store.listUsers().find((u) => u.id === boss.id).role, 'admin');
  ok('a refused demotion does not leave the new name applied');

  // A PIN that is too short is refused after the name has been checked. Same
  // rule: nothing changes.
  refused(() => store.updateUser(boss.id, { name: 'Maria K', pin: '12' }), 'PIN');
  assert.strictEqual(store.listUsers().find((u) => u.id === boss.id).name, 'Maria');
  ok('a refused PIN does not leave the new name applied either');

  // A PIN somebody else already uses, likewise.
  refused(() => store.updateUser(boss.id, { name: 'Maria K', pin: '5678' }), 'already uses that PIN');
  assert.strictEqual(store.listUsers().find((u) => u.id === boss.id).name, 'Maria');
  ok('nor does a PIN that is already taken');

  // The file agrees with the screen — the point of the whole exercise.
  const onDisk = JSON.parse(fs.readFileSync(path.join(store.dataDir, 'myvault.json'), 'utf8'));
  assert.strictEqual(onDisk.users.find((u) => u.id === boss.id).name, 'Maria');
  ok('and what is on file is what is on screen, not a half-applied change');

  // A change that is entirely valid still goes through, all of it at once.
  const changed = store.updateUser(boss.id, { name: 'Maria K', pin: '4321' });
  assert.strictEqual(changed.name, 'Maria K');
  assert.ok(store.findByPin('4321'), 'the new PIN works');
  assert.strictEqual(store.findByPin('1234'), null, 'and the old one does not');
  ok('a change with nothing wrong with it still applies in full');
}

// ==================================== 3. a full backup is a manager's to write
{
  // The file this writes carries salt and hash for every PIN in the shop, and a
  // PIN is four digits — an offline guess with all the time in the world. The
  // capability is asserted against the source, because the handler itself needs
  // Electron to run and this is the one line that matters.
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

  assert.ok(
    main.includes("handle('data:backup', 'settings.manage'"),
    'a full backup no longer requires only the export permission',
  );
  assert.strictEqual(can('senior', 'settings.manage'), false);
  assert.strictEqual(can('admin', 'settings.manage'), true);
  ok('writing a full backup needs the manager permission, not the export one');

  // The CSV export stays where it was: it is the catalogue, and nothing in it
  // is a credential.
  assert.ok(main.includes("handle('data:export-csv', 'data.export'"), 'CSV export is still the senior\'s');
  assert.strictEqual(can('senior', 'data.export'), true);
  ok('exporting the catalogue to CSV is still the senior\'s job');

  // Putting a shop back was already a manager action and stays one.
  assert.ok(main.includes("handle('data:restore', 'settings.manage'"));
  ok('and restoring one still is too');

  // What is actually in that file, so the reason for the rule is not a guess.
  const store = freshStore();
  store.addUser({ name: 'Maria', role: 'admin', pin: '1234' });
  const backup = JSON.stringify(store.exportAll());
  assert.ok(backup.includes('"salt"') && backup.includes('"hash"'), 'the backup does carry the hashes');
  ok('a full backup really does contain the PIN hashes, which is why');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
