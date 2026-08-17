/**
 * The awkward days.
 *
 * Every other suite here checks that MyVault does the right thing when it is
 * asked politely. This one is the opposite: it does to the shop the things a
 * real shop does to itself. A product deleted while it is still sitting on a
 * half-typed invoice. An order for ten when there are three on the shelf. A
 * category thrown away in the middle of counting it. Someone typing a minus
 * sign into a price box.
 *
 * These are not hypothetical. Every check below started life as a probe that
 * failed, and four of them found real faults:
 *
 *   1. a posted invoice kept the money for a product that had been deleted, so
 *      the paper and the VAT return disagreed
 *   2. an outgoing invoice for more than the shelf held charged for all of it
 *      but only moved what was there — the same disagreement, bigger
 *   3. deleting a category threw away every figure already counted against it
 *   4. a negative unit price went onto a line and quietly reduced the total
 *
 * They are fixed. This file is what stops them coming back.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { vatReport } = require('../electron/vat');
const { report, reorderList } = require('../electron/statistics');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-edges-'));
  dirs.push(dir);
  const store = new Store(dir, '1.8.0');
  store.init();
  if (Object.keys(settings).length > 0) store.updateSettings(settings);
  return store;
}

/** Asserts that a call is refused, and that the refusal says something useful. */
function refused(fn, expected) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert.ok(message, 'expected this to be refused, but it went through');
  assert.ok(
    message.includes(expected),
    `refusal did not mention "${expected}": ${JSON.stringify(message)}`,
  );
  return message;
}

// ===================================== a product deleted under a live invoice
{
  const store = shop();
  const a = store.addItem({ name: 'Ouzo', quantity: 10, price: 5 });
  const b = store.addItem({ name: 'Raki', quantity: 10, price: 5 });

  let draft = store.startDraft({ kind: 'out' });
  store.setDraftLine(draft.id, { itemId: a.id, quantity: 2 });
  draft = store.setDraftLine(draft.id, { itemId: b.id, quantity: 2 });
  assert.strictEqual(draft.totals.gross, 20);

  store.deleteItems([a.id]);

  // Before the fix this posted: two lines of money, one line of stock.
  refused(() => store.postDraft(draft.id, {}), 'Ouzo is no longer in your stock list');
  ok('an invoice naming a deleted product is refused rather than posted half-done');

  // Nothing was touched on the way to being refused.
  assert.strictEqual(store.listDrafts().length, 1, 'the draft is still there to correct');
  assert.strictEqual(store.listDocuments().length, 0, 'and nothing was filed');
  assert.strictEqual(store.getState().items[0].quantity, 10, 'and no stock moved');
  ok('a refused post leaves the draft, the file and the stock exactly as they were');

  const fixed = store.removeDraftLine(draft.id, 0);
  assert.strictEqual(fixed.totals.gross, 10);
  const posted = store.postDraft(draft.id, {});
  assert.strictEqual(posted.moved, 1);
  assert.strictEqual(posted.document.totals.gross, 10, 'the paper matches what moved');
  ok('taking the dead line off makes it postable, and the total follows');
}

// ================================== an invoice for more than is on the shelf
{
  const store = shop({ vatEnabled: true, vatRate: 24, pricesIncludeVat: true });
  const item = store.addItem({ name: 'Ouzo', quantity: 3, price: 124 });

  const draft = store.startDraft({ kind: 'out' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 10 });

  // This was the worst of the four. The document charged for ten, the stock
  // stopped at zero after three, and the VAT return — which is built from the
  // movements, not the paper — declared 372 against an invoice for 1240.
  refused(() => store.postDraft(draft.id, {}), 'the invoice says 10, but you have 3');
  ok('selling more than the shop has is refused, and the message says by how much');

  const corrected = store.setDraftLine(draft.id, { itemId: item.id, quantity: 3, lineId: 0 });
  assert.strictEqual(corrected.totals.gross, 372);

  const posted = store.postDraft(draft.id, {});
  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(posted.document.totals.gross, 372);
  assert.strictEqual(
    vat.collected.gross, posted.document.totals.gross,
    'the invoice and the VAT return must be the same number',
  );
  assert.strictEqual(vat.collected.vat, 72);
  assert.strictEqual(store.getState().items[0].quantity, 0);
  ok('once corrected, the invoice total and the VAT return agree to the cent');
}

// ============================ an incoming invoice is never short of anything
{
  // Only outgoing documents can outrun the shelf. A delivery of a thousand
  // against a shelf of two is an ordinary Tuesday and must not be refused.
  const store = shop();
  const item = store.addItem({ name: 'Water', quantity: 2, price: 1, cost: 0.4 });
  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 1000, unitPrice: 0.4 });
  const posted = store.postDraft(draft.id, {});
  assert.strictEqual(posted.moved, 1);
  assert.strictEqual(store.getState().items[0].quantity, 1002);
  ok('a delivery larger than the shelf is not treated as a shortage');
}

