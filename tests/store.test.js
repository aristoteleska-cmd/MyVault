/**
 * Local store + CSV tests. Plain Node, no framework:
 *
 *     npm test
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store.js');
const { parseCsv, toCsv } = require('../electron/csv.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-test-'));
let passed = 0;
function ok(label) { passed += 1; console.log('  ok  ' + label); }

// ---------------------------------------------------------------- lifecycle
const store = new Store(dir);
store.init();
assert.strictEqual(store.db.items.length, 0);
assert.strictEqual(store.db.categories.length, 1, 'seeds a General category');
assert.ok(fs.existsSync(path.join(dir, 'myvault.json')), 'writes the data file');
ok('first run creates an empty vault');

// -------------------------------------------------------------------- items
const shirt = store.addItem({
  name: '  Cotton T-shirt ', barcode: '5201234567890', quantity: '12', price: '9,90', cost: '4.5',
});
assert.strictEqual(shirt.name, 'Cotton T-shirt', 'trims the name');
assert.strictEqual(shirt.quantity, 12);
assert.strictEqual(shirt.price, 9.9, 'accepts comma decimals');
assert.strictEqual(shirt.cost, 4.5);
assert.strictEqual(shirt.lowStockThreshold, null);
ok('adds an item and normalises typed values');

store.adjustStock(shirt.id, -3);
assert.strictEqual(store.db.items[0].quantity, 9);
store.adjustStock(shirt.id, -100);
assert.strictEqual(store.db.items[0].quantity, 0, 'never goes negative');
store.adjustStock(shirt.id, 5);
ok('stock adjustments clamp at zero');

const updated = store.updateItem(shirt.id, { price: 11.5, name: 'Cotton T-shirt v2' });
assert.strictEqual(updated.price, 11.5);
assert.strictEqual(updated.createdAt, shirt.createdAt, 'keeps the original created date');
ok('updates an item in place');

// --------------------------------------------------------------- categories
const toys = store.addCategory({ name: 'Toys', color: '#ff0000' });
const duplicate = store.addCategory({ name: 'toys' });
assert.strictEqual(duplicate.id, toys.id, 'ignores case-insensitive duplicates');
assert.throws(() => store.addCategory({ name: '   ' }), /required/);
ok('categories are de-duplicated and validated');

store.updateItem(shirt.id, { categoryId: toys.id });
assert.strictEqual(store.db.items[0].categoryId, toys.id);
store.deleteCategory(toys.id);
assert.strictEqual(store.db.items.length, 1, 'deleting a category keeps its items');
assert.strictEqual(store.db.items[0].categoryId, '', 'items become uncategorised');
ok('deleting a category never deletes stock');

// ------------------------------------------------------------ custom fields
store.addField({ name: 'Size', type: 'select', options: ['S', 'M', 'L'] });
store.addField({ name: 'Colour', type: 'text' });
const sizeField = store.db.customFields.find((f) => f.name === 'Size');
assert.strictEqual(store.db.customFields.length, 2);

store.updateItem(shirt.id, { custom: { [sizeField.id]: 'M', 'bogus-field': 'x' } });
assert.strictEqual(store.db.items[0].custom[sizeField.id], 'M');
assert.strictEqual(store.db.items[0].custom['bogus-field'], undefined, 'drops unknown field ids');
ok('custom values are stored and unknown keys rejected');

store.moveField(store.db.customFields[1].id, 'up');
assert.strictEqual(store.db.customFields[0].name, 'Colour', 'reorders fields');
assert.deepStrictEqual(store.db.customFields.map((f) => f.order), [0, 1], 'reindexes order');
ok('fields can be reordered');

store.deleteField(sizeField.id);
assert.strictEqual(store.db.items[0].custom[sizeField.id], undefined, 'scrubs the value from items');
ok('deleting a field cleans up item values');

// ------------------------------------------------------- the five-slot limit
{
  const limited = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-cap-')), '1.0.0');
  limited.init();

  for (const name of ['Size', 'Colour', 'Brand', 'Shelf', 'Age range']) {
    limited.addField({ name, type: 'text' });
  }
  assert.strictEqual(limited.db.customFields.length, 5);
  assert.throws(() => limited.addField({ name: 'Material', type: 'text' }), /up to 5/);
  ok('a sixth extra detail is refused');

  assert.throws(() => limited.addField({ name: 'size', type: 'text' }), /already have a detail/);
  ok('duplicate detail names are refused');

  limited.deleteField(limited.db.customFields[0].id);
  limited.addField({ name: 'Material', type: 'text' });
  assert.strictEqual(limited.db.customFields.length, 5);
  assert.ok(limited.db.customFields.some((f) => f.name === 'Material'));
  ok('deleting one frees a slot');

  // A CSV with more new columns than slots must still import the products.
  const before = limited.db.items.length;
  const capped = limited.importRows(parseCsv([
    'Name,Quantity,Material,Fabric,Season',
    'Linen shirt,4,Linen,Woven,Summer',
  ].join('\n')));
  assert.strictEqual(capped.added, 1, 'the product is still imported');
  assert.strictEqual(limited.db.items.length, before + 1);
  assert.strictEqual(limited.db.customFields.length, 5, 'no sixth detail is created');
  assert.deepStrictEqual(capped.droppedColumns.sort(), ['fabric', 'season']);
  const shirt2 = limited.db.items.find((i) => i.name === 'Linen shirt');
  const material = limited.db.customFields.find((f) => f.name === 'Material');
  assert.strictEqual(shirt2.custom[material.id], 'Linen', 'columns that fit are still kept');
  ok('CSV import stops at the limit but keeps importing products');

  const standardClash = () => limited.addField({ name: 'Barcode', type: 'text' });
  assert.throws(standardClash, /standard detail/);
  ok('a standard detail name cannot be reused');

  fs.rmSync(limited.dataDir, { recursive: true, force: true });
}

// ------------------------------------------------------------ delete + undo
const removed = store.deleteItems([shirt.id]);
assert.strictEqual(store.db.items.length, 0);
store.restoreItems(removed);
assert.strictEqual(store.db.items.length, 1, 'undo puts the item back');
store.restoreItems(removed);
assert.strictEqual(store.db.items.length, 1, 'restoring twice does not duplicate');
ok('delete and undo round-trip');

// ----------------------------------------------------------- staying offline
{
  const { isAllowedRequest } = require('../electron/offline.js');

  const blocked = [
    'https://example.com/anything',
    'http://example.com/anything',
    'https://update.myvault.app/latest.json',
    'ws://example.com/socket',
    'wss://example.com/socket',
    'http://127.0.0.1:8080/',
    'http://localhost:3000/',
    'ftp://files.example.com/x',
    'https://localhost:5173/looks-like-dev',
    '',
    'not a url',
  ];
  for (const url of blocked) {
    assert.strictEqual(isAllowedRequest(url), false, `should be blocked: ${url}`);
  }
  ok('every outbound request is blocked in a packaged build');

  const allowed = [
    'file:///C:/Program%20Files/MyVault/dist/index.html',
    'file:///home/user/app/dist/assets/index.js',
    'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    'blob:file:///abc-123',
    'devtools://devtools/bundled/inspector.html',
  ];
  for (const url of allowed) {
    assert.strictEqual(isAllowedRequest(url), true, `should be allowed: ${url}`);
  }
  ok('the app can still load its own bundled files');

  // The dev server is only ever reachable while developing.
  assert.strictEqual(isAllowedRequest('http://localhost:5173/src/main.tsx', { isDev: true }), true);
  assert.strictEqual(isAllowedRequest('http://localhost:5173/src/main.tsx'), false);
  assert.strictEqual(isAllowedRequest('https://example.com', { isDev: true }), false);
  assert.strictEqual(isAllowedRequest('http://localhost:5173.evil.com/x', { isDev: true }), false);
  ok('the dev server exception cannot be abused in a packaged build');
}

// --------------------------------------------------------------------- csv
const csv = toCsv(['Name', 'Price', 'Notes'], [
  { Name: 'Mug, large', Price: 4.5, Notes: 'He said "hi"\nsecond line' },
]);
const roundTripped = parseCsv(csv);
assert.strictEqual(roundTripped.length, 1);
assert.strictEqual(roundTripped[0].Name, 'Mug, large', 'keeps embedded commas');
assert.strictEqual(roundTripped[0].Notes, 'He said "hi"\nsecond line', 'keeps quotes and newlines');
ok('CSV survives a round trip');

const semicolon = parseCsv('Name;Quantity;Price\r\nWidget;5;1,20\r\n');
assert.strictEqual(semicolon[0].Name, 'Widget', 'detects semicolon delimiter');
assert.strictEqual(semicolon[0].Price, '1,20');
ok('European semicolon CSVs are understood');

// ------------------------------------------------------------------ import
const before = store.db.items.length;
const result = store.importRows(parseCsv([
  'Name,Barcode,Category,Quantity,Price,Age range',
  'Wooden train,111222,Toys,7,24.90,3-5',
  'Puzzle,333444,Toys,3,12.00,6-8',
  ',,,,,',
  ',999888,Toys,4,5.00,3-5',
  'Cotton T-shirt v2,5201234567890,,25,13.50,',
].join('\n')));

assert.strictEqual(result.added, 2, 'adds the two new rows');
assert.strictEqual(result.updated, 1, 'matches the existing barcode and updates it');
assert.strictEqual(result.skipped, 1, 'skips the row that has no name');
assert.strictEqual(result.newCategories, 1, 'recreates the Toys category');
assert.strictEqual(result.newFields, 1, 'turns "Age range" into a custom field');
assert.strictEqual(store.db.items.length, before + 2);

const train = store.db.items.find((i) => i.name === 'Wooden train');
const ageField = store.db.customFields.find((f) => f.name === 'Age Range');
assert.ok(ageField, 'created the Age Range field');
assert.strictEqual(train.custom[ageField.id], '3-5');
assert.strictEqual(train.quantity, 7);
assert.strictEqual(train.price, 24.9);

const merged = store.db.items.find((i) => i.barcode === '5201234567890');
assert.strictEqual(merged.quantity, 25, 'updated quantity from the sheet');
assert.strictEqual(merged.price, 13.5);
ok('CSV import adds, updates by barcode, and creates missing columns');

// --------------------------------------------------------------- durability
const reopened = new Store(dir);
reopened.init();
assert.strictEqual(reopened.db.items.length, store.db.items.length, 'reloads every item');
assert.strictEqual(reopened.db.customFields.length, store.db.customFields.length);
assert.strictEqual(
  reopened.db.items.find((i) => i.name === 'Wooden train').custom[ageField.id],
  '3-5',
  'custom values survive a restart',
);
ok('data survives a restart');

// ------------------------------------------------------------- corrupt file
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-broken-'));
fs.mkdirSync(path.join(brokenDir, 'backups'), { recursive: true });
fs.writeFileSync(path.join(brokenDir, 'myvault.json'), '{ this is not json', 'utf8');
const rescued = new Store(brokenDir);
rescued.init();
assert.ok(rescued.db.recoveredFrom, 'reports the rescue');
assert.ok(fs.existsSync(rescued.db.recoveredFrom), 'parks the unreadable file instead of deleting it');
assert.strictEqual(rescued.db.items.length, 0);
ok('an unreadable file is parked, never destroyed');

// --------------------------------------------------- surviving an app update
{
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-upgrade-'));

  const v1 = new Store(dir2, '1.0.0');
  v1.init();
  v1.addField({ name: 'Size', type: 'select', options: ['S', 'M'] });
  const sizeId = v1.db.customFields[0].id;
  v1.addItem({ name: 'Wool coat', barcode: '111', quantity: 4, price: 89.9, custom: { [sizeId]: 'M' } });
  v1.updateSettings({ currency: '£', theme: 'dark', accent: 'purple', density: 'compact', zoom: 1.15 });

  // The next release opens the same folder, exactly as an installed update would.
  const v2 = new Store(dir2, '1.1.0');
  v2.init();

  assert.strictEqual(v2.db.items.length, 1, 'items survive the update');
  assert.strictEqual(v2.db.items[0].name, 'Wool coat');
  assert.strictEqual(v2.db.items[0].custom[sizeId], 'M', 'custom values survive');
  assert.strictEqual(v2.db.customFields[0].name, 'Size', 'extra details survive');
  assert.strictEqual(v2.db.settings.currency, '£', 'settings survive');
  assert.strictEqual(v2.db.settings.accent, 'purple');
  assert.strictEqual(v2.db.settings.density, 'compact');
  assert.strictEqual(v2.db.settings.zoom, 1.15);
  assert.strictEqual(v2.db.appVersion, '1.1.0', 'the new version is recorded');
  ok('data, details and settings survive an app update');

  const snapshots = fs
    .readdirSync(path.join(dir2, 'backups'))
    .filter((f) => f.includes('before-1.0.0'));
  assert.strictEqual(snapshots.length, 1, 'a pre-update snapshot is taken');
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir2, 'backups', snapshots[0]), 'utf8'));
  assert.strictEqual(snapshot.items.length, 1, 'the snapshot holds the pre-update data');
  ok('an untouched copy is kept before the new version writes');

  // Re-opening with the same version must not pile up more snapshots.
  new Store(dir2, '1.1.0').init();
  const again = fs.readdirSync(path.join(dir2, 'backups')).filter((f) => f.includes('before-'));
  assert.strictEqual(again.length, 1, 'no snapshot on an ordinary restart');
  ok('ordinary restarts do not create update snapshots');

  // Rolling backups must never rotate an update snapshot away.
  const store2 = new Store(dir2, '1.1.0');
  store2.init();
  for (let i = 0; i < 14; i += 1) {
    store2.lastBackupAt = 0;
    fs.copyFileSync(
      store2.file,
      path.join(store2.backupDir, `myvault-auto-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00.json`),
    );
  }
  store2.lastBackupAt = 0;
  store2.maybeBackup();
  const kept = fs.readdirSync(store2.backupDir);
  assert.ok(kept.some((f) => f.includes('before-1.0.0')), 'the update snapshot is still there');
  assert.ok(
    kept.filter((f) => f.startsWith('myvault-auto-')).length <= 10,
    'routine backups still rotate',
  );
  ok('update snapshots are never rotated away by routine backups');

  fs.rmSync(dir2, { recursive: true, force: true });
}

// -------------------------------------------------------- appearance limits
{
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-style-'));
  const styled = new Store(dir3, '1.0.0');
  styled.init();

  assert.strictEqual(styled.updateSettings({ accent: 'not-a-colour' }).accent, 'blue');
  assert.strictEqual(styled.updateSettings({ density: 'huge' }).density, 'comfortable');
  assert.strictEqual(styled.updateSettings({ theme: 'neon' }).theme, 'system');
  assert.strictEqual(styled.updateSettings({ zoom: 99 }).zoom, 1.4, 'zoom is clamped at the top');
  assert.strictEqual(styled.updateSettings({ zoom: 0.1 }).zoom, 0.8, 'zoom is clamped at the bottom');
  assert.strictEqual(styled.updateSettings({ accent: 'green' }).accent, 'green');
  ok('styling settings fall back to something renderable');

  fs.rmSync(dir3, { recursive: true, force: true });
}

// ------------------------------------------------------------------ backups
store.lastBackupAt = 0;
store.maybeBackup();
const backups = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('myvault-'));
assert.ok(backups.length >= 1, 'writes a dated backup');
ok('automatic backups are written');

// ------------------------------------------------------------------ clients
{
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-clients-'));
  const shop = new Store(dir4, '1.5.0');
  shop.init();

  assert.deepStrictEqual(shop.getState().clients, [], 'a new shop knows nobody yet');

  const maria = shop.addClient({ name: '  Maria Papadopoulou  ', phone: '210 555 0100' });
  assert.strictEqual(maria.name, 'Maria Papadopoulou', 'the name is tidied');
  assert.ok(maria.id && maria.createdAt);
  assert.strictEqual(maria.email, '', 'nothing but a name is required');

  assert.throws(() => shop.addClient({ name: '   ' }), /name/i, 'a customer with no name is refused');

  const edited = shop.updateClient(maria.id, { email: 'maria@example.com' });
  assert.strictEqual(edited.email, 'maria@example.com');
  assert.strictEqual(edited.phone, '210 555 0100', 'the rest of the contact is untouched');
  assert.strictEqual(edited.createdAt, maria.createdAt, 'they have been a customer since they became one');
  assert.throws(() => shop.updateClient('nobody', { name: 'X' }), /no longer/);

  // The whole point of the list: it is still there tomorrow.
  const reopened = new Store(dir4, '1.5.0');
  reopened.init();
  assert.strictEqual(reopened.getState().clients.length, 1);
  assert.strictEqual(reopened.getState().clients[0].email, 'maria@example.com');

  reopened.deleteClient(maria.id);
  assert.deepStrictEqual(reopened.getState().clients, []);
  ok('customers are saved, corrected and remembered across a restart');

  fs.rmSync(dir4, { recursive: true, force: true });
}

// ---------------------------------------------------- the history it writes
{
  const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-history-'));
  const shop = new Store(dir5, '1.5.0');
  shop.init();

  const client = shop.addClient({ name: 'Yiannis' });
  const coffee = shop.addItem({ name: 'Coffee', quantity: 10, price: 3, cost: 1 });

  // Adding stock is stock arriving — the takings would not add up otherwise.
  let history = shop.movements.list();
  assert.strictEqual(history.length, 1, 'the opening count was recorded');
  assert.strictEqual(history[0].reason, 'new');
  assert.strictEqual(history[0].delta, 10);

  shop.adjustStock(coffee.id, -2, { reason: 'sale', clientId: client.id, by: 'Maria' });
  history = shop.movements.list();
  assert.strictEqual(history[0].reason, 'sale');
  assert.strictEqual(history[0].delta, -2);
  assert.strictEqual(history[0].after, 8, 'and what was left after it');
  assert.strictEqual(history[0].clientId, client.id);
  assert.strictEqual(history[0].by, 'Maria', 'who served them');
  assert.strictEqual(history[0].price, 3, 'at the price it was that day');

  // Selling five when three are left leaves zero, and the history says three —
  // the shop cannot sell stock it never had.
  shop.adjustStock(coffee.id, -20);
  const floored = shop.movements.list()[0];
  assert.strictEqual(shop.getState().items[0].quantity, 0);
  assert.strictEqual(floored.delta, -8, 'the movement is what actually left the shelf');
  assert.strictEqual(floored.reason, 'sale', 'a fall with no reason given is a sale');

  shop.adjustStock(coffee.id, 12);
  assert.strictEqual(shop.movements.list()[0].reason, 'delivery', 'a rise is a delivery');

  // Typing a new count into the edit box moves stock just as surely as the
  // minus button does, and the history has to say so.
  shop.updateItem(coffee.id, { quantity: 30 });
  const corrected = shop.movements.list()[0];
  assert.strictEqual(corrected.reason, 'correction');
  assert.strictEqual(corrected.delta, 18);
  assert.strictEqual(corrected.after, 30);
  // Editing the name alone is not a stock movement.
  const beforeRename = shop.movements.list().length;
  shop.updateItem(coffee.id, { name: 'Coffee beans' });
  assert.strictEqual(shop.movements.list().length, beforeRename, 'a rename moves no stock');
  shop.updateItem(coffee.id, { name: 'Coffee', quantity: 12 });

  // Adjusting by nothing is not an event.
  const countBefore = shop.movements.list().length;
  shop.adjustStock(coffee.id, 0);
  assert.strictEqual(shop.movements.list().length, countBefore, 'no movement, no entry');

  // Deleting a product takes its stock off the shelf too.
  shop.deleteItems([coffee.id]);
  const deleted = shop.movements.list()[0];
  assert.strictEqual(deleted.reason, 'delete');
  assert.strictEqual(deleted.delta, -12);
  assert.strictEqual(deleted.itemName, 'Coffee', 'a deleted product is still named in the history');

  // And the history lives beside the data, not inside it — this is the whole
  // reason a shop's tenth year is as quick as its first.
  const saved = JSON.parse(fs.readFileSync(path.join(dir5, 'myvault.json'), 'utf8'));
  assert.ok(!('movements' in saved), 'the inventory file carries no history');
  assert.ok(
    fs.existsSync(path.join(dir5, 'history', `movements-${new Date().getUTCFullYear()}.ndjson`)),
    'the history is its own file, appended to',
  );
  ok('every stock movement is recorded, in its own file rather than the inventory');

  fs.rmSync(dir5, { recursive: true, force: true });
}

// ------------------------------------------------------- a shop that grows
//
// Every sale rewrites this file, so its size is the price of a sale. A small
// shop gets a file it could open and read; a big one gets speed instead. Both
// have to come back exactly as they went in.
{
  const readable = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-small-'));
  const small = new Store(readable, '1.5.0');
  small.init();
  small.addItem({ name: 'Coffee', quantity: 5, price: 3 });
  assert.match(
    fs.readFileSync(path.join(readable, 'myvault.json'), 'utf8'),
    /\n {2}"items": \[/,
    'a small shop can open its data file and read it',
  );

  const big = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-big-'));
  const shop = new Store(big, '1.5.0');
  shop.init();
  for (let i = 0; i < 2100; i += 1) {
    shop.db.items.push(shop.normalizeItem({
      name: `Item ${i}`, quantity: 10, price: 3, cost: 1, barcode: String(1000000000000 + i),
    }));
  }
  shop.persist({ backup: false });
  const file = path.join(big, 'myvault.json');
  assert.ok(
    !fs.readFileSync(file, 'utf8').includes('\n  "items"'),
    'past a few thousand products the indenting goes, and with it half the bytes',
  );

  // Speed is worth nothing if the shop cannot get its stock back.
  const sold = shop.db.items[2099].id;
  shop.adjustStock(sold, -4, { reason: 'sale' });
  const reopened = new Store(big, '1.5.0');
  reopened.init();
  assert.strictEqual(reopened.getState().items.length, 2100);
  assert.strictEqual(
    reopened.getState().items.find((i) => i.id === sold).quantity,
    6,
    'the sale is still there after a restart',
  );
  ok('a big shop trades a readable file for a faster one, and loses nothing');

  fs.rmSync(readable, { recursive: true, force: true });
  fs.rmSync(big, { recursive: true, force: true });
}

// -------------------------------------------------------------- atomic save
const raw = fs.readFileSync(path.join(dir, 'myvault.json'), 'utf8');
JSON.parse(raw);
assert.ok(!fs.existsSync(path.join(dir, 'myvault.json.tmp')), 'no temp file left behind');
ok('saves are atomic and leave valid JSON');

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(brokenDir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
