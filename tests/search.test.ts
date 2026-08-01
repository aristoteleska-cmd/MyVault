/**
 * Search, filter and sort tests for the stock list.
 */
import assert from 'assert';
import { filterAndSort, computeTotals, normalize } from '../src/lib/search';
import { stockLevel } from '../src/lib/format';
import type { Category, CustomField, Filters, Item, SortState } from '../src/types';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log('  ok  ' + label); };

const categories: Category[] = [
  { id: 'c1', name: 'Shirts', color: '#111' },
  { id: 'c2', name: 'Παπούτσια', color: '#222' },
];

const fields: CustomField[] = [
  { id: 'f1', name: 'Size', type: 'select', options: ['S', 'M', 'L'], required: false, showInTable: true, order: 0 },
  { id: 'f2', name: 'Age', type: 'text', options: [], required: false, showInTable: true, order: 1 },
];

const make = (over: Partial<Item>): Item => ({
  id: Math.random().toString(36).slice(2),
  name: 'Item', barcode: '', sku: '', categoryId: '', quantity: 10, price: 5, cost: 2,
  lowStockThreshold: null, supplier: '', notes: '', custom: {},
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const items: Item[] = [
  make({ id: 'a', name: 'Cotton T-shirt', barcode: '5201234567890', categoryId: 'c1', quantity: 12, price: 9.9, custom: { f1: 'M', f2: '10' } }),
  make({ id: 'b', name: 'Wool Jumper', barcode: '5209999999999', categoryId: 'c1', quantity: 2, price: 45, custom: { f1: 'L', f2: '2' } }),
  make({ id: 'c', name: 'Καφέ Παπούτσι', barcode: '5207777777777', categoryId: 'c2', quantity: 0, price: 60, custom: { f1: 'S', f2: '30' } }),
  make({ id: 'd', name: 'Sun hat', barcode: '', categoryId: '', quantity: 100, price: 7.5, supplier: 'Acme Ltd' }),
];

const base: Filters = { query: '', scope: 'all', categoryIds: [], stock: 'all', customValues: {} };
const sortByName: SortState = { key: 'name', direction: 'asc' };
const run = (filters: Partial<Filters>, sort: SortState = sortByName) =>
  filterAndSort({ items, categories, fields, filters: { ...base, ...filters }, sort, defaultThreshold: 5 });

// ------------------------------------------------------------------ search
assert.deepStrictEqual(run({ query: 'cotton' }).map((i) => i.id), ['a']);
ok('finds an item by part of its name');

// "shirt" also matches the jumper, because its category is "Shirts".
assert.deepStrictEqual(run({ query: 'shirt' }).map((i) => i.id).sort(), ['a', 'b']);
assert.deepStrictEqual(run({ query: 'shirt', scope: 'name' }).map((i) => i.id), ['a']);
ok('"everything" search spans category names, "name only" does not');

assert.deepStrictEqual(run({ query: '5209999999999' }).map((i) => i.id), ['b']);
ok('finds an item by full barcode');

assert.deepStrictEqual(run({ query: '5201234' }).map((i) => i.id), ['a']);
ok('finds an item by partial barcode');

assert.deepStrictEqual(run({ query: 'shirts' }).map((i) => i.id).sort(), ['a', 'b']);
ok('finds items by category name');

assert.deepStrictEqual(run({ query: 'παπουτσι' }).map((i) => i.id), ['c']);
ok('matches Greek text without accents');

assert.deepStrictEqual(run({ query: 'ΚΑΦΕ' }).map((i) => i.id), ['c']);
ok('search is case insensitive across alphabets');

assert.deepStrictEqual(run({ query: 'jumper wool' }).map((i) => i.id), ['b']);
ok('matches words typed in any order');

assert.deepStrictEqual(run({ query: 'acme' }).map((i) => i.id), ['d']);
ok('searches supplier in "everything" mode');

assert.deepStrictEqual(run({ query: 'acme', scope: 'name' }).map((i) => i.id), []);
ok('"name only" mode ignores other columns');

assert.deepStrictEqual(run({ query: 'shirts', scope: 'barcode' }).map((i) => i.id), []);
ok('"barcode only" mode ignores names and categories');

// Short queries match as substrings — 'm' hits "Cotton", "Jumper" and "Sun hat"'s
// supplier, but not the Greek item, which contains no latin m.
assert.deepStrictEqual(run({ query: 'm' }).map((i) => i.id).sort(), ['a', 'b', 'd']);
ok('short queries match as substrings');

// ----------------------------------------------------------------- filters
assert.deepStrictEqual(run({ categoryIds: ['c1'] }).map((i) => i.id).sort(), ['a', 'b']);
ok('filters by category');

assert.deepStrictEqual(run({ categoryIds: ['__none__'] }).map((i) => i.id), ['d']);
ok('filters uncategorised items');

assert.deepStrictEqual(run({ stock: 'out' }).map((i) => i.id), ['c']);
ok('filters out-of-stock items');

assert.deepStrictEqual(run({ stock: 'low' }).map((i) => i.id), ['b']);
ok('filters low-stock items using the default threshold');

assert.deepStrictEqual(run({ stock: 'in-stock' }).map((i) => i.id).sort(), ['a', 'b', 'd']);
ok('filters items that still have stock');

assert.deepStrictEqual(run({ customValues: { f1: 'L' } }).map((i) => i.id), ['b']);
ok('filters by a custom detail such as Size');

assert.deepStrictEqual(
  run({ categoryIds: ['c1'], stock: 'low', query: 'wool' }).map((i) => i.id),
  ['b'],
);
ok('combines search, category and stock filters');

// ----------------------------------------------------------------- sorting
assert.deepStrictEqual(
  run({}, { key: 'price', direction: 'desc' }).map((i) => i.id),
  ['c', 'b', 'a', 'd'],
);
ok('sorts by price, high to low');

assert.deepStrictEqual(
  run({}, { key: 'quantity', direction: 'asc' }).map((i) => i.id),
  ['c', 'b', 'a', 'd'],
);
ok('sorts by stock quantity');

assert.deepStrictEqual(
  run({}, { key: 'value', direction: 'desc' }).map((i) => i.id),
  ['d', 'a', 'b', 'c'],
);
ok('sorts by total stock value');

assert.deepStrictEqual(
  run({}, { key: 'custom:f2', direction: 'asc' }).map((i) => i.id),
  ['d', 'b', 'a', 'c'],
);
ok('sorts a text custom field numerically when it holds numbers');

assert.deepStrictEqual(
  run({}, { key: 'category', direction: 'asc' }).map((i) => i.id),
  ['d', 'a', 'b', 'c'],
);
ok('sorts by category name');

// ------------------------------------------------------------------ totals
const totals = computeTotals(items, 5);
assert.strictEqual(totals.skus, 4);
assert.strictEqual(totals.units, 114);
assert.strictEqual(Math.round(totals.retailValue * 100) / 100, 12 * 9.9 + 2 * 45 + 0 + 100 * 7.5);
assert.strictEqual(totals.lowStock, 1);
assert.strictEqual(totals.outOfStock, 1);
ok('summary totals add up');

// ------------------------------------------------------------ stock levels
assert.strictEqual(stockLevel(make({ quantity: 0 }), 5), 'out');
assert.strictEqual(stockLevel(make({ quantity: 5 }), 5), 'low');
assert.strictEqual(stockLevel(make({ quantity: 6 }), 5), 'ok');
assert.strictEqual(stockLevel(make({ quantity: 6, lowStockThreshold: 10 }), 5), 'low');
assert.strictEqual(stockLevel(make({ quantity: 3, lowStockThreshold: 0 }), 5), 'ok');
ok('per-item low-stock limits override the default');

assert.strictEqual(normalize('  ÉCLAIR  '), 'eclair');
ok('normalisation folds accents and trims');

console.log('\n' + passed + ' checks passed.');
