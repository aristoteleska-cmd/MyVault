/**
 * Three ways MyVault used to lose something without saying so.
 *
 * A program that fails loudly gets fixed on the day it fails. These three failed
 * quietly, which is how a shop finds out months later, from an accountant.
 *
 *  1. A movement that could not be written was swallowed whole. Trade all day
 *     onto a full disk and the shelves count down normally, the takings stay at
 *     zero, the VAT return comes out empty, and nothing anywhere says why.
 *
 *  2. An unreadable data file meant starting empty. The backups folder sitting
 *     right beside it — one of them from that morning — was never looked at.
 *
 *  3. The twelve-hour backup window was measured from when the program started,
 *     so a shop that opens MyVault every morning took a backup every morning and
 *     the ten kept copies covered a week and a half instead of months.
 *
 * Each test here is the shop's morning, not the function's contract: break the
 * thing, then ask what the shopkeeper would see.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-losses-'));
  dirs.push(dir);
  const store = new Store(dir, '1.10.1');
  store.init();
  return store;
}

/** Reopens the same folder, the way closing and starting MyVault does. */
function reopen(store) {
  const again = new Store(store.dataDir, '1.10.1');
  again.init();
  return again;
}

// ================================ 1. a sale that could not be written down
{
  const store = shop();
  const item = store.addItem({ name: 'Ούζο 700ml', quantity: 20, price: 12.40, cost: 6.00 });

  // The history folder becomes something that cannot be appended to. A full
  // disk, a folder locked by a backup program, a stick pulled out — the cause
  // does not matter, only that the write throws.
  const historyDir = store.movements.dir;
  fs.rmSync(historyDir, { recursive: true, force: true });
  fs.writeFileSync(historyDir, 'not a folder', 'utf8');

  assert.strictEqual(store.historyStatus(), null, 'nothing wrong yet');

  // The sale still goes through. Refusing to sell because the history is broken
  // would be the worse failure by a distance.
  const after = store.adjustStock(item.id, -3, { reason: 'sale' });
  assert.strictEqual(after.quantity, 17, 'the stock still moved');
  ok('a sale still goes through when the history cannot be written');

  const trouble = store.historyStatus();
  assert.ok(trouble, 'and the failure is recorded rather than swallowed');
  assert.strictEqual(trouble.lost, 1);
  assert.ok(trouble.message, `the reason is kept: ${trouble.message}`);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(trouble.since), 'and when it started');
  ok('the movement that was lost is counted, with the reason and the time');

  store.adjustStock(item.id, -2, { reason: 'sale' });
  store.adjustStock(item.id, 5, { reason: 'delivery' });
  assert.strictEqual(store.historyStatus().lost, 3, 'every one of them counts');
  ok('and so is every one after it');

  // Closing MyVault and opening it again does not make it go away — the shop may
  // well not have been looking at the screen when it happened.
  const next = reopen(store);
  assert.strictEqual(next.historyStatus().lost, 3);
  ok('the notice survives closing and reopening the program');

  // The disk is emptied. Writing works again, and that is worth saying — but the
  // three movements are still gone, so the notice stays until a person clears it.
  fs.rmSync(historyDir, { force: true });
  next.adjustStock(item.id, -1, { reason: 'sale' });
  const recovered = next.historyStatus();
  assert.strictEqual(recovered.lost, 3, 'the count does not reset itself');
  assert.strictEqual(recovered.writing, true, 'but it says writing works again');
  let written = 0;
  next.movements.forEach({}, () => { written += 1; });
  assert.strictEqual(written, 1, 'only the movement made since is in the history');
  ok('when writing works again it says so, and still does not forget what was lost');

  next.clearHistoryTrouble();
  assert.strictEqual(next.historyStatus(), null);
  assert.strictEqual(reopen(next).historyStatus(), null, 'and stays cleared');
  ok('a person can put the notice away, and it stays away');
}

// ======================= 2. an unreadable file falls back to the newest backup
{
  const store = shop();
  store.addItem({ name: 'Ρετσίνα 500ml', quantity: 40, price: 3.20, cost: 1.60 });
  store.addItem({ name: 'Ελαιόλαδο 1L', quantity: 12, price: 11.50, cost: 7.00 });
  // A sale, so there is history to check is not touched by a rescue.
  store.adjustStock(store.getState().items[0].id, -4, { reason: 'sale' });

  const copy = store.snapshot('test');
  assert.ok(copy, 'a backup exists, as it would on any shop that has been open');

  // The power goes at the till, mid-write.
  fs.writeFileSync(store.file, '{"items": [{"name": "half a wri', 'utf8');

  const after = new Store(store.dataDir, '1.10.1');
  after.init();

  assert.strictEqual(after.getState().items.length, 2, 'the catalogue came back');
  assert.ok(after.getState().recoveredFrom, 'the unreadable file was kept, not destroyed');
  assert.ok(fs.existsSync(after.getState().recoveredFrom), 'and it is where the message says');
  ok('an unreadable data file is replaced from the newest backup, not by an empty shop');

  const told = after.getState().recoveredBackup;
  assert.ok(told, 'and the shop is told that is what happened');
  assert.strictEqual(told.path, copy);
  assert.strictEqual(told.items, 2);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(told.at), 'with the date of the copy it put back');
  ok('with which copy it used and when it was taken, so the shop knows what to re-enter');

  // The sales history is in its own append-only files and was never in danger.
  let movements = 0;
  after.movements.forEach({}, () => { movements += 1; });
  assert.ok(movements >= 3, `the takings survived the rescue: ${movements} movements`);
  ok('and the sales history is untouched, because it was never in that file');

  // The rescued shop is now the live one — reopening finds it normally.
  const again = reopen(after);
  assert.strictEqual(again.getState().items.length, 2);
  ok('the rescued shop is what opens next time');
}