// ================================================== a minus sign in a price
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5, cost: 2 });
  const draft = store.startDraft({ kind: 'in' });

  const typed = store.setDraftLine(draft.id, { itemId: item.id, quantity: -5, unitPrice: -5 });
  const line = typed.lines[0];
  assert.strictEqual(line.quantity, 5, 'a negative quantity is read as its size');
  assert.strictEqual(line.unitPrice, 0, 'and a negative price is refused outright');
  assert.ok(typed.totals.gross >= 0, `total came out at ${typed.totals.gross}`);
  ok('a negative quantity or price cannot get onto a line');

  // The reason it matters: a minus on one line used to subtract from the whole
  // invoice, so a five-line delivery could total less than a four-line one.
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 5, unitPrice: 10, lineId: 0 });
  const second = store.addItem({ name: 'Raki', quantity: 0, price: 5, cost: 2 });
  const both = store.setDraftLine(draft.id, { itemId: second.id, quantity: 1, unitPrice: -100 });
  assert.strictEqual(both.totals.gross, 50, 'the second line cannot eat the first');
  ok('adding a line can never reduce the total of an invoice');
}

// ======================================= a huge invoice still adds up finitely
{
  const store = shop({ vatEnabled: true, vatRate: 24 });
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 0.01, cost: 0.01 });
  const draft = store.startDraft({ kind: 'in' });
  const big = store.setDraftLine(draft.id, { itemId: item.id, quantity: 999999, unitPrice: 999999 });
  assert.ok(Number.isFinite(big.totals.gross), 'a finite number');
  assert.strictEqual(big.totals.gross, Math.round(big.totals.gross * 100) / 100, 'rounded to the cent');
  ok('a nonsense-sized invoice still produces finite, rounded money');
}

// ============================= a category deleted in the middle of counting it
{
  const store = shop();
  const drinks = store.addCategory({ name: 'Drinks' });
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5, categoryId: drinks.id });

  store.startStockTake({ categoryId: drinks.id });
  store.countStockTake(item.id, 7);

  // Deleting a category clears it off every product, which used to empty the
  // scope of the count and take the figures already typed with it.
  store.deleteCategory(drinks.id);

  const progress = store.stockTakeProgress();
  assert.strictEqual(progress.counted, 1, 'the figure typed before the deletion is still counted');
  assert.strictEqual(progress.lines[0].difference, -3);

  const applied = store.applyStockTake({});
  assert.strictEqual(applied.corrected, 1);
  assert.strictEqual(store.getState().items[0].quantity, 7, 'and it is what gets applied');
  ok('a count already typed survives its category being deleted');
}

// ================== a product moved out of the scope of a count, mid-count
{
  const store = shop();
  const drinks = store.addCategory({ name: 'Drinks' });
  const food = store.addCategory({ name: 'Food' });
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5, categoryId: drinks.id });

  store.startStockTake({ categoryId: drinks.id });
  store.countStockTake(item.id, 4);
  store.updateItem(item.id, { categoryId: food.id });

  const progress = store.stockTakeProgress();
  assert.strictEqual(progress.counted, 1, 'still counted');
  assert.strictEqual(progress.remaining, 0, 'and not also still owed');
  ok('recategorising a product mid-count does not discard the figure');
}

// ============================ stock moving underneath a count in progress
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5, cost: 2 });

  store.startStockTake({});
  refused(() => store.startStockTake({}), 'already in progress');

  store.countStockTake(item.id, 10);
  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 5, unitPrice: 2 });
  store.postDraft(draft.id, {});

  // Counted ten, then five arrived. The count is still ten; what it is measured
  // against is now fifteen, and the variance says five short — which is exactly
  // right, because five of them are still in the box by the door.
  const progress = store.stockTakeProgress();
  assert.strictEqual(store.getState().items[0].quantity, 15);
  assert.strictEqual(progress.counted, 1, 'the count was not erased by the delivery');
  assert.strictEqual(progress.lines[0].expected, 15);
  assert.strictEqual(progress.lines[0].counted, 10);
  assert.strictEqual(progress.lines[0].difference, -5);
  ok('a delivery posted mid-count re-measures the variance instead of losing the count');

  store.updateItem(item.id, { quantity: 2 });
  const after = store.stockTakeProgress();
  assert.strictEqual(after.lines[0].expected, 2, 'against the stock as it is now');
  assert.strictEqual(after.lines[0].difference, 8);
  ok('editing the stock by hand also re-measures rather than freezing the old figure');
}

