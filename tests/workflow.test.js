/**
 * One month in one shop, from opening the shutters to filing the VAT.
 *
 * The other suites test parts. This one tests whether the parts tell the same
 * story. A small shop's year is a single arithmetic identity —
 *
 *   opening stock + deliveries − sales + returns ± corrections = what is there
 *
 * — and every screen in MyVault is a different view of that one sum. If the
 * takings screen, the VAT return, the reorder list and the stock take each
 * quietly disagree by a euro, every one of them looks plausible on its own and
 * the shop finds out at the accountant's in March.
 *
 * So nothing here is asserted against another part of MyVault. Every expected
 * figure below was worked out on paper first and is written down with its
 * arithmetic, so a failure means the code moved, not that two bugs agreed.
 *
 * The shop is a Greek kava with three lines and two VAT rates, because a single
 * rate hides the mistakes that matter:
 *
 *   Νερό 1,5L        0,62 shelf   0,25 cost   13%
 *   Ούζο 700ml      12,40 shelf   6,00 cost   24%
 *   Τσίπουρο 500ml   9,30 shelf   5,00 cost   24%
 *
 * Shelf prices include VAT — the retail default — and supplier costs do not,
 * which is how the paperwork actually arrives.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { report, stockSnapshot, reorderList, clientHistory } = require('../electron/statistics');
const { vatReport } = require('../electron/vat');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };
const cents = (value) => Math.round(value * 100) / 100;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-workflow-'));
const store = new Store(dir, '1.8.0');
store.init();
store.updateSettings({
  vatEnabled: true,
  vatRate: 24,
  pricesIncludeVat: true,
  costsIncludeVat: false,
});

// ============================================================ opening stock
//
// Three products with what was already on the shelf. An opening count is stock
// arriving, so each one writes a movement — otherwise the shelves would appear
// to have filled themselves and the month would not add up.
const water = store.addItem({
  name: 'Νερό 1,5L', quantity: 100, price: 0.62, cost: 0.25, vatRate: 13,
  supplier: 'Κάβα Πατέλ', lowStockThreshold: 40,
});
const ouzo = store.addItem({
  name: 'Ούζο 700ml', quantity: 10, price: 12.40, cost: 6.00,
  supplier: 'Κάβα Πατέλ', lowStockThreshold: 6,
});
const tsipouro = store.addItem({
  name: 'Τσίπουρο 500ml', quantity: 8, price: 9.30, cost: 5.00,
  supplier: 'Κάβα Πατέλ', lowStockThreshold: 12,
});

assert.strictEqual(store.movements.list().length, 3, 'three opening counts, three movements');
ok('opening stock is recorded as stock arriving, not as shelves that filled themselves');

// ====================================================== Monday: the delivery
//
// The supplier's invoice, typed once as one document rather than plus-pressed
// two hundred and eighteen times.
//
//   water     200 × 0,25 =  50,00 net + 13% =  6,50  →  56,50
//   ouzo       12 × 6,00 =  72,00 net + 24% = 17,28  →  89,28
//   tsipouro    6 × 5,00 =  30,00 net + 24% =  7,20  →  37,20
//                          152,00           30,98     182,98
let delivery = store.startDraft({ kind: 'in' });
store.updateDraft(delivery.id, { number: '4417', supplier: 'Κάβα Πατέλ' });
delivery = store.setDraftLine(delivery.id, { itemId: water.id, quantity: 200, unitPrice: 0.25 });
delivery = store.setDraftLine(delivery.id, { itemId: ouzo.id, quantity: 12, unitPrice: 6.00 });
delivery = store.setDraftLine(delivery.id, { itemId: tsipouro.id, quantity: 6, unitPrice: 5.00 });

assert.strictEqual(delivery.totals.units, 218);
assert.strictEqual(delivery.totals.net, 152.00, 'ΚΑΘΑΡΗ ΑΞΙΑ');
assert.strictEqual(delivery.totals.vat, 30.98, '6,50 + 17,28 + 7,20');
assert.strictEqual(delivery.totals.gross, 182.98);
ok('the delivery note totals what the supplier printed on it');

const postedDelivery = store.postDraft(delivery.id, { by: 'Aris' });
assert.strictEqual(postedDelivery.moved, 3);
assert.strictEqual(store.getState().items.find((i) => i.id === water.id).quantity, 300);
assert.strictEqual(store.getState().items.find((i) => i.id === ouzo.id).quantity, 22);
assert.strictEqual(store.getState().items.find((i) => i.id === tsipouro.id).quantity, 14);
ok('posting it once moves all three lines of stock');

// ==================================================== the week: over the counter
//
// Ordinary till presses, one per customer, nobody's name taken.
//
//   water  3 × 10 × 0,62 = 18,60 gross   VAT 13% inclusive: 3 × 0,71 = 2,13
//   ouzo        4 × 12,40 = 49,60 gross   VAT 24% inclusive:      9,60
//   tsipouro     3 × 9,30 = 27,90 gross   VAT 24% inclusive:      5,40
for (let press = 0; press < 3; press += 1) {
  store.adjustStock(water.id, -10, { reason: 'sale', by: 'Aris' });
}
store.adjustStock(ouzo.id, -4, { reason: 'sale', by: 'Aris' });
store.adjustStock(tsipouro.id, -3, { reason: 'sale', by: 'Aris' });

// ================================================== Friday: the taverna's order
//
// A wholesale order for a customer with a name, invoiced.
//
//   water  100 × 0,62 = 62,00 gross   VAT 13%:  7,13   net 54,87
//   ouzo     6 × 12,40 = 74,40 gross   VAT 24%: 14,40   net 60,00
//                       136,40                  21,53      114,87
const taverna = store.addClient({ name: 'Ταβέρνα Ιλιάδα', phone: '2101234567' });
let order = store.startDraft({ kind: 'out' });
store.updateDraft(order.id, { number: '0000000101', clientId: taverna.id });
order = store.setDraftLine(order.id, { itemId: water.id, quantity: 100 });
order = store.setDraftLine(order.id, { itemId: ouzo.id, quantity: 6 });

// The lines were not given a price, so they took the shelf price and each
// product's own rate — the point of copying both onto the line.
assert.strictEqual(order.lines[0].unitPrice, 0.62);
assert.strictEqual(order.lines[0].vatRate, 13, 'water keeps its own rate');
assert.strictEqual(order.lines[1].vatRate, 24, 'ouzo takes the shop rate');
assert.strictEqual(order.totals.net, 114.87);
assert.strictEqual(order.totals.vat, 21.53);
assert.strictEqual(order.totals.gross, 136.40);
ok('an outgoing invoice prices itself from the shelf and each product\'s own VAT rate');

store.postDraft(order.id, { by: 'Aris' });

// ================================================== Saturday: one comes back
//
// A corked bottle. Stock returns, 12,40 leaves the till, and 2,40 of VAT that
// was collected is un-collected.
store.adjustStock(ouzo.id, 1, { reason: 'return', clientId: taverna.id, by: 'Aris' });

// ======================================================== month end: the count
//
// Two bottles of water broken on the shelf and never noticed. The count says
// 168 against a file that says 170.
store.startStockTake({ by: 'Aris' });
store.countStockTake(water.id, 168);
const counted = store.stockTakeProgress();
assert.strictEqual(counted.lines[0].expected, 170, '100 + 200 − 30 − 100');
assert.strictEqual(counted.lines[0].difference, -2);
// Shrinkage is a loss, so it reads as a positive amount lost rather than a
// negative amount of money — 1,24 gone, not minus 1,24 earned.
assert.strictEqual(counted.shrinkage, 1.24, 'two bottles at 0,62 of lost takings');
const applied = store.applyStockTake({ by: 'Aris' });
assert.strictEqual(applied.corrected, 1);
assert.strictEqual(applied.missingUnits, 2);
ok('the stock take finds the two broken bottles and writes the correction down');

// ============================================== does the month reconcile at all
//
// Every movement ever written, added up per product, must equal what is on the
// shelf. This is the identity everything else is a view of, so it is checked
// directly and first.
{
  const balances = new Map();
  store.movements.forEach({}, (entry) => {
    balances.set(entry.itemId, (balances.get(entry.itemId) || 0) + entry.delta);
  });
  for (const item of store.getState().items) {
    assert.strictEqual(
      balances.get(item.id), item.quantity,
      `${item.name}: the log adds to ${balances.get(item.id)} but the shelf says ${item.quantity}`,
    );
  }
  assert.deepStrictEqual(
    store.getState().items.map((item) => item.quantity), [168, 13, 11],
    'water 100+200−30−100−2, ouzo 10+12−4−6+1, tsipouro 8+6−3',
  );
  ok('the movement log adds up to the stock on the shelf, product by product');
}

// ================================================== what the takings screen says
{
  const month = report(store.getState(), store.movements, {});

  // 30 + 100 water, 4 + 6 ouzo, 3 tsipouro = 143 sold, 1 handed back.
  assert.strictEqual(month.sales.units, 142);
  // 18,60 + 49,60 + 27,90 + 62,00 + 74,40 = 232,50, less the 12,40 refunded.
  assert.strictEqual(month.sales.takings, 220.10);
  assert.strictEqual(month.sales.returned, 1);
  assert.strictEqual(month.sales.refunded, 12.40);
  ok('the takings are net of the refund, in both money and units');

  // 130 water at 0,25 + 10 ouzo at 6,00 + 3 tsipouro at 5,00 = 107,50, less the
  // 6,00 that came back on the shelf when the bottle was returned.
  assert.strictEqual(month.sales.costOfSales, 101.50);
  assert.strictEqual(month.sales.profit, cents(220.10 - 101.50));
  assert.strictEqual(month.sales.profit, 118.60);
  ok('a returned bottle gives back its cost as well as its price');

  // 2,13 + 9,60 + 5,40 + 7,13 + 14,40 − 2,40
  assert.strictEqual(month.sales.vatCollected, 36.26);
  assert.strictEqual(month.sales.netTakings, cents(220.10 - 36.26));
  assert.strictEqual(month.sales.netTakings, 183.84);
  assert.strictEqual(month.sales.netProfit, cents(183.84 - 101.50));
  ok('and the shop\'s own share of the takings is what is left after the VAT');

  // 118 opening + 218 delivered.
  assert.strictEqual(month.sales.received, 336);
  // 25 + 60 + 40 opening, 50 + 72 + 30 delivered.
  assert.strictEqual(month.sales.spend, 277);
  assert.strictEqual(month.sales.writtenOff, 2, 'the two broken bottles');
  assert.strictEqual(month.sales.movements, 15);
  ok('everything that came in and everything written off is accounted for too');

  assert.strictEqual(month.bestSellers[0].name, 'Νερό 1,5L');
  assert.strictEqual(month.bestSellers[0].units, 130);
  assert.strictEqual(month.bestSellers[1].units, 9, 'ouzo: 10 sold, 1 back');
  assert.strictEqual(month.notMoving.length, 0, 'all three sold something');
  ok('the best sellers are net of returns, so a bottle sold and handed back sold nothing');
}

// ================================================ what the stock screen says
{
  const shelves = stockSnapshot(store.getState());
  assert.strictEqual(shelves.items, 3);
  assert.strictEqual(shelves.units, 192, '168 + 13 + 11');
  // 168 × 0,62 + 13 × 12,40 + 11 × 9,30
  assert.strictEqual(shelves.retailValue, 367.66);
  // 168 × 0,25 + 13 × 6,00 + 11 × 5,00
  assert.strictEqual(shelves.costValue, 175.00);
  assert.strictEqual(shelves.potentialProfit, cents(367.66 - 175.00));
  assert.strictEqual(shelves.low, 1, 'tsipouro, 11 against a limit of 12');
  assert.strictEqual(shelves.out, 0);
  assert.strictEqual(shelves.healthy, 2);
  ok('the stock value and the low-stock count match the shelves after the count');
}

// ================================================ what to order on Monday
{
  const list = reorderList(store.getState(), store.movements, { days: 30, cover: 30 });
  assert.strictEqual(list.lines, 1, 'only the tsipouro is under its limit');
  assert.strictEqual(list.urgent, 0, 'and none of it is actually out');
  const line = list.suppliers[0].items[0];
  assert.strictEqual(list.suppliers[0].supplier, 'Κάβα Πατέλ');
  assert.strictEqual(line.name, 'Τσίπουρο 500ml');
  assert.strictEqual(line.sold, 3, 'three in the month, and only the sales count');
  // Three a month will not get it back over a limit of 12, so the suggestion is
  // twice the limit less what is there: 24 − 11.
  assert.strictEqual(line.suggested, 13);
  assert.strictEqual(line.cost, 65.00, '13 × 5,00');
  assert.strictEqual(list.estimatedCost, 65.00);
  ok('the order list picks up the one line that is low and suggests a whole number');
}

// ============================================== what the customer's page says
{
  const history = clientHistory(store.movements, taverna.id, {});
  assert.strictEqual(history.orders, 2, 'two lines invoiced');
  assert.strictEqual(history.units, 105, '106 out, 1 back');
  assert.strictEqual(history.spent, 124.00, '136,40 less the 12,40 refunded');
  assert.strictEqual(history.returned, 1);
  assert.strictEqual(history.refunded, 12.40);
  assert.strictEqual(history.lines.length, 3, 'two sales and the refund');

  // The same customer, seen from the statistics screen. These are two different
  // passes over the same log and they must not disagree about one person.
  const month = report(store.getState(), store.movements, {});
  assert.strictEqual(month.topClients.length, 1);
  assert.strictEqual(month.topClients[0].name, 'Ταβέρνα Ιλιάδα');
  assert.strictEqual(month.topClients[0].takings, history.spent);
  assert.strictEqual(month.topClients[0].units, history.units);
  ok('the customer\'s own page and their row on the statistics screen agree');
}

// ==================================================== what the VAT return says
{
  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.enabled, true);

  // Collected, by rate, exactly as a return is laid out.
  //   13%: 18,60 + 62,00 = 80,60 gross,  2,13 + 7,13 =  9,26 VAT
  //   24%: 49,60 + 27,90 + 74,40 − 12,40 = 139,50,  27,00 VAT
  const byRate = new Map(vat.collected.rates.map((rate) => [rate.rate, rate]));
  assert.strictEqual(byRate.get(13).gross, 80.60);
  assert.strictEqual(byRate.get(13).vat, 9.26);
  assert.strictEqual(byRate.get(24).gross, 139.50);
  assert.strictEqual(byRate.get(24).vat, 27.00);
  assert.strictEqual(vat.collected.vat, 36.26);
  assert.strictEqual(vat.collected.net, 183.84);
  assert.strictEqual(vat.collected.gross, 220.10);
  ok('the VAT return is broken down by rate and adds to the same 36,26');

  // Paid, which is only ever the delivery — the opening count was not a purchase
  // and there is no invoice behind it to deduct against.
  assert.strictEqual(vat.paid.net, 152.00);
  assert.strictEqual(vat.paid.vat, 30.98);
  assert.strictEqual(vat.payable, cents(36.26 - 30.98));
  assert.strictEqual(vat.payable, 5.28);
  ok('what the shop owes is the VAT it charged less the VAT it paid: 5,28');

  // Nothing is silently dropped: the three opening counts and the stock-take
  // correction are named as left out rather than treated as zero-rated.
  assert.strictEqual(vat.excluded.movements, 4);
  assert.strictEqual(vat.excluded.units, 120, '100 + 10 + 8 opening, 2 broken');
  assert.strictEqual(vat.withoutRate, 0, 'every movement carried a rate');
  assert.strictEqual(vat.movements, 15, 'and all fifteen were read');
  ok('the opening stock and the breakage are excluded by name, not by omission');
}

// ==================================== the three screens against each other
{
  // The same money, arrived at three different ways. This is the check the whole
  // file exists for.
  const month = report(store.getState(), store.movements, {});
  const vat = vatReport(store.getState(), store.movements, {});

  assert.strictEqual(month.sales.takings, vat.collected.gross,
    'the takings screen and the VAT return disagree about what came in');
  assert.strictEqual(month.sales.vatCollected, vat.collected.vat,
    'and about how much of it was the tax office\'s');
  assert.strictEqual(month.sales.netTakings, vat.collected.net);
  assert.strictEqual(
    cents(month.sales.netTakings + month.sales.vatCollected), month.sales.takings,
    'net plus VAT must be the gross',
  );
  assert.strictEqual(
    cents(vat.collected.net + vat.collected.vat), vat.collected.gross,
  );
  ok('the takings screen and the VAT return are the same numbers seen twice');

  assert.strictEqual(month.sales.spend, 277);
  assert.strictEqual(cents(vat.paid.net + vat.paid.vat), vat.paid.gross);
  // The delivery invoice, still on file, against the VAT deducted from it.
  const filed = store.listDocuments().filter((document) => document.kind === 'in');
  assert.strictEqual(filed.length, 1);
  assert.strictEqual(filed[0].totals.vat, vat.paid.vat, 'the invoice and the deduction');
  assert.strictEqual(filed[0].totals.net, vat.paid.net);
  ok('the deduction claimed is the VAT written on the supplier\'s invoice');

  const out = store.listDocuments().filter((document) => document.kind === 'out');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totals.gross, 136.40);
  assert.ok(
    out[0].totals.gross < month.sales.takings,
    'the invoice is part of the takings, not all of them — the till is the rest',
  );
  ok('the filed invoices are a subset of the takings, and the till accounts for the rest');
}

// ============================================ and it survives being reopened
{
  const reopened = new Store(dir, '1.8.0');
  reopened.init();
  assert.deepStrictEqual(reopened.getState().items.map((item) => item.quantity), [168, 13, 11]);
  assert.strictEqual(reopened.getState().stockTake, null, 'the count was applied and closed');
  assert.strictEqual(reopened.getState().drafts.length, 0, 'both invoices were posted');
  assert.strictEqual(reopened.listDocuments().length, 2);
  assert.strictEqual(reopened.movements.list().length, 15);

  const vat = vatReport(reopened.getState(), reopened.movements, {});
  assert.strictEqual(vat.payable, 5.28, 'the return is the same after closing the program');
  ok('closing the shop and reopening it gives back the identical month');
}

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