// ============================== a backup that is itself broken is passed over
{
  const store = shop();
  store.addItem({ name: 'Καφές 250g', quantity: 8, price: 4.50, cost: 2.10 });
  const good = store.snapshot('good');

  // Whatever corrupted the live file often caught the copy taken closest to it.
  // A newer, broken backup must not be preferred over an older, readable one.
  const broken = path.join(store.backupDir, 'myvault-auto-9999-01-01T00-00-00.json');
  fs.writeFileSync(broken, '}{ not json at all', 'utf8');
  const notOurs = path.join(store.backupDir, 'myvault-auto-9999-02-02T00-00-00.json');
  fs.writeFileSync(notOurs, JSON.stringify({ hello: 'world' }), 'utf8');
  const later = Date.now() + 60000;
  fs.utimesSync(broken, later / 1000, later / 1000);
  fs.utimesSync(notOurs, later / 1000, later / 1000);

  fs.writeFileSync(store.file, 'nonsense', 'utf8');
  const after = new Store(store.dataDir, '1.10.1');
  after.init();

  assert.strictEqual(after.getState().items.length, 1, 'the readable backup was used');
  assert.strictEqual(after.getState().recoveredBackup.path, good);
  ok('a newer backup that will not parse is passed over for an older one that will');
}

// ================================ nothing to fall back on is still not silent
{
  const store = shop();
  store.addItem({ name: 'Only product', quantity: 1, price: 1, cost: 0.5 });
  fs.rmSync(store.backupDir, { recursive: true, force: true });
  fs.writeFileSync(store.file, 'broken', 'utf8');

  const after = new Store(store.dataDir, '1.10.1');
  after.init();
  assert.strictEqual(after.getState().items.length, 0, 'there was genuinely nothing to restore');
  assert.ok(after.getState().recoveredFrom, 'the unreadable file is still kept');
  assert.strictEqual(after.getState().recoveredBackup, undefined, 'and no false claim of a rescue');
  ok('with no usable backup it starts clean and says so, without pretending otherwise');
}

// ================== 3. the backup window is wall-clock, not per launch
{
  const store = shop();
  store.addItem({ name: 'Wine', quantity: 3, price: 6, cost: 3 });

  const autos = () => fs.readdirSync(store.backupDir).filter((n) => n.startsWith('myvault-auto-'));
  assert.strictEqual(autos().length, 1, 'the first save takes one');
  assert.ok(store.getState().lastBackupAt > 0, 'and writes down when');
  ok('a routine backup records the time it was taken');

  // Reopening used to reset the clock to nought, which took another one at once.
  const morning = reopen(store);
  assert.strictEqual(morning.lastBackupAt, store.getState().lastBackupAt, 'the clock came back');
  morning.addItem({ name: 'Beer', quantity: 6, price: 2, cost: 1 });
  assert.strictEqual(autos().length, 1, 'and no second backup was taken');
  ok('opening MyVault again does not take another backup an hour after the last one');

  // Twelve hours later it does.
  morning.lastBackupAt = Date.now() - (13 * 60 * 60 * 1000);
  morning.db.lastBackupAt = morning.lastBackupAt;
  morning.addItem({ name: 'Water', quantity: 12, price: 0.5, cost: 0.2 });
  assert.strictEqual(autos().length, 2, 'once the window has passed, it does');
  ok('and once twelve hours really have passed, it takes one');

  // A stamp from the future — a clock put back, a file from another machine —
  // must not wedge the window shut until that date arrives.
  const evening = reopen(morning);
  evening.lastBackupAt = Date.now() + (400 * 24 * 60 * 60 * 1000);
  evening.db.lastBackupAt = evening.lastBackupAt;
  evening.addItem({ name: 'Bread', quantity: 4, price: 1.2, cost: 0.6 });
  assert.strictEqual(autos().length, 3, 'a stamp in the future is treated as no stamp');
  ok('a clock put back does not stop backups for a year');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
