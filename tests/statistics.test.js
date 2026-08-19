/**
 * The statistics screen's arithmetic.
 *
 * A shop will believe these numbers, plan around them, and order stock from
 * them, so each one is checked against a worked example rather than against
 * whatever the code happens to produce.
 *
 * The last section checks the property the whole design rests on: what crosses
 * to the window is a fixed handful of numbers, whether the shop has a week of
 * history or a decade of it.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MovementLog } = require('../electron/movements');
const { report, stockSnapshot, clientHistory, MAX_LIST } = require('../electron/statistics');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-stats-'));
const freshLog = (name) => new MovementLog(fs.mkdtempSync(path.join(scratch, `${name}-`)));

const item = (over = {}) => ({
  id: 'i1', name: 'Item', barcode: '', sku: '', categoryId: '',
  quantity: 0, price: 0, cost: 0, lowStockThreshold: null,
  supplier: '', notes: '', custom: {}, createdAt: '', updatedAt: '',
  ...over,
});

const database = (over = {}) => ({
  settings: { defaultLowStockThreshold: 5 },
  categories: [
    { id: 'cat-drinks', name: 'Drinks', color: '#111' },
    { id: 'cat-food', name: 'Food', color: '#222' },
  ],
  clients: [],
  items: [],
  ...over,
});

// ------------------------------------------------------- what is on the shelves
{
  const db = database({
    items: [
      item({ id: 'a', name: 'Coffee', categoryId: 'cat-drinks', quantity: 10, price: 3, cost: 1 }),
      item({ id: 'b', name: 'Tea', categoryId: 'cat-drinks', quantity: 4, price: 2.5, cost: 1 }),
      item({ id: 'c', name: 'Bread', categoryId: 'cat-food', quantity: 0, price: 2, cost: 0.8 }),
    ],
  });
  const stock = stockSnapshot(db);

  assert.strictEqual(stock.items, 3);
  assert.strictEqual(stock.units, 14);
  // 10×3 + 4×2.50 + 0 = 40
  assert.strictEqual(stock.retailValue, 40);
  // 10×1 + 4×1 + 0 = 14
  assert.strictEqual(stock.costValue, 14);
  assert.strictEqual(stock.potentialProfit, 26);
  ok('the shelves are valued at both what they cost and what they would fetch');

  // Tea is on 4 against the shop's default limit of 5; bread is out.
  assert.strictEqual(stock.out, 1, 'bread is out of stock');
  assert.strictEqual(stock.low, 1, 'tea is under the default limit');
  assert.strictEqual(stock.healthy, 1, 'only coffee is comfortable');
  assert.strictEqual(stock.items, stock.low + stock.out + stock.healthy, 'every item is counted once');
  ok('low and out-of-stock are counted by the same rule the stock list colours by');
}

// A per-item limit overrides the shop default — the same rule the table uses.
{
  const db = database({
    items: [
      item({ id: 'a', name: 'Napkins', quantity: 40, price: 1, lowStockThreshold: 50 }),
      item({ id: 'b', name: 'Whisky', quantity: 2, price: 30, lowStockThreshold: 1 }),
      item({ id: 'c', name: 'Sugar', quantity: 3, price: 1, lowStockThreshold: 0 }),
    ],
  });
  const stock = stockSnapshot(db);
  assert.strictEqual(stock.low, 1, 'only the napkins are under their own limit');
  assert.strictEqual(stock.healthy, 2, 'a limit of 0 means never warn, even on 3 left');
  ok("an item's own low-stock limit beats the shop default");
}

{
  const db = database({
    items: [
      item({ id: 'a', categoryId: 'cat-drinks', quantity: 10, price: 3 }),
      item({ id: 'b', categoryId: 'cat-food', quantity: 2, price: 50 }),
      item({ id: 'c', categoryId: '', name: 'Uncategorised', quantity: 1, price: 1 }),
    ],
  });
  const stock = stockSnapshot(db);
  assert.strictEqual(stock.categories[0].name, 'Food', 'the most valuable category leads');
  assert.strictEqual(stock.categories[0].value, 100);
  assert.strictEqual(stock.categories[1].value, 30);
  assert.strictEqual(stock.categories[2].name, '', 'items with no category are still counted');
  ok('value is broken down by category, richest first');
}

{
  const db = database({
    items: Array.from({ length: 30 }, (_, i) =>
      item({ id: `i${i}`, name: `Item ${i}`, quantity: 1, price: i })),
  });
  const stock = stockSnapshot(db);
  assert.strictEqual(stock.mostValuable.length, MAX_LIST, 'the list is capped, not endless');
  assert.strictEqual(stock.mostValuable[0].name, 'Item 29');
  ok('the biggest holdings are listed, and the list has a ceiling');
}

// ------------------------------------------------------------- what happened
{
  const log = freshLog('sales');
  const db = database({
    clients: [{ id: 'c1', name: 'Maria' }],
    items: [item({ id: 'a', name: 'Coffee', quantity: 6, price: 3, cost: 1 })],
  });

  const day = (n) => new Date(`2025-06-${String(n).padStart(2, '0')}T12:00:00Z`);
  log.record({ itemId: 'a', itemName: 'Coffee', delta: -2, quantityAfter: 8, reason: 'sale', price: 3, cost: 1 }, day(10));
  log.record({ itemId: 'a', itemName: 'Coffee', delta: -1, quantityAfter: 7, reason: 'sale', price: 3, cost: 1, clientId: 'c1' }, day(11));
  log.record({ itemId: 'a', itemName: 'Coffee', delta: 12, quantityAfter: 19, reason: 'delivery', price: 3, cost: 1 }, day(12));
  log.record({ itemId: 'a', itemName: 'Coffee', delta: -1, quantityAfter: 18, reason: 'correction', price: 3, cost: 1 }, day(13));

  const result = report(db, log, { from: day(1).toISOString(), to: day(30).toISOString() });

  assert.strictEqual(result.sales.units, 3, 'three sold');
  assert.strictEqual(result.sales.takings, 9, 'at €3 each');
  assert.strictEqual(result.sales.costOfSales, 3);
  assert.strictEqual(result.sales.profit, 6);
  assert.strictEqual(result.sales.received, 12, 'the delivery came in');
  assert.strictEqual(result.sales.spend, 12);
  assert.strictEqual(result.sales.writtenOff, 1, 'the correction is not a sale and not a delivery');
  ok('sales, deliveries and write-offs are told apart');
}

// The point of copying the price into the movement: marking a product up must
// not rewrite what the shop took for it last month.
{
  const log = freshLog('history-price');
  log.record(
    { itemId: 'a', itemName: 'Coffee', delta: -10, quantityAfter: 0, reason: 'sale', price: 2, cost: 1 },
    new Date('2025-01-15T10:00:00Z'),
  );
  // The shop puts the price up to €5 today.
  const db = database({ items: [item({ id: 'a', name: 'Coffee', quantity: 0, price: 5, cost: 1 })] });
  const result = report(db, log, { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' });
  assert.strictEqual(result.sales.takings, 20, 'January took €20, not the €50 it would take now');
  ok('putting a price up does not change what last month earned');
}

{
  const log = freshLog('compare');
  const sale = (date, units) => log.record(
    { itemId: 'a', itemName: 'Coffee', delta: -units, quantityAfter: 0, reason: 'sale', price: 10, cost: 4 },
    new Date(date),
  );
  // Ten units the week before, twenty in the week being looked at.
  sale('2025-06-03T10:00:00Z', 10);
  sale('2025-06-11T10:00:00Z', 20);

  const db = database({ items: [] });
  const result = report(db, log, {
    from: '2025-06-09T00:00:00Z',
    to: '2025-06-15T23:59:59Z',
  });
  assert.strictEqual(result.sales.units, 20);
  assert.strictEqual(result.sales.takings, 200);
  assert.strictEqual(result.previous.units, 10, 'the week before is measured over the same length of time');
  assert.strictEqual(result.previous.takings, 100);
  ok('this week is compared against a week, not against everything before it');
}

// ------------------------------------------------------------------ the chart
{
  const log = freshLog('grouping');
  for (let day = 1; day <= 20; day += 1) {
    log.record(
      { itemId: 'a', itemName: 'Coffee', delta: -1, quantityAfter: 0, reason: 'sale', price: 1 },
      new Date(Date.UTC(2025, 5, day, 12)),
    );
  }
  const db = database({ items: [] });

  const short = report(db, log, { from: '2025-06-01T00:00:00Z', to: '2025-06-30T23:59:59Z' });
  assert.strictEqual(short.range.grouping, 'day');
  assert.strictEqual(short.timeline.length, 20, 'a bar per day that had a movement');
  assert.ok(short.timeline[0].key < short.timeline[19].key, 'oldest first, ready to draw');

  const long = report(db, log, { from: '2023-01-01T00:00:00Z', to: '2025-12-31T23:59:59Z' });
  assert.strictEqual(long.range.grouping, 'month', 'three years is not a bar per day');
  assert.strictEqual(long.timeline.length, 1, 'all twenty fall in the one month');
  assert.strictEqual(long.timeline[0].sold, 20);
  ok('a few weeks are charted by day, a few years by month');
}

// ------------------------------------------------ best sellers and dead stock
{
  const log = freshLog('sellers');
  const db = database({
    items: [
      item({ id: 'a', name: 'Coffee', quantity: 5, price: 3 }),
      item({ id: 'b', name: 'Tea', quantity: 5, price: 2 }),
      item({ id: 'dusty', name: 'Novelty mug', quantity: 12, price: 9 }),
      item({ id: 'empty', name: 'Sold out thing', quantity: 0, price: 100 }),
    ],
  });
  const at = new Date('2025-06-10T10:00:00Z');
  log.record({ itemId: 'a', itemName: 'Coffee', delta: -9, quantityAfter: 5, reason: 'sale', price: 3 }, at);
  log.record({ itemId: 'b', itemName: 'Tea', delta: -4, quantityAfter: 5, reason: 'sale', price: 2 }, at);

  const result = report(db, log, { from: '2025-06-01T00:00:00Z', to: '2025-06-30T23:59:59Z' });

  assert.deepStrictEqual(result.bestSellers.map((s) => s.name), ['Coffee', 'Tea']);
  assert.strictEqual(result.bestSellers[0].units, 9);
  assert.strictEqual(result.bestSellers[0].takings, 27);

  assert.deepStrictEqual(
    result.notMoving.map((s) => s.name),
    ['Novelty mug'],
    'the mug is money sitting still; the sold-out thing is not on a shelf at all',
  );
  assert.strictEqual(result.notMoving[0].value, 108);
  ok('best sellers and stock nobody is buying are both named');
}

// A product renamed since it sold appears under the name the shop uses now.
{
  const log = freshLog('renamed');
  log.record({ itemId: 'a', itemName: 'Old name', delta: -1, quantityAfter: 0, reason: 'sale', price: 1 },
    new Date('2025-06-01T10:00:00Z'));
  log.record({ itemId: 'a', itemName: 'New name', delta: -1, quantityAfter: 0, reason: 'sale', price: 1 },
    new Date('2025-06-02T10:00:00Z'));
  const result = report(database(), log, { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' });
  assert.strictEqual(result.bestSellers.length, 1, 'it is one product, not two');
  assert.strictEqual(result.bestSellers[0].name, 'New name');
  ok('renaming a product does not split its sales in two');
}

// ------------------------------------------------------------------ customers
{
  const log = freshLog('clients');
  const db = database({
    clients: [{ id: 'c1', name: 'Maria' }, { id: 'c2', name: 'Yiannis' }],
    items: [],
  });
  const at = (d) => new Date(`2025-06-${d}T10:00:00Z`);
  log.record({ itemId: 'a', itemName: 'Coffee', delta: -5, quantityAfter: 0, reason: 'sale', price: 4, clientId: 'c1' }, at('10'));
  log.record({ itemId: 'b', itemName: 'Tea', delta: -1, quantityAfter: 0, reason: 'sale', price: 2, clientId: 'c2' }, at('11'));
  log.record({ itemId: 'c', itemName: 'Cake', delta: -2, quantityAfter: 0, reason: 'sale', price: 3, clientId: 'gone' }, at('12'));
  log.record({ itemId: 'd', itemName: 'Milk', delta: -1, quantityAfter: 0, reason: 'sale', price: 1 }, at('13'));

  const result = report(db, log, { from: at('01').toISOString(), to: at('30').toISOString() });

  assert.strictEqual(result.topClients.length, 2, 'a customer since deleted is not shown as a blank row');
  assert.strictEqual(result.topClients[0].name, 'Maria');
  assert.strictEqual(result.topClients[0].takings, 20);
  assert.strictEqual(result.topClients[0].units, 5);
  assert.strictEqual(result.topClients[1].name, 'Yiannis');
  // Takings count every sale; only the named ones are attributed.
  assert.strictEqual(result.sales.takings, 20 + 2 + 6 + 1);
  ok('sales are attributed to named customers without losing the anonymous ones');
}

{
  const log = freshLog('history');
  for (let i = 0; i < 150; i += 1) {
    log.record(
      { itemId: 'a', itemName: 'Coffee', delta: -1, quantityAfter: 0, reason: 'sale', price: 2, clientId: 'c1' },
      new Date(Date.UTC(2025, 0, 1, 0, i)),
    );
  }
  log.record({ itemId: 'b', itemName: 'Tea', delta: 5, quantityAfter: 5, reason: 'delivery', clientId: 'c1' },
    new Date(Date.UTC(2025, 0, 2)));

  const history = clientHistory(log, 'c1', { limit: 20 });
  assert.strictEqual(history.lines.length, 20, 'only the recent lines are sent to the screen');
  assert.strictEqual(history.units, 150, 'but the totals cover everything they ever bought');
  assert.strictEqual(history.spent, 300);
  assert.ok(history.firstAt < history.lastAt);
  assert.ok(history.lines.every((line) => line.reason === 'sale'), 'a delivery is not something they bought');
  ok('a customer\'s totals cover their whole history, the list only the recent part');
}

{
  const log = freshLog('nobody');
  const history = clientHistory(log, 'never-bought-anything');
  assert.deepStrictEqual(history.lines, []);
  assert.strictEqual(history.spent, 0);
  ok('a customer who has bought nothing reads as nothing, not as an error');
}

// -------------------------------------------------------------- does it scale
//
// The claim: what the window receives does not grow with the history behind it.
// If this ever stopped being true, the statistics screen would get slower every
// month a shop stayed open — which is exactly the failure this design exists to
// avoid.
{
  const log = freshLog('volume');
  const db = database({
    clients: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, name: `Customer ${i}` })),
    items: Array.from({ length: 800 }, (_, i) =>
      item({ id: `i${i}`, name: `Item ${i}`, quantity: i % 20, price: (i % 9) + 1, cost: 1 })),
  });

  const small = report(db, log, { from: '2025-01-01T00:00:00Z', to: '2025-12-31T23:59:59Z' });
  const smallBytes = JSON.stringify(small).length;

  const total = 40000;
  for (let i = 0; i < total; i += 1) {
    log.record({
      itemId: `i${i % 800}`,
      itemName: `Item ${i % 800}`,
      delta: -1,
      quantityAfter: 0,
      reason: 'sale',
      price: (i % 9) + 1,
      cost: 1,
      clientId: i % 3 === 0 ? `c${i % 50}` : '',
    }, new Date(Date.UTC(2025, 0, 1) + (i % 300) * 86400000));
  }

  const began = process.hrtime.bigint();
  const large = report(db, log, { from: '2025-01-01T00:00:00Z', to: '2025-12-31T23:59:59Z' });
  const ms = Number(process.hrtime.bigint() - began) / 1e6;
  const largeBytes = JSON.stringify(large).length;

  console.log(
    `      ${total.toLocaleString()} movements → ${(largeBytes / 1024).toFixed(1)} KB summary in ${ms.toFixed(0)}ms `
    + `(empty history was ${(smallBytes / 1024).toFixed(1)} KB)`,
  );

  assert.strictEqual(large.sales.units, total, 'every sale was counted');
  assert.ok(large.bestSellers.length <= MAX_LIST);
  assert.ok(large.topClients.length <= MAX_LIST);
  assert.ok(
    large.timeline.length <= 366,
    `the chart has ${large.timeline.length} points, not one per sale`,
  );
  // Forty thousand movements would be several megabytes as raw lines. The
  // summary is measured in kilobytes, and nearly all of that is the shop's own
  // product names rather than its history.
  assert.ok(
    largeBytes < smallBytes + 40 * 1024,
    `the summary grew by only ${((largeBytes - smallBytes) / 1024).toFixed(1)} KB`,
  );
  assert.ok(ms < 10000, `the whole year was summarised in ${ms.toFixed(0)}ms`);
  ok(`${total.toLocaleString()} movements summarise to ${(largeBytes / 1024).toFixed(1)} KB`);
}

fs.rmSync(scratch, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
