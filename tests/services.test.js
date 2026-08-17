/**
 * Things a shop does, and money taken off a line.
 *
 * Both of these come straight off the I-SPIRIT invoice in tests/real-invoice —
 * three of its six lines are «Προσφερόμενη υπηρεσία», a service offered rather
 * than a thing on a shelf. Billing one used to take stock off a shelf that was
 * never there, so the count went to zero, the product read as out of stock, and
 * the order list asked the shop to go and buy more of its own labour.
 *
 * The rule everything here follows: a service is money and VAT with no quantity.
 * Every screen that talks about stock leaves it out; every screen that talks
 * about money puts it in.
 *
 * The discount half follows one rule too, and it is the rule this repository has
 * already been fixed twice for breaking: whatever the invoice says a line comes
 * to, the VAT return built from its movements has to say the same. So the
 * discount is applied to the unit price, and the line total, the movement and
 * the return are all built from that one figure.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { unitAfterDiscount, lineAmount } = require('../electron/documents');
const { vatReport } = require('../electron/vat');
const { report, stockSnapshot, reorderList } = require('../electron/statistics');
const { priceReview } = require('../electron/pricing');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-service-'));
  dirs.push(dir);
  const store = new Store(dir, '1.10.0');
  store.init();
  store.updateSettings({
    vatEnabled: true, vatRate: 24, pricesIncludeVat: true, costsIncludeVat: false, ...settings,
  });
  return store;
}

function refused(fn, expected) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert.ok(message, 'expected this to be refused');
  assert.ok(message.includes(expected), `refusal did not mention "${expected}": ${message}`);
}

// ============================================== a service has nothing to count
{
  const store = shop();
  const labour = store.addItem({
    name: 'Τοποθέτηση', service: true, quantity: 40, price: 62.00, cost: 0,
  });

  assert.strictEqual(labour.service, true);
  assert.strictEqual(labour.quantity, 0, 'a quantity typed onto a service is not a quantity');
  assert.strictEqual(store.movements.list().length, 0, 'and it is not stock arriving');
  ok('a service ignores any opening count, because there is nothing to open with');

  refused(() => store.adjustStock(labour.id, -1, { reason: 'sale' }), 'is a service');
  assert.strictEqual(store.getState().items[0].quantity, 0);
  ok('the till refuses to count one up or down, and says why');
}

// ================================================ billing one moves only money
{
  const store = shop();
  const bottle = store.addItem({ name: 'Ούζο', quantity: 10, price: 12.40, cost: 6.00 });
  const fitting = store.addItem({ name: 'Τοποθέτηση', service: true, price: 62.00 });
  const client = store.addClient({ name: 'Ταβέρνα Ιλιάδα' });

  let draft = store.startDraft({ kind: 'out' });
  store.updateDraft(draft.id, { clientId: client.id, number: '0000000024' });
  draft = store.setDraftLine(draft.id, { itemId: bottle.id, quantity: 2 });
  draft = store.setDraftLine(draft.id, { itemId: fitting.id, quantity: 3 });

  //   2 × 12,40 = 24,80  ·  3 × 62,00 = 186,00  →  210,80 gross
  assert.strictEqual(draft.totals.gross, 210.80);
  assert.strictEqual(draft.totals.vat, 40.80, '24% inclusive of 210,80');

  const posted = store.postDraft(draft.id, {});
  assert.strictEqual(posted.moved, 2, 'both lines are recorded');
  assert.strictEqual(store.getState().items[0].quantity, 8, 'the bottles left the shelf');
  assert.strictEqual(store.getState().items[1].quantity, 0, 'the labour was never on one');
  ok('an invoice mixing a product and a service posts both and moves only the product');

  // The money is where it should be, on both screens.
  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.collected.gross, 210.80, 'the VAT return agrees with the invoice');
  assert.strictEqual(vat.collected.vat, 40.80);
  const month = report(store.getState(), store.movements, {});
  assert.strictEqual(month.sales.takings, 210.80);
  assert.strictEqual(month.topClients[0].takings, 210.80, 'and the customer is charged for both');
  ok('the takings and the VAT return count the service exactly like anything else');

  // The movement says so itself, so anything reading the log alone can tell.
  const service = store.movements.list().find((entry) => entry.itemName === 'Τοποθέτηση');
  assert.strictEqual(service.service, true);
  assert.strictEqual(service.delta, -3, 'three of them were done');
  assert.strictEqual(service.after, 0);
  const product = store.movements.list().find((entry) => entry.itemName === 'Ούζο');
  assert.strictEqual(product.service, undefined, 'and an ordinary line does not carry the flag');
  ok('the movement log says which lines were work rather than stock');
}

// ======================================== and nothing on a shelf ever counts it
{
  const store = shop();
  store.addItem({ name: 'Ούζο', quantity: 10, price: 12.40, cost: 6.00, lowStockThreshold: 4 });
  const fitting = store.addItem({
    name: 'Τοποθέτηση', service: true, price: 62.00, supplier: 'Κάβα', lowStockThreshold: 5,
  });

  const shelves = stockSnapshot(store.getState());
  assert.strictEqual(shelves.items, 1, 'one product, not two');
  assert.strictEqual(shelves.units, 10);
  assert.strictEqual(shelves.retailValue, 124.00, 'the labour is worth nothing on a shelf');
  assert.strictEqual(shelves.out, 0, 'and it is not "out of stock" at zero');
  assert.strictEqual(shelves.low, 0);
  ok('the stock value and the low-stock counts leave services out');

  const list = reorderList(store.getState(), store.movements, {});
  assert.strictEqual(list.lines, 0, 'a shop cannot order more of its own labour');
  ok('the order list never asks the shop to buy its own work in');

  store.startStockTake({});
  const progress = store.stockTakeProgress();
  assert.strictEqual(progress.total, 1, 'only the thing that is actually on a shelf');
  refused(() => store.countStockTake(fitting.id, 3), 'is a service');
  store.cancelStockTake();
  ok('a stock take neither lists a service nor accepts a count for one');

  // It is not "not moving" either — that list is about money sitting on a shelf.
  const month = report(store.getState(), store.movements, {});
  assert.strictEqual(month.notMoving.length, 1);
  assert.strictEqual(month.notMoving[0].name, 'Ούζο');
  ok('and it cannot appear as stock that is not selling');
}

// ============================================= a service bought in, not sold out
{
  // A subcontractor's invoice. Money goes out, the VAT on it is deductible, and
  // still nothing lands on a shelf.
  const store = shop({ costsIncludeVat: false });
  const fitting = store.addItem({ name: 'Υπεργολαβία', service: true, price: 62.00, cost: 0 });

  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId: fitting.id, quantity: 4, unitPrice: 30.00 });
  const posted = store.postDraft(draft.id, {});

  assert.strictEqual(posted.document.totals.net, 120.00);
  assert.strictEqual(posted.document.totals.vat, 28.80);
  assert.strictEqual(store.getState().items[0].quantity, 0, 'still nothing on a shelf');
  assert.strictEqual(store.getState().items[0].cost, 30.00, 'but it now knows what it costs');

  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.paid.vat, 28.80, 'and the VAT on it is deductible');
  ok('a service bought in is deductible and still moves no stock');
}

// ======================================== a discount, and where the money lands
{
  const store = shop();
  const item = store.addItem({ name: 'Ούζο', quantity: 100, price: 12.40, cost: 6.00 });

  let draft = store.startDraft({ kind: 'out' });
  draft = store.setDraftLine(draft.id, { itemId: item.id, quantity: 10, discount: 10 });

  const line = draft.lines[0];
  assert.strictEqual(line.unitPrice, 12.40, 'the list price stays on the line');
  assert.strictEqual(line.discount, 10);
  assert.strictEqual(unitAfterDiscount(line), 11.16, '12,40 less a tenth');
  assert.strictEqual(lineAmount(line), 111.60, '10 × 11,16');
  assert.strictEqual(draft.totals.gross, 111.60);
  assert.strictEqual(draft.totals.vat, 21.60, '24% inclusive of 111,60');
  assert.strictEqual(draft.totals.net, 90.00);
  ok('a discount comes off the unit price, and the totals follow it');

  const posted = store.postDraft(draft.id, {});
  const movement = store.movements.list()[0];
  assert.strictEqual(movement.price, 11.16, 'the movement stores what was really charged');
  assert.strictEqual(movement.delta, -10);

  // The check this whole design exists for.
  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(
    vat.collected.gross, posted.document.totals.gross,
    'the discounted invoice and the VAT return must be the same number',
  );
  assert.strictEqual(vat.collected.vat, posted.document.totals.vat);
  const month = report(store.getState(), store.movements, {});
  assert.strictEqual(month.sales.takings, 111.60, 'and the takings are the discounted money');
  ok('the discounted invoice, the movement and the VAT return are one figure seen three times');
}

// ============================= where the discount is applied, and why it matters
{
  // A quantity and a price that do not divide cleanly, which is the only case
  // where the two possible orderings disagree:
  //
  //   off the unit price   round(1,11 × 0,95) = 1,05  ×7 = 7,35   ← what MyVault does
  //   off the line total   round(7,77 × 0,95)         =    7,38
  //
  // The second is what a supplier's own paper prints, and it is three cents
  // dearer. MyVault takes the first, because a movement stores a price per unit
  // and the VAT return is built from units × price: any other ordering leaves
  // the invoice and the return disagreeing, which is the fault this repository
  // has already been fixed for twice. Three cents of difference against a
  // supplier's paper is the price of that, and the shop can always type the
  // discounted figure straight into the unit price instead.
  const store = shop();
  const item = store.addItem({ name: 'Βίδες', quantity: 100, price: 1.11, cost: 0.40 });

  const draft = store.startDraft({ kind: 'out' });
  const typed = store.setDraftLine(draft.id, { itemId: item.id, quantity: 7, discount: 5 });

  assert.strictEqual(unitAfterDiscount(typed.lines[0]), 1.05);
  assert.strictEqual(lineAmount(typed.lines[0]), 7.35);
  assert.strictEqual(typed.totals.gross, 7.35, 'not the 7,38 a line-total discount gives');

  const posted = store.postDraft(draft.id, {});
  const movement = store.movements.list()[0];
  assert.strictEqual(movement.price, 1.05, 'and the movement holds that same per-unit figure');
  assert.strictEqual(
    Math.round(movement.price * Math.abs(movement.delta) * 100) / 100,
    posted.document.totals.gross,
    'units × price is exactly the invoice total, which is the whole point',
  );

  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.collected.gross, 7.35, 'so the return cannot drift from the paper');
  assert.strictEqual(vat.collected.vat, posted.document.totals.vat);
  ok('the discount comes off the unit price so units × price is the invoice, to the cent');
}

// ================================== a discount is on one line, not the document
{
  const store = shop();
  const wine = store.addItem({ name: 'Κρασί', quantity: 100, price: 10.00, cost: 4.00 });
  const spirit = store.addItem({ name: 'Ούζο', quantity: 100, price: 20.00, cost: 8.00 });

  let draft = store.startDraft({ kind: 'out' });
  draft = store.setDraftLine(draft.id, { itemId: wine.id, quantity: 5, discount: 20 });
  draft = store.setDraftLine(draft.id, { itemId: spirit.id, quantity: 5 });

  //   5 × 8,00 = 40,00  ·  5 × 20,00 = 100,00
  assert.strictEqual(draft.totals.gross, 140.00);
  assert.strictEqual(draft.lines[0].discount, 20);
  assert.strictEqual(draft.lines[1].discount, 0, 'the next line is not discounted with it');
  store.postDraft(draft.id, {});
  assert.strictEqual(store.getState().items[0].quantity, 95, 'five discounted bottles went out');
  assert.strictEqual(store.getState().items[1].quantity, 95, 'and five at full price');
  ok('a discount applies to its own line and no other');

  // 100% off is a line given away, and it still belongs on the paper.
  let free = store.startDraft({ kind: 'out' });
  free = store.setDraftLine(free.id, { itemId: wine.id, quantity: 2, discount: 100 });
  assert.strictEqual(free.totals.gross, 0);
  assert.strictEqual(free.totals.vat, 0, 'no VAT on money nobody paid');
  assert.strictEqual(free.totals.units, 2, 'but the two bottles are still on it');
  const gift = store.postDraft(free.id, {});
  assert.strictEqual(gift.moved, 1);
  assert.strictEqual(store.getState().items[0].quantity, 93, '5 sold and 2 given away');
  ok('a line given away free posts its stock and charges nothing');
}

// ======================================= a discount cannot be a way to add money
{
  const store = shop();
  const item = store.addItem({ name: 'Ούζο', quantity: 100, price: 10.00, cost: 4.00 });

  const draft = store.startDraft({ kind: 'out' });
  const negative = store.setDraftLine(draft.id, { itemId: item.id, quantity: 1, discount: -50 });
  assert.strictEqual(negative.lines[0].discount, 0, 'a negative discount is not a surcharge');
  assert.strictEqual(negative.totals.gross, 10.00);

  const silly = store.setDraftLine(draft.id, {
    itemId: item.id, quantity: 1, discount: 500, lineId: 0,
  });
  assert.strictEqual(silly.lines[0].discount, 100, 'and 500% off is simply free');
  assert.strictEqual(silly.totals.gross, 0);
  ok('a discount is clamped to between nothing and everything');
}

// ========================================= voiding gives back the discounted money
{
  const store = shop();
  const item = store.addItem({ name: 'Ούζο', quantity: 0, price: 12.40, cost: 6.00 });

  const first = store.startDraft({ kind: 'in' });
  store.setDraftLine(first.id, { itemId: item.id, quantity: 10, unitPrice: 6.00 });
  store.postDraft(first.id, {});

  const deal = store.startDraft({ kind: 'in' });
  store.setDraftLine(deal.id, { itemId: item.id, quantity: 10, unitPrice: 6.00, discount: 25 });
  const posted = store.postDraft(deal.id, {});
  assert.strictEqual(posted.document.totals.net, 45.00, '10 × 4,50');
  assert.strictEqual(store.getState().items[0].cost, 4.50, 'the discounted price is what it cost');

  store.voidDocument(posted.document.id, {});
  assert.strictEqual(store.getState().items[0].cost, 6.00, 'and voiding puts the old cost back');
  assert.strictEqual(store.getState().items[0].quantity, 10);

  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.paid.net, 60.00, 'only the delivery that stands is deductible');
  ok('a discounted delivery sets the cost to what was paid, and a void undoes both');
}

// ============================================ a round trip through a spreadsheet
{
  const store = shop();
  const { parseCsv } = require('../electron/csv');
  const result = store.importRows(parseCsv(
    'Name,Quantity,Price,Service\r\nΤοποθέτηση,40,62,yes\r\nΟύζο,10,12.40,\r\n',
  ));

  assert.strictEqual(result.added, 2);
  const [labour, bottle] = store.getState().items;
  assert.strictEqual(labour.service, true, 'the column is read back');
  assert.strictEqual(labour.quantity, 0, 'and the 40 in the file is still not a quantity');
  assert.strictEqual(bottle.service, false, 'a blank means an ordinary product');
  assert.strictEqual(bottle.quantity, 10);
  ok('a service survives being exported to a spreadsheet and imported again');
}

// ========================================= a cancelled invoice stops being deducted
{
  // The one that costs a shop money at the tax office rather than on a shelf.
  // A delivery entered twice by accident, then voided: the stock came back, but
  // the VAT on it went on being deducted, because a void writes a correction and
  // the return only ever counted deliveries. The shop would have claimed the
  // same invoice's VAT twice.
  const store = shop();
  const item = store.addItem({ name: 'Ούζο', quantity: 0, price: 12.40, cost: 6.00 });

  const real = store.startDraft({ kind: 'in' });
  store.setDraftLine(real.id, { itemId: item.id, quantity: 10, unitPrice: 6.00 });
  store.postDraft(real.id, {});

  const twice = store.startDraft({ kind: 'in' });
  store.setDraftLine(twice.id, { itemId: item.id, quantity: 10, unitPrice: 6.00 });
  const duplicate = store.postDraft(twice.id, {});

  const before = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(before.paid.net, 120.00, 'both invoices were deducted');
  assert.strictEqual(before.paid.vat, 28.80);

  store.voidDocument(duplicate.document.id, {});

  const after = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(after.paid.net, 60.00, 'and the cancelled one is deducted no longer');
  assert.strictEqual(after.paid.vat, 14.40, '24% of the one delivery that stands');
  assert.strictEqual(store.getState().items[0].quantity, 10, 'the stock came back too');
  ok('voiding a supplier invoice takes its VAT deduction back with it');

  // An ordinary write-off is still a write-off: nothing about it names a
  // document, and it must not start reducing the shop's deductions.
  store.adjustStock(item.id, -2, { reason: 'correction' });
  const written = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(written.paid.vat, 14.40, 'a breakage changes no deduction');
  assert.strictEqual(written.excluded.movements, 1, 'and is still reported separately');
  ok('and an ordinary write-off is left exactly where it was');

  // The takings screen agrees: the goods went back, so they were never received.
  const month = report(store.getState(), store.movements, {});
  assert.strictEqual(month.sales.received, 10, 'ten arrived, ten stayed');
  assert.strictEqual(month.sales.spend, 60.00);
  assert.strictEqual(month.sales.writtenOff, 2, 'only the breakage is a write-off');
  ok('a cancelled delivery is undone on the takings screen rather than written off');
}

// ======================================= the real invoice, with what it really had
//
// I-SPIRIT no. 0000000024 again, but entered the way it is actually written:
// three service lines and three product lines. The printed totals are unchanged
// — 1.450,00 net, 348,00 VAT, 1.798,00 — because a service is taxed exactly like
// anything else. What changes is that the shop is left with three products on
// the shelf and no phantom stock behind the three services.
{
  const store = shop({ pricesIncludeVat: false });
  const INVOICE = [
    { name: 'Προσφερόμενη υπηρεσία Α', net: 200, service: true },
    { name: 'Προσφερόμενη υπηρεσία Β', net: 150, service: true },
    { name: 'Προσφερόμενη υπηρεσία Γ', net: 250, service: true },
    { name: 'Προσφερόμενο είδος Α', net: 150, service: false },
    { name: 'Προσφερόμενο είδος Β', net: 350, service: false },
    { name: 'Προσφερόμενο είδος Δ', net: 350, service: false },
  ];

  const items = INVOICE.map((entry) => store.addItem({
    name: entry.name, service: entry.service, quantity: entry.service ? 0 : 10, price: entry.net,
  }));

  let draft = store.startDraft({ kind: 'out' });
  store.updateDraft(draft.id, { number: '0000000024', date: '2017-06-20' });
  items.forEach((item, index) => {
    draft = store.setDraftLine(draft.id, {
      itemId: item.id, quantity: 1, unitPrice: INVOICE[index].net,
    });
  });

  assert.strictEqual(draft.totals.net, 1450, 'ΚΑΘΑΡΗ ΑΞΙΑ, unchanged');
  assert.strictEqual(draft.totals.vat, 348, 'ΣΥΝΟΛΟ Φ.Π.Α., unchanged');
  assert.strictEqual(draft.totals.gross, 1798, 'ΣΥΝΟΛΟ, unchanged');
  ok('the real invoice still totals what it printed once three lines are services');

  const posted = store.postDraft(draft.id, {});
  assert.strictEqual(posted.moved, 6, 'all six lines are recorded');

  const state = store.getState();
  assert.deepStrictEqual(
    state.items.map((item) => item.quantity), [0, 0, 0, 9, 9, 9],
    'one of each product left the shelf; the services never had one',
  );

  const shelves = stockSnapshot(state);
  assert.strictEqual(shelves.items, 3, 'the shop stocks three things, not six');
  assert.strictEqual(shelves.out, 0, 'and none of them is out of stock');
  ok('and the shop is left with three products rather than three phantom ones');

  const vat = vatReport(state, store.movements, {});
  assert.strictEqual(vat.collected.vat, 348, 'the return is the invoice, to the cent');
  assert.strictEqual(vat.collected.net, 1450);

  // Nothing about the services confuses the price screen either.
  const review = priceReview(state, store.movements, {});
  assert.strictEqual(review.counts.losing, 0);
  ok('the VAT return matches the paper and nothing is flagged that should not be');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
