/**
 * Invoices and delivery notes.
 *
 * The thing being tested is that a piece of paper becomes stock exactly once,
 * in one action, and that undoing it leaves both the mistake and the correction
 * visible. A shop will reconcile these against the actual invoice, so the
 * totals below were worked out by hand first.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { totalsFor } = require('../electron/documents');
const { vatReport } = require('../electron/vat');
const { report } = require('../electron/statistics');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-docs-'));
  dirs.push(dir);
  const store = new Store(dir, '1.8.0');
  store.init();
  if (Object.keys(settings).length) store.updateSettings(settings);
  return store;
}

// ============================================== a delivery, posted in one go
{
  const store = shop({ vatEnabled: true, vatRate: 24, costsIncludeVat: false });
  const coffee = store.addItem({ name: 'Coffee', quantity: 5, price: 4, cost: 2 });
  const tea = store.addItem({ name: 'Tea', quantity: 0, price: 3, cost: 1 });

  let draft = store.startDraft({ kind: 'in', by: 'Maria' });
  store.updateDraft(draft.id, { supplier: 'Beans Ltd', number: 'INV-99' });
  store.setDraftLine(draft.id, { itemId: coffee.id, quantity: 100, unitPrice: 2.1 });
  draft = store.setDraftLine(draft.id, { itemId: tea.id, quantity: 50, unitPrice: 0.9 });

  // 100 × 2.10 = 210.00 ; 50 × 0.90 = 45.00 ; net 255.00, VAT 61.20
  assert.strictEqual(draft.totals.net, 255);
  assert.strictEqual(draft.totals.vat, 61.2);
  assert.strictEqual(draft.totals.gross, 316.2);
  assert.strictEqual(draft.totals.units, 150);
  ok('a draft adds up before anything is posted');

  // Nothing has moved yet. This is what the screen promises.
  assert.strictEqual(store.getState().items.find((i) => i.id === coffee.id).quantity, 5);
  ok('typing an invoice does not touch the stock');

  // A half-typed invoice survives the shop closing MyVault mid-delivery.
  const reopened = new Store(store.dataDir, '1.8.0');
  reopened.init();
  assert.strictEqual(reopened.listDrafts().length, 1);
  assert.strictEqual(reopened.listDrafts()[0].lines.length, 2);
  assert.strictEqual(reopened.listDrafts()[0].supplier, 'Beans Ltd');
  ok('a half-typed invoice is still there after a restart');

  const posted = reopened.postDraft(draft.id, { by: 'Maria' });
  assert.strictEqual(posted.moved, 2);

  const after = reopened.getState().items;
  assert.strictEqual(after.find((i) => i.id === coffee.id).quantity, 105, 'five plus a hundred');
  assert.strictEqual(after.find((i) => i.id === tea.id).quantity, 50);
  // What the supplier charged this time is what it costs.
  assert.strictEqual(after.find((i) => i.id === coffee.id).cost, 2.1);
  assert.strictEqual(reopened.listDrafts().length, 0, 'and the draft is finished');
  ok('posting moves every line at once and updates the cost prices');

  // Each line left a movement, and each one names the invoice it came from.
  const moves = reopened.movements.list().filter((m) => m.reason === 'delivery');
  assert.strictEqual(moves.length, 2);
  assert.ok(moves.every((m) => m.docId === draft.id), 'the whole delivery traces back to the paper');
  assert.ok(moves.every((m) => m.by === 'Maria'), 'and to who booked it in');
  ok('every movement can be traced back to the invoice that caused it');

  // The VAT on it is deductible, which is the other half of what an invoice is for.
  assert.strictEqual(vatReport(reopened.getState(), reopened.movements, {}).paid.vat, 61.2);
  ok('the VAT on a delivery becomes deductible input VAT');

  // And it is in the record, once.
  const history = reopened.listDocuments();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].number, 'INV-99');
  assert.strictEqual(history[0].totals.gross, 316.2);
  assert.strictEqual(history[0].voided, false);
  ok('the invoice itself is kept, with its totals as posted');
}

// ================================================= a customer invoice, out
{
  const store = shop({ vatEnabled: true, vatRate: 24, pricesIncludeVat: true });
  const item = store.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  const client = store.addClient({ name: 'Maria' });

  let draft = store.startDraft({ kind: 'out' });
  store.updateDraft(draft.id, { clientId: client.id });
  draft = store.setDraftLine(draft.id, { itemId: item.id, quantity: 10 });

  // The price defaults to the shelf price, and it already contains VAT:
  // 10 × 4.00 = 40.00 gross → 32.26 net, 7.74 VAT.
  assert.strictEqual(draft.lines[0].unitPrice, 4, 'the shelf price fills itself in');
  assert.strictEqual(draft.totals.gross, 40);
  assert.strictEqual(draft.totals.vat, 7.74);

  store.postDraft(draft.id, {});
  assert.strictEqual(store.getState().items[0].quantity, 90, 'ten went out');

  const summary = report(store.getState(), store.movements, {});
  assert.strictEqual(summary.sales.takings, 40);
  assert.strictEqual(summary.sales.vatCollected, 7.74);
  const attributed = summary.topClients.find((c) => c.id === client.id);
  assert.strictEqual(attributed.units, 10, 'and it is against the customer it was billed to');
  ok('an outgoing invoice sells the lines and bills them to the customer');
}

// =================================================== undoing a posted one
{
  const store = shop();
  const item = store.addItem({ name: 'Coffee', quantity: 10, price: 4, cost: 2 });

  let draft = store.startDraft({ kind: 'in' });
  draft = store.setDraftLine(draft.id, { itemId: item.id, quantity: 100, unitPrice: 2 });
  store.postDraft(draft.id, {});
  assert.strictEqual(store.getState().items[0].quantity, 110);

  const original = store.listDocuments()[0];
  store.voidDocument(original.id, { by: 'Owner' });

  assert.strictEqual(store.getState().items[0].quantity, 10, 'the stock goes back where it was');

  const history = store.listDocuments();
  assert.strictEqual(history.length, 2, 'both the invoice and its reversal are kept');
  const reversal = history.find((d) => d.voids);
  const kept = history.find((d) => d.id === original.id);
  assert.ok(reversal, 'the reversal names what it cancels');
  assert.strictEqual(reversal.voids, original.id);
  assert.strictEqual(kept.voided, true, 'and the original is marked, not removed');
  assert.strictEqual(reversal.totals.gross, -original.totals.gross);
  ok('voiding posts the opposite and keeps both — the stock really did move');

  assert.throws(() => store.voidDocument(original.id, {}), /already been voided/);
  ok('the same invoice cannot be voided twice');
}

// ---------------------------------------------------------- the awkward cases
{
  const store = shop();
  const item = store.addItem({ name: 'Coffee', quantity: 0, price: 4, cost: 2 });

  const draft = store.startDraft({ kind: 'in' });
  assert.throws(() => store.postDraft(draft.id, {}), /no lines/, 'an empty invoice posts nothing');

  // A blank row on a paper invoice should not stop the rest being entered.
  assert.throws(() => store.setDraftLine(draft.id, { itemId: item.id, quantity: 0 }), /quantity/);
  assert.throws(() => store.setDraftLine(draft.id, { itemId: 'nope', quantity: 1 }), /not in your stock/);

  // The same product twice at two prices is a real thing on an invoice, and the
  // two lines must not silently merge into one.
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 10, unitPrice: 2 });
  const two = store.setDraftLine(draft.id, { itemId: item.id, quantity: 5, unitPrice: 3, lineId: 1 });
  assert.strictEqual(two.lines.length, 2, 'two boxes at two prices are two lines');
  assert.strictEqual(two.totals.units, 15);
  assert.strictEqual(two.totals.gross, 35, '10 × 2 plus 5 × 3');
  ok('an empty invoice, a blank line and the same product twice all behave');

  store.removeDraftLine(draft.id, 0);
  assert.strictEqual(store.listDrafts()[0].lines.length, 1);
  store.discardDraft(draft.id);
  assert.strictEqual(store.listDrafts().length, 0);
  assert.strictEqual(store.getState().items[0].quantity, 0, 'throwing a draft away moves nothing');
  ok('a line can be removed and a whole draft thrown away, without touching stock');
}

// An invoice for more than the shelf holds is refused outright.
//
// This check used to say the opposite: that the stock floored at zero and the
// log recorded the three that really moved. That is right at the till, where the
// only record is the movement — but on an invoice it left the paper claiming ten
// while the movements said three, so the document total and the VAT return built
// from those movements disagreed by the difference. There is no version of
// posting this that is honest, so it is not posted: the shop is told which line
// is short and by how much, and corrects the count or the line.
{
  const store = shop();
  const item = store.addItem({ name: 'Coffee', quantity: 3, price: 4, cost: 2 });
  const draft = store.startDraft({ kind: 'out' });
  store.setDraftLine(draft.id, { itemId: item.id, quantity: 10 });

  let refusal = '';
  try { store.postDraft(draft.id, {}); } catch (error) { refusal = error.message; }
  assert.ok(refusal.includes('the invoice says 10, but you have 3'), refusal);
  assert.strictEqual(store.getState().items[0].quantity, 3, 'no stock moved');
  assert.strictEqual(store.movements.list().length, 1, 'and nothing but the opening count');
  assert.strictEqual(store.listDrafts().length, 1, 'the draft is still there to fix');
  ok('an invoice for more than the shelf holds is refused, naming the line and the shortfall');
}

// ------------------------------------------------------- the supplier's file
{
  const store = shop();
  const coffee = store.addItem({ name: 'Coffee', quantity: 0, price: 4, cost: 2, barcode: '5201234567890' });
  store.addItem({ name: 'Tea', quantity: 0, price: 3, cost: 1 });

  const draft = store.startDraft({ kind: 'in' });
  const result = store.importDraftLines(draft.id, [
    { Barcode: '5201234567890', Quantity: '24', Price: '2.05' },
    { Name: 'Tea', Quantity: '12', Price: '0.95' },
    { Name: 'Something we do not sell', Quantity: '6', Price: '1.00' },
    { Name: 'Ignored', Quantity: '0', Price: '1.00' },
  ]);

  assert.strictEqual(result.added, 2, 'matched on barcode first, then on name');
  assert.strictEqual(result.unmatched.length, 1, 'and what it could not match is handed back');
  assert.strictEqual(result.unmatched[0].name, 'Something we do not sell');
  assert.strictEqual(result.draft.lines[0].itemId, coffee.id);
  assert.strictEqual(result.draft.lines[0].quantity, 24);
  assert.strictEqual(result.draft.lines[0].unitPrice, 2.05);
  // 24 × 2.05 = 49.20 ; 12 × 0.95 = 11.40
  assert.strictEqual(result.draft.totals.gross, 60.6);
  ok('a supplier CSV fills the invoice in, and never guesses at a product it cannot find');
}

// --------------------------------------------------------------- the totals
{
  // Inclusive: €124 at 24% is €100 of goods and €24 of tax.
  const inclusive = totalsFor([{ quantity: 1, unitPrice: 124, vatRate: 24 }], { inclusive: true });
  assert.strictEqual(inclusive.net, 100);
  assert.strictEqual(inclusive.vat, 24);
  assert.strictEqual(inclusive.gross, 124);

  // Exclusive: €100 at 24% becomes €124.
  const exclusive = totalsFor([{ quantity: 1, unitPrice: 100, vatRate: 24 }], { inclusive: false });
  assert.strictEqual(exclusive.net, 100);
  assert.strictEqual(exclusive.vat, 24);
  assert.strictEqual(exclusive.gross, 124);

  const mixed = totalsFor([
    { quantity: 2, unitPrice: 10.6, vatRate: 6 },
    { quantity: 1, unitPrice: 12.4, vatRate: 24 },
  ], { inclusive: true });
  // 21.20 at 6% → 1.20 ; 12.40 at 24% → 2.40
  assert.strictEqual(mixed.vat, 3.6);
  assert.strictEqual(mixed.gross, 33.6);
  ok('invoice totals split VAT the same way the VAT return does');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