// ============================ voiding when the products have since been deleted
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 5, cost: 2 });
  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 100, unitPrice: 2 });
  store.postDraft(draft.id, {});

  store.deleteItems([item.id]);
  const document = store.listDocuments().find((entry) => !entry.voids);
  const voided = store.voidDocument(document.id, {});
  assert.strictEqual(voided.moved, 0, 'nothing could be reversed, and it says so');
  ok('voiding an invoice whose products are gone reports honestly instead of pretending');

  refused(() => store.voidDocument(document.id, {}), 'already been voided');
  ok('and the same invoice cannot be voided twice');
}

// ================================================= a customer who is deleted
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5 });
  const client = store.addClient({ name: 'Maria' });
  store.adjustStock(item.id, -3, { reason: 'sale', clientId: client.id });
  store.deleteClient(client.id);

  const summary = report(store.getState(), store.movements, {});
  assert.strictEqual(summary.sales.units, 3, 'the sale still happened');
  assert.strictEqual(summary.sales.takings, 15, 'and the money still came in');
  assert.strictEqual(summary.topClients.length, 0, 'but there is no blank customer row');
  ok('deleting a customer keeps their sales in the takings and off the customer list');

  // And a draft addressed to them still posts — the address book is not part of
  // whether stock moved.
  const second = store.addClient({ name: 'Nikos' });
  const draft = store.startDraft({ kind: 'out' });
  store.updateDraft(draft.id, { clientId: second.id });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 2 });
  store.deleteClient(second.id);
  assert.strictEqual(store.postDraft(draft.id, {}).moved, 1);
  ok('an invoice addressed to a since-deleted customer still posts');
}

// ============================= restoring a backup over open, unfinished work
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5 });
  store.startStockTake({});
  store.countStockTake(item.id, 3);
  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 5, unitPrice: 1 });

  const backup = JSON.parse(JSON.stringify(store.getState()));
  store.replaceAll({ ...backup, stockTake: null, drafts: [] });

  assert.strictEqual(store.getState().stockTake, null, 'the count is not resurrected');
  assert.strictEqual(store.getState().drafts.length, 0, 'nor is the half-typed invoice');
  refused(() => store.countStockTake(item.id, 5), 'No count is in progress');
  ok('a restore does not leave a phantom count or draft behind it');
}

// ======================================= zero per cent means zero per cent
{
  const store = shop({ vatEnabled: true, vatRate: 24 });
  const zero = store.addItem({ name: 'Book', quantity: 10, price: 100, vatRate: 0 });
  const standard = store.addItem({ name: 'Ouzo', quantity: 10, price: 124 });
  store.adjustStock(zero.id, -1, { reason: 'sale' });
  store.adjustStock(standard.id, -1, { reason: 'sale' });

  const vat = vatReport(store.getState(), store.movements, {});
  const rates = vat.collected.rates.map((rate) => rate.rate).sort((a, b) => a - b);
  assert.deepStrictEqual(rates, [0, 24], 'an explicit zero is a rate, not a missing one');
  assert.strictEqual(vat.collected.vat, 24, 'and only the standard line carries VAT');
  ok('a product set to 0% is not quietly given the shop rate');
}

// ================================ reordering something that sold out entirely
{
  const store = shop();
  const item = store.addItem({
    name: 'Ouzo', quantity: 0, price: 5, cost: 2, lowStockThreshold: 5, supplier: 'Kava',
  });
  for (let day = 1; day <= 20; day += 1) {
    store.movements.record({
      itemId: item.id, itemName: 'Ouzo', delta: -3, quantityAfter: 0,
      reason: 'sale', price: 5, cost: 2,
    }, new Date(Date.now() - day * 86400000));
  }

  const list = reorderList(store.getState(), store.movements, { days: 30, cover: 30 });
  const line = list.suppliers[0].items[0];
  assert.strictEqual(line.sold, 60);
  assert.strictEqual(line.suggested, 60, 'a month of sales at the rate it was selling');
  assert.ok(line.urgent, 'and flagged, because it is out of stock now');
  assert.strictEqual(list.suppliers[0].cost, 120);
  ok('a product that sold out is reordered at the rate it actually sold');
}

// ================================== a torn line in the middle of the invoices
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 5, cost: 2 });
  for (const quantity of [5, 6]) {
    const draft = store.startDraft({ kind: 'in' });
    store.setDraftLine(draft.id, { itemId: item.id, quantity, unitPrice: 2 });
    store.postDraft(draft.id, {});
  }
  const file = path.join(store.dataDir, 'invoices', `invoices-${new Date().getUTCFullYear()}.ndjson`);
  fs.appendFileSync(file, 'half a line of json, cut off by a power c\n');

  assert.strictEqual(store.listDocuments().length, 2, 'both invoices still read back');
  ok('a torn line in the invoice file does not take the rest of the year with it');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
