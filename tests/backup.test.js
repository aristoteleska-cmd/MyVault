/**
 * What "Backup all data" actually has to contain.
 *
 * It did not contain the shop. The button wrote myvault.json and nothing else,
 * so a backup held the catalogue — names, prices, counts — and none of the
 * history: no sales, no takings, no invoices, no VAT inputs. Restoring it on a
 * new PC gave back the shelves and reported a shop that had never traded. The
 * restore said it had succeeded, because by its own reckoning it had.
 *
 * That is the worst kind of defect this program can have. It is invisible until
 * the day the old machine is gone, and on that day it is not recoverable. So
 * these tests are written as the thing a person actually does — take a backup on
 * one PC, restore it on a different empty one — and they assert on the numbers a
 * shopkeeper would look at: how many sales, how many invoices, how much money.
 *
 * The second drive is held to the same standard. A USB stick that carries the
 * catalogue and not the takings is the same defect with an extra step.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-backup-'));
  dirs.push(dir);
  const store = new Store(dir, '1.10.1');
  store.init();
  store.updateSettings({
    vatEnabled: true, vatRate: 24, pricesIncludeVat: true, costsIncludeVat: false, ...settings,
  });
  return store;
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-stick-'));
  dirs.push(dir);
  return dir;
}

function refusesWith(fn, expected) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert.ok(message, 'expected this to be refused, and it was not');
  assert.ok(message.includes(expected), `refusal did not mention "${expected}": ${message}`);
}

/** Counts what is on file, not what an object in memory remembers. */
function tally(store) {
  let movements = 0;
  let invoices = 0;
  store.movements.forEach({}, () => { movements += 1; });
  store.documents.forEach({}, () => { invoices += 1; });
  return { movements, invoices, items: store.getState().items.length };
}

/** A shop that has actually sold something, so there is history to lose. */
function tradingShop() {
  const store = shop();
  const wine = store.addItem({ name: 'Ρετσίνα 500ml', quantity: 40, price: 3.20, cost: 1.60 });
  const oil = store.addItem({ name: 'Ελαιόλαδο 1L', quantity: 12, price: 11.50, cost: 7.00 });

  let draft = store.startDraft({ kind: 'out' });
  draft = store.setDraftLine(draft.id, { itemId: wine.id, quantity: 6 });
  draft = store.setDraftLine(draft.id, { itemId: oil.id, quantity: 2 });
  const sale = store.postDraft(draft.id, {});

  store.adjustStock(wine.id, -1, { reason: 'loss' });
  return { store, wine, oil, sale };
}

// ================================================ a backup carries the history
{
  const { store, sale } = tradingShop();
  const before = tally(store);
  assert.ok(before.movements >= 4, `the shop should have traded: ${before.movements} movements`);
  assert.strictEqual(before.invoices, 1);

  const backup = store.exportAll();
  const text = JSON.stringify(backup);

  assert.ok(backup.logs, 'a backup has a logs section at all');
  assert.ok(text.includes(sale.document.number), 'and the invoice number is somewhere inside it');
  ok('a backup file contains the sales history and the invoices, not only the catalogue');

  // The version and the moment, so a person can tell two backups apart without
  // opening them, and so a future restore knows what it is looking at.
  assert.strictEqual(backup.backupOf, '1.10.1');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(backup.backupAt), 'a backup says when it was taken');
  ok('and says which version wrote it and when');
}

