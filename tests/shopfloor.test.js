/**
 * The four jobs a shop actually does, beyond selling: taking something back,
 * counting the shelves, working out what to order, and keeping a copy of it all
 * somewhere the disk failing cannot reach.
 *
 * These are tested against worked examples rather than against whatever the
 * code happens to produce, because a shopkeeper will trust the numbers and
 * order stock from them.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { report, reorderList } = require('../electron/statistics');
const { buildDocument } = require('../electron/pdf');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const shops = [];
function freshShop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-floor-'));
  shops.push(dir);
  const shop = new Store(dir, '1.6.0');
  shop.init();
  return shop;
}

// ============================================================ taking it back
{
  const shop = freshShop();
  const coffee = shop.addItem({ name: 'Coffee', quantity: 10, price: 4, cost: 1.5 });
  const client = shop.addClient({ name: 'Maria' });

  shop.adjustStock(coffee.id, -3, { reason: 'sale', clientId: client.id });
  shop.adjustStock(coffee.id, 1, { reason: 'return', clientId: client.id });

  assert.strictEqual(shop.getState().items[0].quantity, 8, 'the returned one is back on the shelf');

  const entry = shop.movements.list()[0];
  assert.strictEqual(entry.reason, 'return');
  assert.strictEqual(entry.delta, 1, 'stock went up');
  assert.strictEqual(entry.clientId, client.id, 'and it is against the customer who brought it back');
  ok('a return puts the stock back and is recorded against the customer');

  const summary = report(shop.getState(), shop.movements, {});
  // Sold three at €4, gave one back: two sold, €8 taken.
  assert.strictEqual(summary.sales.units, 2, 'the takings count two sold, not three');
  assert.strictEqual(summary.sales.takings, 8);
  assert.strictEqual(summary.sales.returned, 1);
  assert.strictEqual(summary.sales.refunded, 4);
  // A refund is not a delivery. Counting it as one would tell the shop it had
  // bought in stock it never paid for. The ten received are the opening count
  // and nothing else — the returned one is absent from that figure.
  assert.strictEqual(summary.sales.received, 10, 'a return is not counted as stock arriving');
  ok('takings are net of refunds, and a refund is never mistaken for a delivery');

  // The customer's own history nets off too.
  const maria = summary.topClients.find((c) => c.id === client.id);
  assert.strictEqual(maria.units, 2);
  assert.strictEqual(maria.takings, 8);
  ok('a customer is credited with what they kept, not what they carried out');
}

// A product bought and given straight back has not sold at all, and must not
// appear as the shop's best seller.
{
  const shop = freshShop();
  const fad = shop.addItem({ name: 'Novelty mug', quantity: 20, price: 9 });
  const staple = shop.addItem({ name: 'Milk', quantity: 50, price: 1 });
  shop.adjustStock(fad.id, -8, { reason: 'sale' });
  shop.adjustStock(fad.id, 8, { reason: 'return' });
  shop.adjustStock(staple.id, -3, { reason: 'sale' });

  const summary = report(shop.getState(), shop.movements, {});
  assert.deepStrictEqual(
    summary.bestSellers.map((s) => s.name),
    ['Milk'],
    'eight sold and eight returned is not the shop\'s strongest line',
  );
  assert.strictEqual(summary.sales.units, 3);
  ok('a product returned as often as it sold does not top the best-seller list');
}

// ============================================================== counting up
{
  const shop = freshShop();
  const drinks = shop.addCategory({ name: 'Drinks' });
  const coffee = shop.addItem({ name: 'Coffee', quantity: 10, price: 4, categoryId: drinks.id });
  const tea = shop.addItem({ name: 'Tea', quantity: 6, price: 3, categoryId: drinks.id });
  const bread = shop.addItem({ name: 'Bread', quantity: 4, price: 2 });

  shop.startStockTake({ by: 'Maria' });
  assert.throws(() => shop.startStockTake({}), /already in progress/, 'only one count at a time');

  // Two short on the coffee, one over on the tea, bread not reached yet.
  shop.countStockTake(coffee.id, 8);
  shop.countStockTake(tea.id, 7);

  const progress = shop.stockTakeProgress();
  assert.strictEqual(progress.total, 3);
  assert.strictEqual(progress.counted, 2);
  assert.strictEqual(progress.remaining, 1);
  assert.strictEqual(progress.differing, 2);
  assert.strictEqual(progress.missingUnits, 2, 'two coffees are missing');
  assert.strictEqual(progress.extraUnits, 1, 'and there is one tea too many');
  assert.strictEqual(progress.shrinkage, 8, 'two coffees at €4');
  assert.strictEqual(progress.lines[0].name, 'Coffee', 'the biggest discrepancy leads');
  ok('a part-finished count reports what is short, what is over and what it is worth');

  // Nothing has been touched yet. This is the promise the screen makes.
  assert.strictEqual(shop.getState().items.find((i) => i.id === coffee.id).quantity, 10);
  ok('nothing on file changes until the count is applied');

  // The half-done count survives closing MyVault, which is the whole point of
  // saving it: a stock take spans hours and gets interrupted.
  const reopened = new Store(shop.dataDir, '1.6.0');
  reopened.init();
  assert.strictEqual(reopened.getState().stockTake.counts[coffee.id], 8);
  assert.strictEqual(reopened.stockTakeProgress().counted, 2);
  ok('a count half done is still there after MyVault is closed and reopened');

  const applied = reopened.applyStockTake({ by: 'Maria' });
  assert.strictEqual(applied.corrected, 2);
  assert.strictEqual(applied.missingUnits, 2);
  assert.strictEqual(applied.shrinkage, 8);

  const after = reopened.getState().items;
  assert.strictEqual(after.find((i) => i.id === coffee.id).quantity, 8);
  assert.strictEqual(after.find((i) => i.id === tea.id).quantity, 7);
  assert.strictEqual(after.find((i) => i.id === bread.id).quantity, 4, 'what was never counted is left alone');
  assert.strictEqual(reopened.getState().stockTake, null, 'and the count is finished');
  ok('applying corrects what was counted and leaves the rest exactly as it was');

  // The corrections are in the history, which is what makes a stock take worth
  // doing twice — next year you can see what went missing last year.
  const history = reopened.movements.list().filter((m) => m.reason === 'stocktake');
  assert.strictEqual(history.length, 2);
  assert.ok(history.every((m) => m.by === 'Maria'), 'and it says who counted');
  const coffeeLine = history.find((m) => m.itemName === 'Coffee');
  assert.strictEqual(coffeeLine.delta, -2);
  assert.strictEqual(coffeeLine.after, 8);
  ok('every correction is in the history, with who made it');
}

// Counting one category leaves the rest of the shop out of it entirely.
{
  const shop = freshShop();
  const drinks = shop.addCategory({ name: 'Drinks' });
  const coffee = shop.addItem({ name: 'Coffee', quantity: 10, price: 4, categoryId: drinks.id });
  shop.addItem({ name: 'Bread', quantity: 4, price: 2 });

  shop.startStockTake({ categoryId: drinks.id, by: 'Yiannis' });
  assert.strictEqual(shop.stockTakeProgress().total, 1, 'only the drinks are in scope');
  shop.countStockTake(coffee.id, 9);
  shop.applyStockTake({});
  assert.strictEqual(shop.getState().items.find((i) => i.name === 'Bread').quantity, 4);
  ok('counting one category does not touch the rest of the shop');
}

// Abandoning is free, and clearing one entry is not the same as counting zero.
{
  const shop = freshShop();
  const coffee = shop.addItem({ name: 'Coffee', quantity: 10, price: 4 });
  shop.startStockTake({});
  shop.countStockTake(coffee.id, 0);
  assert.strictEqual(shop.stockTakeProgress().counted, 1, 'a counted zero is a real count');
  assert.strictEqual(shop.stockTakeProgress().missingUnits, 10);

  shop.countStockTake(coffee.id, null);
  assert.strictEqual(shop.stockTakeProgress().counted, 0, 'clearing it un-counts it');

  shop.cancelStockTake();
  assert.strictEqual(shop.getState().stockTake, null);
  assert.strictEqual(shop.getState().items[0].quantity, 10, 'abandoning changed nothing');
  ok('a counted zero means zero; abandoning a count costs nothing');
}

// ============================================================ what to order
{
  const shop = freshShop();
  // Sells steadily, nearly out, from a named supplier.
  const coffee = shop.addItem({
    name: 'Coffee', quantity: 2, price: 4, cost: 2, lowStockThreshold: 5, supplier: 'Beans Ltd',
  });
  // Out of stock entirely — the urgent case. Added for the shop to contain it;
  // the reorder list is what reads it back, by name.
  shop.addItem({
    name: 'Tea', quantity: 0, price: 3, cost: 1, lowStockThreshold: 4, supplier: 'Beans Ltd',
  });
  // Plenty left: should not appear at all.
  shop.addItem({ name: 'Sugar', quantity: 80, price: 1, cost: 0.4, lowStockThreshold: 5 });
  // Low, but nobody knows who supplies it.
  shop.addItem({ name: 'Napkins', quantity: 1, price: 2, cost: 1, lowStockThreshold: 10 });

  const day = (n) => new Date(Date.now() - n * 86400000);
  // Twenty-eight days, comfortably inside the thirty-day window rather than
  // sitting on its edge, so the sum does not depend on which side of midnight
  // the test happens to run.
  for (let i = 1; i <= 28; i += 1) {
    // Two coffees a day: fifty-six of them.
    shop.movements.record({
      itemId: coffee.id, itemName: 'Coffee', delta: -2, quantityAfter: 2, reason: 'sale', price: 4, cost: 2,
    }, day(i));
  }

  const list = reorderList(shop.getState(), shop.movements, { days: 30, cover: 30 });

  assert.strictEqual(list.lines, 3, 'the well-stocked sugar is not on the list');
  assert.strictEqual(list.urgent, 1, 'only the tea is actually out');

  const beans = list.suppliers.find((s) => s.supplier === 'Beans Ltd');
  assert.ok(beans, 'orders are grouped by who they go to');
  assert.strictEqual(beans.items.length, 2);
  assert.strictEqual(beans.items[0].name, 'Tea', 'what is out of stock comes first');

  const coffeeLine = beans.items.find((i) => i.name === 'Coffee');
  assert.strictEqual(coffeeLine.sold, 56, 'fifty-six sold in the period');
  // Fifty-six over thirty days, carried forward another thirty, less the two
  // already on the shelf.
  assert.strictEqual(coffeeLine.suggested, 54, 'enough to cover another month');
  assert.strictEqual(coffeeLine.cost, 108, 'at €2 each');
  ok('the suggested quantity follows what actually sold, not a fixed rule');

  // Something low with no sales still gets ordered back up to its limit.
  const unknown = list.suppliers.find((s) => !s.supplier);
  assert.strictEqual(unknown.items[0].name, 'Napkins');
  assert.strictEqual(unknown.items[0].suggested, 19, 'twice the limit, less the one left');
  assert.strictEqual(list.suppliers[list.suppliers.length - 1].supplier, '', 'the unknown pile sits at the bottom');
  ok('a slow product still gets ordered back above its limit, and unnamed suppliers come last');

  // Returns come off the sales figures here too, or the shop over-orders.
  shop.movements.record({
    itemId: coffee.id, itemName: 'Coffee', delta: 10, quantityAfter: 12, reason: 'return', price: 4, cost: 2,
  }, day(2));
  const afterReturns = reorderList(shop.getState(), shop.movements, { days: 30, cover: 30 });
  const revised = afterReturns.suppliers
    .find((s) => s.supplier === 'Beans Ltd').items.find((i) => i.name === 'Coffee');
  assert.strictEqual(revised.sold, 46, 'ten of them came back');
  assert.ok(revised.suggested < coffeeLine.suggested, 'so fewer are suggested');
  ok('stock that was returned is not counted as demand');
}

// ============================================================= the documents
{
  const sheet = buildDocument('stocktake', {
    title: 'Stock take',
    shop: 'Katsigiannis & Co',
    when: '13/08/2026',
    blank: false,
    lines: [{ name: 'Coffee', barcode: '5201234567890', expected: '10', counted: '8', difference: -2, value: '€8.00' }],
    totals: { counted: '2', matching: '0', missingUnits: '2', extraUnits: '1', shrinkage: '€8.00' },
    labels: { product: 'Product', counted: 'Counted', expected: 'Should be', difference: 'Difference', value: 'Value' },
  });
  assert.ok(sheet.startsWith('<!doctype html>'), 'a whole page, ready to print');
  assert.ok(sheet.includes('Katsigiannis &amp; Co'), 'the shop name is escaped');
  assert.ok(sheet.includes('5201234567890'));
  ok('the stock take sheet renders as a printable page');

  // The renderer never sends markup, but product names come from CSV files and
  // barcode scans, so nothing that reaches the page is trusted.
  const nasty = buildDocument('inventory', {
    title: '<script>alert(1)</script>',
    lines: [{ name: '<img src=x onerror=alert(1)>', barcode: '"><b>', category: "O'Brien", quantity: 1, price: '€1', value: '€1' }],
    totals: {},
    labels: {},
  });
  assert.ok(!nasty.includes('<script>alert'), 'a script tag in the title is escaped');
  assert.ok(!nasty.includes('<img src=x'), 'and one in a product name is too');
  assert.ok(nasty.includes('&lt;script&gt;'), 'it is shown as text instead');
  assert.ok(nasty.includes('O&#39;Brien'), 'and an apostrophe survives as an apostrophe');
  ok('nothing reaching a printed page can escape into markup');

  assert.throws(() => buildDocument('anything-else', {}), /no printable document/);
  ok('an unknown document is refused rather than guessed at');

  const order = buildDocument('reorder', {
    title: 'Order list',
    suppliers: [{ supplier: 'Beans Ltd', units: '58', cost: '€116.00', items: [
      { name: 'Tea', barcode: '', quantity: '0', sold: '12', suggested: '8', urgent: true },
    ] }],
    totals: { lines: '3', urgent: '1', estimatedCost: '€150.00' },
    labels: { outNow: 'Out of stock', noSupplier: 'No supplier set' },
  });
  assert.ok(order.includes('Beans Ltd'));
  assert.ok(order.includes('Out of stock'), 'the urgent lines are marked on paper too');
  ok('the order sheet is grouped by supplier, ready to send');
}

// ========================================================== the second copy
{
  const shop = freshShop();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-stick-'));
  shops.push(elsewhere);

  shop.addItem({ name: 'Coffee', quantity: 5, price: 3 });
  assert.strictEqual(shop.mirrorBackup(), null, 'with no folder chosen, nothing is written anywhere');
  assert.strictEqual(shop.mirrorStatus().configured, false);

  shop.updateSettings({ backupFolder: elsewhere });
  const status = shop.mirrorBackup();
  assert.ok(status.path, 'a copy was made');
  assert.strictEqual(status.error, '');

  const copies = fs.readdirSync(elsewhere).filter((f) => f.startsWith('myvault-backup-'));
  assert.strictEqual(copies.length, 1);
  const copied = JSON.parse(fs.readFileSync(path.join(elsewhere, copies[0]), 'utf8'));
  assert.strictEqual(copied.items[0].name, 'Coffee', 'and it is a real, readable backup');
  ok('a second copy is written to the folder the shop chose');

  // The stick is unplugged. A shop must still be able to sell things.
  fs.rmSync(elsewhere, { recursive: true, force: true });
  shop.updateSettings({ backupFolder: path.join(elsewhere, 'gone', 'missing') });
  // Simulate a path that cannot be created by pointing at a file.
  const blocker = path.join(shop.dataDir, 'blocker');
  fs.writeFileSync(blocker, 'not a folder');
  shop.updateSettings({ backupFolder: path.join(blocker, 'inside') });

  const failed = shop.mirrorBackup();
  assert.ok(failed.error, 'the failure is recorded');
  assert.doesNotThrow(() => shop.addItem({ name: 'Tea', quantity: 1, price: 1 }));
  assert.strictEqual(shop.getState().items.length, 2, 'and the shop carries on selling');
  assert.ok(shop.mirrorStatus().error, 'the settings screen can say what went wrong');
  ok('an unplugged drive is reported, and never stops the shop working');

  // The whole point of the setting is a different disk, so being on the same
  // one is worth saying out loud rather than quietly accepting.
  shop.updateSettings({ backupFolder: shop.dataDir });
  assert.strictEqual(shop.mirrorStatus().sameDrive, true, 'the same drive is spotted');
  ok('choosing a folder on the same drive is flagged, not silently accepted');
}

for (const dir of shops) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
