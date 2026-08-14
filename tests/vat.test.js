/**
 * VAT.
 *
 * A shop pays this figure out of its own bank account, so every number below is
 * checked against a worked example done by hand. The two mistakes that would
 * cost a shopkeeper real money are:
 *
 *   • treating a shelf price as if VAT had to be added to it, which overstates
 *     the bill by about a quarter, and
 *   • forgetting that VAT paid to suppliers is deductible, which can easily
 *     double what a shop thinks it owes.
 *
 * Both have a test whose expected value was worked out on paper first.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const {
  fromGross, fromNet, normalizeRate, rateFor, vatReport, vatPeriods, SUGGESTED_RATES,
} = require('../electron/vat');
const { report } = require('../electron/statistics');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shopWith(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-vat-'));
  dirs.push(dir);
  const shop = new Store(dir, '1.7.0');
  shop.init();
  shop.updateSettings({ vatEnabled: true, vatRate: 24, ...settings });
  return shop;
}

// ================================================== pulling VAT out of a price
//
// €4.00 on the shelf at 24% is €3.23 of goods and €0.77 of tax. It is NOT
// €4.00 plus €0.96 — that is the mistake that overstates a shop's bill.
{
  const inclusive = fromGross(4, 24);
  assert.strictEqual(inclusive.vat, 0.77, '4 × 24/124 = 0.774…, so 0.77');
  assert.strictEqual(inclusive.net, 3.23);
  assert.strictEqual(inclusive.gross, 4);

  const exclusive = fromNet(4, 24);
  assert.strictEqual(exclusive.vat, 0.96, 'adding VAT to 4 gives 0.96');
  assert.strictEqual(exclusive.gross, 4.96);
  assert.notStrictEqual(inclusive.vat, exclusive.vat, 'the two are not the same sum');
  ok('VAT inside a price and VAT added to a price are told apart');

  // The Greek rates, worked by hand.
  assert.strictEqual(fromGross(113, 13).vat, 13, '113 × 13/113 = exactly 13');
  assert.strictEqual(fromGross(106, 6).vat, 6);
  assert.strictEqual(fromGross(124, 24).vat, 24);
  assert.deepStrictEqual(SUGGESTED_RATES, [24, 13, 6, 0]);
  ok('the Greek rates come out exactly right on round numbers');

  // Zero-rated and exempt goods.
  assert.deepStrictEqual(fromGross(10, 0), { net: 10, vat: 0, gross: 10 });
  assert.deepStrictEqual(fromNet(10, 0), { net: 10, vat: 0, gross: 10 });
  ok('zero-rated goods carry no VAT either way round');

  assert.strictEqual(normalizeRate(''), null);
  assert.strictEqual(normalizeRate(null), null);
  assert.strictEqual(normalizeRate(-5), null, 'a negative rate is not a rate');
  assert.strictEqual(normalizeRate(101), null, 'and neither is one over 100');
  assert.strictEqual(normalizeRate('13'), 13, 'a typed rate is still a rate');
  ok('a nonsense rate is refused rather than used');
}

// ----------------------------------------------------- which rate applies
{
  const settings = { vatEnabled: true, vatRate: 24 };
  assert.strictEqual(rateFor({ vatRate: null }, settings), 24, 'the shop default');
  assert.strictEqual(rateFor({ vatRate: 6 }, settings), 6, 'the product overrides it');
  assert.strictEqual(rateFor({ vatRate: 0 }, settings), 0, 'including down to zero');
  assert.strictEqual(rateFor({ vatRate: 6 }, { vatEnabled: false, vatRate: 24 }), 0,
    'with VAT switched off nothing is charged at all');
  ok('a bookshop can sell books at 6% and pens at 24% from one default');
}

// ============================================ what the shop actually owes
//
// Worked by hand:
//   sold 100 coffees at €4.00 → €400.00 gross, VAT 400×24/124 = €77.42
//   bought 200 in at €2.00 net → €400.00 net, VAT 400×0.24    = €96.00
//   payable = 77.42 − 96.00 = −€18.58, a refund position
{
  const shop = shopWith();
  const coffee = shop.addItem({ name: 'Coffee', quantity: 0, price: 4, cost: 2 });
  shop.adjustStock(coffee.id, 200, { reason: 'delivery' });
  shop.adjustStock(coffee.id, -100, { reason: 'sale' });

  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.collected.vat, 77.42, 'VAT taken from customers');
  assert.strictEqual(vat.collected.net, 322.58, 'and the goods underneath it');
  assert.strictEqual(vat.paid.vat, 96, 'VAT paid to the supplier');
  assert.strictEqual(vat.payable, -18.58, 'more paid out than taken in');
  ok('VAT on purchases is deducted — a shop that stocked up is owed money, not billed');

  // The failure this guards against: reporting sales VAT alone would bill this
  // shop €77.42 when it is actually owed €18.58 — out by nearly a hundred euros
  // on a single quarter of one product.
  assert.notStrictEqual(vat.payable, vat.collected.vat);
  ok('the bill is never mistaken for the VAT collected on sales');
}

// A shop selling more than it buys, which is the ordinary case.
{
  const shop = shopWith();
  const item = shop.addItem({ name: 'Tea', quantity: 100, price: 2.48, cost: 1 });
  shop.adjustStock(item.id, -50, { reason: 'sale' });
  const vat = vatReport(shop.getState(), shop.movements, {});
  // 50 × 2.48 = 124.00 → VAT exactly 24.00
  assert.strictEqual(vat.collected.gross, 124);
  assert.strictEqual(vat.collected.vat, 24);
  assert.strictEqual(vat.paid.vat, 0, 'an opening count is not a purchase invoice');
  assert.strictEqual(vat.payable, 24);
  ok('an ordinary trading period produces a bill, and opening stock is not a purchase');
}

// ------------------------------------------------------------ refunds
{
  const shop = shopWith();
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -100, { reason: 'sale' });
  shop.adjustStock(item.id, 25, { reason: 'return' });

  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.collected.gross, 300, 'the refunds come off the turnover');
  assert.strictEqual(vat.collected.rates[0].units, 75);

  // A cent worth explaining, because someone will one day try to "fix" it.
  //
  //   the sale:   €400 × 24/124 = 77.4193… → €77.42
  //   the refund: €100 × 24/124 = 19.3548… → €19.35
  //   the return:                              €58.07
  //
  // Working from the net €300 in one go gives €58.06 instead. The figure below
  // is the right one: VAT is worked out and rounded on each document as it is
  // issued, and the return adds those up. A quarter total that disagreed by a
  // cent with the receipts behind it is the version that causes an argument.
  assert.strictEqual(vat.collected.vat, 58.07, 'rounded per document, then summed');
  assert.notStrictEqual(vat.collected.vat, 58.06, 'not the whole quarter treated as one invoice');
  ok('a refund hands back the VAT with the money, rounded the way the receipts were');

  // More refunds than sales in a period is unusual but real, and must not be
  // silently floored at zero.
  const quiet = shopWith();
  const thing = quiet.addItem({ name: 'Coat', quantity: 10, price: 124, cost: 50 });
  quiet.adjustStock(thing.id, -1, { reason: 'sale' });
  quiet.adjustStock(thing.id, 3, { reason: 'return' });
  const owed = vatReport(quiet.getState(), quiet.movements, {});
  assert.strictEqual(owed.collected.vat, -48, 'two net refunds at €24 of VAT each');
  assert.ok(owed.payable < 0, 'and the shop is owed, not billed');
  ok('a quarter with more refunds than sales produces a negative figure, not a zero');
}

// -------------------------------------------------- more than one rate
{
  const shop = shopWith();
  const book = shop.addItem({ name: 'Novel', quantity: 100, price: 10.6, cost: 5, vatRate: 6 });
  const pen = shop.addItem({ name: 'Pen', quantity: 100, price: 1.24, cost: 0.5 });
  shop.adjustStock(book.id, -10, { reason: 'sale' });
  shop.adjustStock(pen.id, -10, { reason: 'sale' });

  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.collected.rates.length, 2, 'a return is filed per rate');
  const standard = vat.collected.rates.find((r) => r.rate === 24);
  const reduced = vat.collected.rates.find((r) => r.rate === 6);
  // 10 × 10.60 = 106.00 → VAT exactly 6.00 ; 10 × 1.24 = 12.40 → VAT 2.40
  assert.strictEqual(reduced.vat, 6);
  assert.strictEqual(standard.vat, 2.4);
  assert.strictEqual(vat.collected.vat, 8.4);
  assert.strictEqual(vat.collected.rates[0].rate, 24, 'highest rate first, as on the form');
  ok('turnover is broken down per rate, the way a VAT return is laid out');
}

// ------------------------------------- costs entered the other way round
{
  const netInvoices = shopWith({ costsIncludeVat: false });
  const item = netInvoices.addItem({ name: 'Thing', quantity: 0, price: 10, cost: 100 });
  netInvoices.adjustStock(item.id, 1, { reason: 'delivery' });
  assert.strictEqual(vatReport(netInvoices.getState(), netInvoices.movements, {}).paid.vat, 24,
    '€100 net invoice carries €24 of VAT');

  const grossInvoices = shopWith({ costsIncludeVat: true });
  const other = grossInvoices.addItem({ name: 'Thing', quantity: 0, price: 10, cost: 124 });
  grossInvoices.adjustStock(other.id, 1, { reason: 'delivery' });
  assert.strictEqual(vatReport(grossInvoices.getState(), grossInvoices.movements, {}).paid.vat, 24,
    '€124 including VAT carries the same €24');
  ok('a cost price entered either way produces the same deductible VAT');
}

// Shelf prices entered without VAT — a wholesaler rather than a shop.
{
  const wholesale = shopWith({ pricesIncludeVat: false });
  const item = wholesale.addItem({ name: 'Box', quantity: 10, price: 100, cost: 50 });
  wholesale.adjustStock(item.id, -1, { reason: 'sale' });
  const vat = vatReport(wholesale.getState(), wholesale.movements, {});
  assert.strictEqual(vat.collected.net, 100);
  assert.strictEqual(vat.collected.vat, 24, 'VAT is added on top rather than dug out');
  assert.strictEqual(vat.collected.gross, 124);
  ok('a shop that quotes prices before VAT gets VAT added, not extracted');
}

// ------------------------------------------------ what is left out, and said
{
  const shop = shopWith();
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });
  // Stock lost, and stock corrected by a count. Whether either needs a VAT
  // adjustment depends on why it went, which MyVault cannot know.
  shop.startStockTake({});
  shop.countStockTake(item.id, 80);
  shop.applyStockTake({});

  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.collected.rates[0].units, 10, 'only the ten sold are turnover');
  assert.ok(vat.excluded.movements >= 1, 'the stock take is counted');
  assert.ok(vat.excluded.units >= 10, 'and its size reported');
  ok('stock takes and write-offs are excluded from the sums, and named rather than hidden');
}

// History from before VAT was switched on is flagged, not treated as zero-rated.
{
  const shop = shopWith({ vatEnabled: false });
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });
  shop.updateSettings({ vatEnabled: true, vatRate: 24 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });

  const vat = vatReport(shop.getState(), shop.movements, {});
  const zero = vat.collected.rates.find((r) => r.rate === 0);
  const standard = vat.collected.rates.find((r) => r.rate === 24);
  assert.ok(zero && zero.units === 10, 'what sold before VAT was on stays at 0%');
  assert.ok(standard && standard.units === 10, 'and what sold after is charged');
  assert.strictEqual(standard.vat, 7.74);
  ok('turning VAT on does not rewrite what was sold before it');
}

// The rate is frozen into the history, exactly like the price.
{
  const shop = shopWith({ vatRate: 24 });
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });
  // The government changes the rate.
  shop.updateSettings({ vatRate: 13 });
  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.collected.rates[0].rate, 24, 'last month was charged at 24');
  assert.strictEqual(vat.collected.vat, 7.74, 'and the return does not move underneath it');
  ok('changing the rate never rewrites a return already filed');
}

// --------------------------------------------------- the periods you can file
{
  const periods = vatPeriods(new Date(2026, 4, 15)); // mid-May 2026
  assert.strictEqual(periods.thisQuarter.quarter, 2);
  assert.strictEqual(periods.thisQuarter.from.slice(0, 7), '2026-04', 'April to June');
  assert.strictEqual(periods.lastQuarter.quarter, 1);
  assert.strictEqual(periods.lastQuarter.from.slice(0, 7), '2026-01');
  assert.strictEqual(periods.thisYear.from.slice(0, 4), '2026');
  assert.strictEqual(periods.lastYear.year, 2025);

  // January must look back to the last quarter of the previous year, not to
  // quarter zero of this one.
  const january = vatPeriods(new Date(2026, 0, 10));
  assert.strictEqual(january.lastQuarter.year, 2025);
  assert.strictEqual(january.lastQuarter.quarter, 4);
  ok('the periods are the calendar quarters a return is actually filed for');
}

// A period boundary must not leak a sale into the neighbouring return.
{
  const shop = shopWith();
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.movements.record({
    itemId: item.id, itemName: 'Coffee', delta: -1, quantityAfter: 99,
    reason: 'sale', price: 4, cost: 2, vatRate: 24,
  }, new Date(2026, 2, 31, 23, 30));
  shop.movements.record({
    itemId: item.id, itemName: 'Coffee', delta: -1, quantityAfter: 98,
    reason: 'sale', price: 4, cost: 2, vatRate: 24,
  }, new Date(2026, 3, 1, 0, 30));

  const periods = vatPeriods(new Date(2026, 4, 15));
  const q1 = vatReport(shop.getState(), shop.movements, periods.lastQuarter);
  const q2 = vatReport(shop.getState(), shop.movements, periods.thisQuarter);
  assert.strictEqual(q1.collected.rates[0].units, 1, 'one sale in the first quarter');
  assert.strictEqual(q2.collected.rates[0].units, 1, 'and one in the second');
  ok('a sale at midnight on the last day of a quarter lands in exactly one return');
}

// ------------------------------------------- the statistics screen agrees
{
  const shop = shopWith();
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });

  const stats = report(shop.getState(), shop.movements, {});
  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(stats.sales.takings, 40, 'takings are what went into the till');
  assert.strictEqual(stats.sales.vatCollected, vat.collected.vat, 'and agree with the VAT screen');
  assert.strictEqual(stats.sales.netTakings, 32.26, 'the part that is the shop\'s');
  assert.strictEqual(
    Math.round((stats.sales.netTakings + stats.sales.vatCollected) * 100) / 100,
    stats.sales.takings,
    'net plus VAT is exactly the takings',
  );
  // Profit on the net figure, because the VAT never belonged to the shop.
  assert.strictEqual(stats.sales.netProfit, 12.26, '32.26 less the €20 those ten cost');
  ok('the statistics screen and the VAT screen never disagree');
}

// With VAT off, nothing appears and nothing is charged.
{
  const shop = shopWith({ vatEnabled: false });
  const item = shop.addItem({ name: 'Coffee', quantity: 100, price: 4, cost: 2 });
  shop.adjustStock(item.id, -10, { reason: 'sale' });
  const vat = vatReport(shop.getState(), shop.movements, {});
  assert.strictEqual(vat.enabled, false);
  assert.strictEqual(vat.collected.vat, 0);
  assert.strictEqual(vat.payable, 0);
  assert.strictEqual(report(shop.getState(), shop.movements, {}).sales.vatCollected, 0);
  ok('a shop that has not switched VAT on is never shown a tax figure');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