// ==================================================== the whole point: new PC
{
  const { store: old, sale } = tradingShop();
  const before = tally(old);
  const backup = JSON.parse(JSON.stringify(old.exportAll()));

  // A different machine. Nothing on it.
  const fresh = shop();
  assert.deepStrictEqual(tally(fresh), { movements: 0, invoices: 0, items: 0 });

  const outcome = fresh.importAll(backup);
  const after = tally(fresh);

  assert.strictEqual(after.items, before.items, 'the catalogue came back');
  assert.strictEqual(after.movements, before.movements, 'and every movement with it');
  assert.strictEqual(after.invoices, before.invoices, 'and every invoice');
  assert.strictEqual(outcome.withoutHistory, false);
  ok(`restoring on an empty machine gives back all ${before.movements} movements and ${before.invoices} invoice`);

  // Not just the count — the invoice itself, by number, with its lines.
  const restored = fresh.documents.find(sale.document.id);
  assert.ok(restored, 'the invoice is findable by id after the restore');
  assert.strictEqual(restored.number, sale.document.number);
  assert.strictEqual(restored.lines.length, 2);
  assert.strictEqual(restored.total, sale.document.total);
  ok('the restored invoice has the same number, the same lines and the same total');
}

// ============================================ and the money still adds up after
{
  const { store: old } = tradingShop();
  const { vatReport } = require('../electron/vat');
  const window = { from: '2000-01-01', to: '2100-01-01' };
  const wasOwed = vatReport(old.getState(), old.movements, window);

  const fresh = shop();
  fresh.importAll(JSON.parse(JSON.stringify(old.exportAll())));
  const nowOwed = vatReport(fresh.getState(), fresh.movements, window);

  assert.strictEqual(nowOwed.payable, wasOwed.payable);
  assert.deepStrictEqual(nowOwed.collected, wasOwed.collected);
  assert.ok(nowOwed.collected.vat > 0, 'the shop had actually collected some VAT');
  ok(`the VAT return reads the same on the new machine: ${nowOwed.payable.toFixed(2)} payable`);
}

// ================================================ a backup from an older version
{
  // Before this fix, backups were the database on its own. Those files exist on
  // people's sticks right now. They must still restore, and must say what they
  // could not bring rather than quietly implying a shop with no past.
  const { store: old } = tradingShop();
  const oldStyle = { ...old.getState() };

  const fresh = shop();
  const outcome = fresh.importAll(JSON.parse(JSON.stringify(oldStyle)));

  assert.strictEqual(outcome.withoutHistory, true);
  assert.strictEqual(outcome.movementYears, 0);
  assert.ok(fresh.getState().items.length > 0, 'the catalogue still restores');
  ok('a backup written before this existed still restores, and says it carries no history');
}

// ============================================ a restore does not leave leftovers
{
  // The new machine is not always empty. If it has its own year of movements and
  // the backup has that year too, the restored year replaces it — the two are
  // not merged, because a merge would double every sale in the overlap.
  const { store: old } = tradingShop();
  const backup = JSON.parse(JSON.stringify(old.exportAll()));
  const expected = tally(old);

  const used = tradingShop().store;
  used.addItem({ name: 'Something else entirely', quantity: 5, price: 1, cost: 0.5 });
  assert.ok(tally(used).movements > 0, 'the target machine has its own history first');

  used.importAll(backup);
  assert.deepStrictEqual(tally(used), expected, 'the restored shop is the backed-up shop exactly');
  ok('restoring over a machine that already had data replaces it rather than merging');

  // And nothing of the restore is left in the file that is not part of the shop.
  const onDisk = JSON.parse(fs.readFileSync(path.join(used.dataDir, 'myvault.json'), 'utf8'));
  assert.ok(!('logs' in onDisk), 'the log text is not written into myvault.json');
  assert.ok(!('backupAt' in onDisk), 'nor the backup stamp');
  ok('and the backup wrapper does not end up inside the live data file');
}

