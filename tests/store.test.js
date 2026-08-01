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

// ------------------------------------------------------------ delete + undo
const removed = store.deleteItems([shirt.id]);
assert.strictEqual(store.db.items.length, 0);
store.restoreItems(removed);
assert.strictEqual(store.db.items.length, 1, 'undo puts the item back');
store.restoreItems(removed);
assert.strictEqual(store.db.items.length, 1, 'restoring twice does not duplicate');
ok('delete and undo round-trip');

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

// ------------------------------------------------------------------ backups
store.lastBackupAt = 0;
store.maybeBackup();
const backups = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('myvault-'));
assert.ok(backups.length >= 1, 'writes a dated backup');
ok('automatic backups are written');

// -------------------------------------------------------------- atomic save
const raw = fs.readFileSync(path.join(dir, 'myvault.json'), 'utf8');
JSON.parse(raw);
assert.ok(!fs.existsSync(path.join(dir, 'myvault.json.tmp')), 'no temp file left behind');
ok('saves are atomic and leave valid JSON');

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(brokenDir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