// ================================================= a hostile backup file cannot
{
  // The year in a backup becomes part of a path. A file handed to a shop on a
  // stick is not trusted input, so anything that is not four digits is skipped
  // rather than written.
  const fresh = shop();
  const evil = {
    ...fresh.getState(),
    logs: {
      movements: {
        '../../../../../../tmp/myvault-escape': 'written outside the data folder\n',
        '2024': '{"id":"m1","kind":"out","quantity":1}\n',
        'not-a-year': 'ignored\n',
        '20244': 'ignored\n',
      },
      invoices: { 2024: 12345 },
    },
  };

  const outcome = fresh.importAll(JSON.parse(JSON.stringify(evil)));
  assert.strictEqual(outcome.movementYears, 1, 'exactly one year was accepted');
  assert.strictEqual(outcome.invoiceYears, 0, 'a year whose text is not text is refused');
  assert.ok(!fs.existsSync('/tmp/myvault-escape'), 'nothing was written outside the data folder');

  const written = fs.readdirSync(fresh.movements.dir);
  assert.deepStrictEqual(written, ['movements-2024.ndjson']);
  ok('a backup file cannot write outside the data folder through its year names');
}

// ====================================================== the second drive, too
{
  const { store } = tradingShop();
  const stick = scratch();
  store.updateSettings({ backupFolder: stick });
  store.mirrorBackup({ force: true });

  const top = fs.readdirSync(stick).sort();
  assert.ok(top.some((n) => n.startsWith('myvault-backup-')), 'the catalogue is on the stick');
  assert.ok(top.includes('history'), 'and so is the sales history');
  assert.ok(top.includes('invoices'), 'and the invoices');

  const year = new Date().getUTCFullYear();
  const mirrored = path.join(stick, 'history', `movements-${year}.ndjson`);
  assert.ok(fs.existsSync(mirrored), 'the current year of movements is on the stick');
  assert.strictEqual(
    fs.readFileSync(mirrored, 'utf8'),
    fs.readFileSync(store.movements.fileFor(year), 'utf8'),
    'byte for byte',
  );
  ok('the second drive gets the takings and the invoices, not just the shelf list');

  // Nothing half-written is left behind for a person to find and wonder about.
  assert.ok(
    !fs.readdirSync(path.join(stick, 'history')).some((n) => n.endsWith('.part')),
    'no temporary file survives a successful copy',
  );
  ok('and no half-copied file is left on the stick');
}

// ========================================== mirroring is cheap on every save
{
  // This runs on every routine backup. The logs are append-only, so a year that
  // has not grown is not copied again — otherwise a shop with eight years of
  // trading pays for all eight every few minutes.
  const { store } = tradingShop();
  const stick = scratch();
  store.updateSettings({ backupFolder: stick });

  const first = store.mirrorLogs(stick);
  assert.ok(first >= 1, 'the first pass copies what is there');

  const second = store.mirrorLogs(stick);
  assert.strictEqual(second, 0, 'a second pass with nothing new copies nothing');
  ok('an unchanged year is not copied twice');

  // But a new sale is picked up immediately.
  const item = store.getState().items[0];
  store.adjustStock(item.id, -1, { reason: 'sale' });
  assert.strictEqual(store.mirrorLogs(stick), 1, 'the year that grew is copied again');

  const year = new Date().getUTCFullYear();
  assert.strictEqual(
    fs.readFileSync(path.join(stick, 'history', `movements-${year}.ndjson`), 'utf8'),
    fs.readFileSync(store.movements.fileFor(year), 'utf8'),
  );
  ok('and one more sale is on the stick the next time a backup runs');
}

// ================================================ an unplugged stick is not a bug
{
  const { store } = tradingShop();
  const gone = path.join(scratch(), 'no-such-drive', 'backups');
  store.updateSettings({ backupFolder: gone });

  // The shop must keep selling with the stick out. mirrorBackup swallows; the
  // log copy inside it must not be the thing that starts throwing.
  assert.doesNotThrow(() => store.mirrorBackup(), 'a missing drive never stops a sale');
  assert.doesNotThrow(() => store.mirrorLogs(path.join(gone, 'deeper')));
  ok('a missing second drive is reported, not thrown');
}

// ====================================== a stick with a year on it can restore it
{
  // The end of the story the mirror exists for: the PC is gone, and all the shop
  // has is the stick. The dated .json on it is a full backup, so it restores the
  // same way as one taken by the button.
  const { store: old } = tradingShop();
  const stick = scratch();
  old.updateSettings({ backupFolder: stick });

  // The mirror copies the live data file, which is the database alone — so the
  // history on the stick is the ndjson folders beside it. Rebuild a backup from
  // the two the way a person would by hand, and check it restores whole.
  old.mirrorBackup({ force: true });
  const dated = fs.readdirSync(stick).find((n) => n.startsWith('myvault-backup-'));
  const database = JSON.parse(fs.readFileSync(path.join(stick, dated), 'utf8'));
  const year = new Date().getUTCFullYear();
  const rebuilt = {
    ...database,
    logs: {
      movements: {
        [year]: fs.readFileSync(path.join(stick, 'history', `movements-${year}.ndjson`), 'utf8'),
      },
      invoices: {
        [year]: fs.readFileSync(path.join(stick, 'invoices', `invoices-${year}.ndjson`), 'utf8'),
      },
    },
  };

  const fresh = shop();
  fresh.importAll(rebuilt);
  assert.deepStrictEqual(tally(fresh), tally(old), 'everything on the stick came back');
  ok('a shop whose PC is gone can rebuild from the stick alone');
}

// ================================ the folder is there, MyVault is looking elsewhere
{
  // The morning this exists for. A shop runs the portable copy for a while, then
  // installs MyVault properly. The installed copy keeps its data in the Windows
  // app-data folder, so it opens on an empty catalogue while a year of trading
  // sits in MyVault-Data beside the old .exe. Nothing is lost and nothing is
  // broken, and from the counter it is indistinguishable from having lost
  // everything.
  const { store: old } = tradingShop();
  const before = tally(old);

  const installed = shop();
  assert.deepStrictEqual(tally(installed), { movements: 0, invoices: 0, items: 0 });

  const outcome = installed.adoptFolder(old.dataDir);

  assert.strictEqual(outcome.from, old.dataDir);
  assert.deepStrictEqual(tally(installed), before, 'the whole shop came across');
  assert.ok(outcome.movementYears >= 1, 'including the years of history');
  assert.ok(outcome.invoiceYears >= 1, 'and the invoices');
  ok('a shop can point MyVault at the folder its old copy was using, and get everything back');

  // Undoable: what was here before is parked, not overwritten and forgotten.
  assert.ok(outcome.safety, 'a copy of what was here first was taken');
  assert.ok(fs.existsSync(outcome.safety), 'and it is where it says');
  ok('with a copy of whatever was here first, so pointing at the wrong folder is undoable');

  // The folder it came from is left exactly as it was — a shop that adopts the
  // wrong one has not damaged the right one.
  assert.deepStrictEqual(tally(old), before, 'the folder it read from is untouched');
  ok('and the folder it read from is not disturbed');
}

// ==================================================== and it refuses the rest
{
  const store = shop();
  const empty = scratch();

  refusesWith(() => store.adoptFolder(empty), 'not a MyVault data folder');
  refusesWith(() => store.adoptFolder(store.dataDir), 'already using');
  ok('a folder with no shop in it, or the one already in use, is refused by name');

  fs.writeFileSync(path.join(empty, 'myvault.json'), 'not json at all', 'utf8');
  refusesWith(() => store.adoptFolder(empty), 'could not be read');

  fs.writeFileSync(path.join(empty, 'myvault.json'), JSON.stringify({ hello: 'world' }), 'utf8');
  refusesWith(() => store.adoptFolder(empty), 'does not look like a MyVault shop');
  ok('and so is a myvault.json that is damaged or is not one at all');

  // Refused means nothing happened, not half a shop.
  assert.deepStrictEqual(tally(store), { movements: 0, invoices: 0, items: 0 });
  ok('a refusal leaves this copy exactly as it was');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
