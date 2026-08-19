/**
 * What to charge, checked against arithmetic done on paper.
 *
 * The numbers in here are all worked from one product, so the same figures come
 * round again and again and a wrong one is obvious:
 *
 *   shelf price   12,40 including 24% VAT   →  net 10,00
 *   usual cost     6,00 net
 *   margin        (10,00 − 6,00) / 10,00    =  40%
 *   markup        (10,00 − 6,00) / 6,00     =  66,7%
 *
 * Then the supplier knocks 20% off and it costs 4,80 instead. Everything this
 * file is about follows from that one delivery: the margin quietly becomes 52%,
 * the shop earns 12,00 more on the batch than it expected to, and if it wants to
 * pass the deal on instead, the price that keeps its old 40% is 9,90.
 *
 * The one rule worth stating twice: margin is worked out on the net price. A
 * shelf price of 12,40 contains 2,40 that was never the shop's money, and a
 * margin taken against the gross would flatter every product in the shop.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const {
  tidy, tidyAtLeast, marginOf, markupOf, priceForMargin, median,
  costHistory, priceAdvice, priceReview, deliveryReview,
  ROUNDING_STYLES, DISCOUNT_THRESHOLD,
} = require('../electron/pricing');
const { buildDocument } = require('../electron/pdf');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-pricing-'));
  dirs.push(dir);
  const store = new Store(dir, '1.9.0');
  store.init();
  store.updateSettings({
    vatEnabled: true, vatRate: 24, pricesIncludeVat: true, costsIncludeVat: false, ...settings,
  });
  return store;
}

/** Takes a delivery in at a given cost, the way the shop actually would. */
function deliver(store, itemId, units, unitPrice) {
  const draft = store.startDraft({ kind: 'in' });
  store.setDraftLine(draft.id, { itemId, quantity: units, unitPrice });
  return store.postDraft(draft.id, {});
}

const find = (advice, kind) => advice.suggestions.find((entry) => entry.kind === kind);

// ================================================== margin, on the right figure
{
  assert.strictEqual(marginOf(10, 6), 40, '(10 − 6) / 10');
  assert.strictEqual(markupOf(10, 6), 66.7, '(10 − 6) / 6');
  assert.strictEqual(priceForMargin(6, 40), 10, 'and back again');
  assert.strictEqual(marginOf(priceForMargin(6, 40), 6), 40, 'a clean round trip');
  ok('margin, markup and the price that earns a margin are each other\'s inverse');

  // A price of nothing has no margin, which is not the same as a margin of zero.
  assert.strictEqual(marginOf(0, 6), null, 'unpriced is not 0%');
  assert.strictEqual(markupOf(10, 0), null, 'and a free product has no markup');
  // No price is high enough to earn 100% of itself as profit.
  assert.strictEqual(priceForMargin(6, 100), null);
  assert.strictEqual(priceForMargin(6, 140), null);
  assert.strictEqual(priceForMargin(6, 0), 6, 'a zero margin is simply the cost');
  ok('the impossible margins are refused rather than approximated');
}

// ============================================ the same product, four VAT setups
{
  // Prices inclusive, costs net: the ordinary Greek retail shop.
  const retail = shop();
  const a = retail.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  const advice = priceAdvice(retail.getState(), retail.movements, a.id);
  assert.strictEqual(advice.price, 12.40);
  assert.strictEqual(advice.netPrice, 10.00, '12,40 less the 2,40 of VAT in it');
  assert.strictEqual(advice.netCost, 6.00);
  assert.strictEqual(advice.margin, 40);
  assert.strictEqual(advice.markup, 66.7);
  assert.strictEqual(advice.profit, 4.00);
  ok('a VAT-inclusive shelf price has the tax taken out before the margin is worked out');

  // Costs also inclusive: 7,44 including 24% is the same 6,00 underneath.
  const both = shop({ costsIncludeVat: true });
  const b = both.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 7.44 });
  const second = priceAdvice(both.getState(), both.movements, b.id);
  assert.strictEqual(second.netCost, 6.00, '7,44 including VAT is 6,00 net');
  assert.strictEqual(second.margin, 40, 'so the margin is unchanged');
  ok('a VAT-inclusive cost gives the same margin as the net cost it contains');

  // VAT off entirely: the shelf price is the whole of it.
  const plain = shop({ vatEnabled: false });
  const c = plain.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  const third = priceAdvice(plain.getState(), plain.movements, c.id);
  assert.strictEqual(third.netPrice, 12.40, 'nothing to take out');
  assert.strictEqual(third.margin, 51.6);
  ok('with VAT switched off the shelf price is the net price');

  // A product with its own rate uses its own rate, not the shop's.
  const mixed = shop();
  const d = mixed.addItem({ name: 'Water', quantity: 10, price: 1.13, cost: 0.50, vatRate: 13 });
  const fourth = priceAdvice(mixed.getState(), mixed.movements, d.id);
  assert.strictEqual(fourth.vatRate, 13);
  assert.strictEqual(fourth.netPrice, 1.00, '1,13 at 13% is 1,00');
  assert.strictEqual(fourth.margin, 50);
  ok('a product with its own VAT rate is netted at its own rate');
}

// ======================================================= what we usually pay
{
  assert.strictEqual(median([6]), 6);
  assert.strictEqual(median([6, 4]), 5);
  assert.strictEqual(median([6, 6, 6, 18]), 6, 'one panic-buy does not move the middle');
  assert.strictEqual(median([]), null);
  ok('the usual cost is a median, so a single strange delivery cannot move it');

  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 4.80);

  const history = costHistory(store.movements, item.id);
  assert.strictEqual(history.length, 3);
  assert.deepStrictEqual(history.map((line) => line.cost), [6, 6, 4.8], 'oldest first');
  assert.strictEqual(history[2].units, 10);

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.history.deliveries, 3);
  assert.strictEqual(advice.history.last, 4.80);
  assert.strictEqual(advice.history.usual, 6.00, 'the median of the two before it');
  assert.strictEqual(advice.history.lowest, 4.80);
  assert.strictEqual(advice.history.highest, 6.00);
  ok('the cost history reads back off the movement log, oldest first');
}

// ================================== only a delivery is a price someone charged
{
  const store = shop();
  // An opening count carries the cost that was typed when the product was made
  // up, which is a memory at best.
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  // A sale, a stock take and a write-off all carry a cost so the movement can be
  // valued — none of them is a supplier's price.
  store.adjustStock(item.id, -2, { reason: 'sale' });
  store.startStockTake({});
  store.countStockTake(item.id, 7);
  store.applyStockTake({});

  assert.strictEqual(costHistory(store.movements, item.id).length, 0, 'not one of those was a purchase');
  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.history.deliveries, 0);
  assert.strictEqual(advice.history.usual, null);
  assert.strictEqual(advice.change, null, 'and so there is nothing to compare against');
  assert.strictEqual(advice.margin, 40, 'but the margin is still known from the cost on file');
  ok('opening counts, sales and stock takes are not treated as purchase prices');
}

// ============================================== one delivery is not a pattern
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 3.00);

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.history.deliveries, 1);
  assert.strictEqual(advice.history.usual, null, 'nothing earlier to be usual');
  assert.strictEqual(
    advice.change, null,
    'a first delivery at half price is not a discount — it is the only price we know',
  );
  ok('the first delivery of a product is never reported as cheaper than usual');
}

// ================================================ and cheap can become normal
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  for (let time = 0; time < 3; time += 1) deliver(store, item.id, 10, 4.80);

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.history.usual, 4.80, 'the median of 6,00 / 4,80 / 4,80');
  assert.strictEqual(
    advice.change, null,
    'the fourth cheap delivery is business as usual, and saying otherwise every time '
    + 'would train the shop to ignore the screen',
  );
  ok('once a lower cost becomes the norm it stops being reported as a discount');
}

// ==================================================== the discount, in full
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 4.80);

  const advice = priceAdvice(store.getState(), store.movements, item.id);

  assert.strictEqual(advice.change.kind, 'cheaper');
  assert.strictEqual(advice.change.from, 6.00);
  assert.strictEqual(advice.change.to, 4.80);
  assert.strictEqual(advice.change.percent, 20, '1,20 off 6,00');
  assert.strictEqual(advice.change.units, 10);
  assert.strictEqual(advice.change.saving, 12.00, '1,20 × 10 bottles');
  ok('a delivery 20% under the usual cost is reported with what the deal was worth');

  // The margin moved without anybody touching the price.
  assert.strictEqual(advice.netCost, 4.80);
  assert.strictEqual(advice.margin, 52, '(10,00 − 4,80) / 10,00');
  assert.strictEqual(advice.profit, 5.20);

  // Hold: leave the price alone and pocket it. First, because it is usually right.
  const hold = advice.suggestions[0];
  assert.strictEqual(hold.kind, 'hold');
  assert.strictEqual(hold.price, 12.40, 'the price already on the shelf');
  assert.strictEqual(hold.difference, 0);
  assert.strictEqual(hold.margin, 52);
  assert.strictEqual(hold.wasMargin, 40, 'what it used to earn');
  assert.strictEqual(hold.extra, 12.00, '1,20 of extra margin on each of ten');
  ok('holding the price is offered first, with what the batch earns above the usual');

  // Or pass the saving on and go back to earning the 40% it used to.
  const passOn = find(advice, 'passOn');
  //   4,80 / (1 − 0,40) = 8,00 net → 8,00 × 1,24 = 9,92 → 9,90 at five cents
  assert.strictEqual(passOn.price, 9.90);
  assert.strictEqual(passOn.difference, -2.50, '2,50 off the shelf price');
  //   9,90 gross is 7,98 net, and (7,98 − 4,80) / 7,98 is 39,8%
  assert.strictEqual(passOn.margin, 39.8, 'the margin the rounded price really earns');
  assert.strictEqual(passOn.note, 'oneOffCost', 'and it comes with the warning');
  ok('passing the deal on gives the price that keeps the old margin, rounded and re-checked');
}

// ============================================ the one nobody asks for: a rise
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 7.20);

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.change.kind, 'dearer');
  assert.strictEqual(advice.change.percent, 20);
  assert.strictEqual(advice.change.saving, -12.00, 'a negative saving is what a rise costs');
  assert.strictEqual(advice.margin, 28, '(10,00 − 7,20) / 10,00 — squeezed from 40%');

  const restore = find(advice, 'restore');
  //   7,20 / 0,60 = 12,00 net → 14,88 gross → 14,90 at five cents
  assert.strictEqual(restore.price, 14.90);
  assert.strictEqual(restore.difference, 2.50);
  assert.strictEqual(restore.note, 'costRose');
  assert.ok(restore.margin >= 40, `back to at least the old margin, got ${restore.margin}%`);
  ok('a cost that went up is reported with the price that puts the margin back');
}

// ============================================== how small a change is nothing
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 5.85); // 2,5% — a supplier shaving a cent

  assert.strictEqual(
    priceAdvice(store.getState(), store.movements, item.id).change, null,
    'two and a half per cent is rounding, not news',
  );

  const other = shop();
  const second = other.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(other, second.id, 10, 6.00);
  deliver(other, second.id, 10, 6.00);
  deliver(other, second.id, 10, 5.70); // exactly 5%

  const change = priceAdvice(other.getState(), other.movements, second.id).change;
  assert.strictEqual(DISCOUNT_THRESHOLD, 5, 'a percentage, compared as displayed');
  // Thirty cents off six euros. In binary 0,3 / 6 is 0,049999999999999996, so
  // comparing the raw division against 0,05 put this delivery on the wrong side
  // of the line while still printing "5%" on the screen.
  assert.ok(change, 'exactly on the threshold counts');
  assert.strictEqual(change.percent, 5);
  assert.strictEqual(change.difference, -0.30);
  ok('a change under 5% is ignored, one exactly on 5% is reported, and the two agree');

  // The threshold is the percentage as the shop sees it, not the division behind
  // it. Five cents off 1,01 is 4,95%, which is written on the screen as 5% — so
  // it has to count as one. Comparing the unrounded 4,9504… would show the shop
  // a 5% discount badge on a product it had decided was not a discount.
  const cents = shop();
  const small = cents.addItem({ name: 'Chewing gum', quantity: 0, price: 1.50, cost: 1.01 });
  deliver(cents, small.id, 50, 1.01);
  deliver(cents, small.id, 50, 1.01);
  deliver(cents, small.id, 50, 0.96);

  const tiny = priceAdvice(cents.getState(), cents.movements, small.id).change;
  assert.ok(tiny, 'five cents off 1,01 reads as 5% and so counts');
  assert.strictEqual(tiny.percent, 5);
  assert.strictEqual(tiny.difference, -0.05);
  assert.strictEqual(tiny.saving, 2.50, '5 cents across 50 packets');
  ok('the threshold is the percentage the shop is shown, rounded once and used for both');
}

// ============================================== selling it for less than it cost
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 5.00, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.netPrice, 4.03, '5,00 including 24% VAT');
  assert.ok(advice.losing, 'the shop is 1,97 down on every bottle it sells');
  assert.strictEqual(advice.profit, -1.97);

  // The cover suggestion comes first, ahead of anything else on the list.
  assert.strictEqual(advice.suggestions[0].kind, 'cover');
  const cover = advice.suggestions[0];
  assert.strictEqual(cover.note, 'belowCost');
  //   6,00 net → 7,44 gross, and 7,45 at five cents is the first tidy price above it
  assert.strictEqual(cover.price, 7.45);
  assert.ok(cover.margin >= 0, `covering the cost cannot still lose money: ${cover.margin}%`);
  ok('a product priced under its cost is flagged, and the suggestion at least covers it');
}

// ================================ rounding must never undercut what it covers
{
  // A cost whose tidy price would round back under it. Whatever ending the shop
  // has asked for, the suggestion has to clear the cost.
  for (const style of ROUNDING_STYLES) {
    const store = shop({ priceRounding: style, vatEnabled: false });
    const item = store.addItem({ name: 'Thing', quantity: 0, price: 1.00, cost: 2.02 });
    deliver(store, item.id, 5, 2.02);
    deliver(store, item.id, 5, 2.02);
    const advice = priceAdvice(store.getState(), store.movements, item.id);
    const cover = find(advice, 'cover');
    assert.ok(cover, `${style}: expected a cover suggestion`);
    assert.ok(
      cover.price >= 2.02,
      `${style}: suggested ${cover.price} for something that cost 2,02`,
    );
  }
  ok('no rounding style can round a cover-your-cost price back below the cost');

  assert.strictEqual(tidyAtLeast(2.02, 'ends99', 2.02), 2.99, 'stepping up keeps the ending');
  assert.strictEqual(tidy(0.03, 'nearest10'), 0.10, 'rounding never produces a free product');
  assert.strictEqual(tidy(0.03, 'ends9'), 0.09, 'nor a negative one');
  ok('rounding a tiny price down to nothing is refused in every style');
}

// ================================================== the shop's own target
{
  const store = shop({ targetMargin: 50 });
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.margin, 40, 'below the 50% the shop asked for');
  const target = find(advice, 'target');
  //   6,00 / 0,50 = 12,00 net → 14,88 gross → 14,90
  assert.strictEqual(target.price, 14.90);
  assert.strictEqual(target.note, 'belowTarget');
  ok('a shop that sets a target margin is told the price that would reach it');

  // And a product already above the target is left alone.
  const good = store.addItem({ name: 'Raki', quantity: 10, price: 24.80, cost: 6.00 });
  const second = priceAdvice(store.getState(), store.movements, good.id);
  assert.strictEqual(second.margin, 70);
  assert.strictEqual(find(second, 'target'), undefined, 'nothing to suggest');
  ok('a product already over the target is not nagged about');

  // With no target set — the default — nothing is invented.
  const quiet = shop();
  const plain = quiet.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  const third = priceAdvice(quiet.getState(), quiet.movements, plain.id);
  assert.strictEqual(third.suggestions.length, 0, 'no history, no target, nothing to say');
  ok('with no target set MyVault does not invent one');
}

// ============================= a suggestion equal to the price is not a suggestion
{
  // Exactly on the target: 12,40 nets to 10,00 against a cost of 6,00, which is
  // the 40% asked for to the cent. Nothing to suggest — and in particular not
  // the same 12,40 back again, which is what an off-by-one boundary would do.
  const store = shop({ targetMargin: 40 });
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 12.40, cost: 6.00 });
  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.margin, 40);
  assert.strictEqual(advice.suggestions.length, 0);

  // A cent under, and it is below target and does get a suggestion — which must
  // not be the price it already has.
  const under = store.addItem({ name: 'Raki', quantity: 10, price: 12.35, cost: 6.00 });
  const second = priceAdvice(store.getState(), store.movements, under.id);
  assert.strictEqual(second.margin, 39.8, '12,35 nets to 9,96');
  assert.strictEqual(find(second, 'target').price, 12.40);
  ok('a price exactly on the target is left alone, and one a cent under is not');
}

// ==================================================== the whole shop at once
{
  const store = shop({ targetMargin: 45 });

  const cheap = store.addItem({ name: 'Cheaper', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, cheap.id, 10, 6.00);
  deliver(store, cheap.id, 10, 6.00);
  deliver(store, cheap.id, 10, 4.80);

  const dear = store.addItem({ name: 'Dearer', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, dear.id, 10, 6.00);
  deliver(store, dear.id, 10, 6.00);
  deliver(store, dear.id, 10, 7.20);

  const loss = store.addItem({ name: 'Losing', quantity: 0, price: 5.00, cost: 6.00 });
  deliver(store, loss.id, 10, 6.00);
  deliver(store, loss.id, 10, 6.00);

  // 40% against a target of 45%, and no cost change to report.
  const flat = store.addItem({ name: 'Thin', quantity: 10, price: 12.40, cost: 6.00 });

  // Comfortably over the target, nothing to say.
  store.addItem({ name: 'Fine', quantity: 10, price: 24.80, cost: 6.00 });

  const review = priceReview(store.getState(), store.movements);
  assert.strictEqual(review.target, 45);
  assert.deepStrictEqual(review.counts, {
    cheaper: 1, dearer: 1, thin: 1, losing: 1, items: 5,
  });
  assert.strictEqual(review.cheaper[0].name, 'Cheaper');
  assert.strictEqual(review.dearer[0].name, 'Dearer');
  assert.strictEqual(review.losing[0].name, 'Losing');
  assert.strictEqual(review.thin[0].name, 'Thin');
  ok('the price review sorts the shop into cheaper, dearer, thin and losing money');

  // Each product appears in exactly one list: a product being sold at a loss is
  // not also filed under "bought cheaply".
  const everywhere = [...review.cheaper, ...review.dearer, ...review.thin, ...review.losing]
    .map((line) => line.id);
  assert.strictEqual(new Set(everywhere).size, everywhere.length, 'no product in two lists');
  ok('no product turns up on two lists at once');

  // The review reads the log once and buckets it; a single product read straight
  // from the log must give the identical answer.
  for (const listed of [...review.cheaper, ...review.dearer, ...review.losing, ...review.thin]) {
    const direct = priceAdvice(store.getState(), store.movements, listed.id);
    assert.deepStrictEqual(
      { margin: listed.margin, change: listed.change, suggestions: listed.suggestions },
      { margin: direct.margin, change: direct.change, suggestions: direct.suggestions },
      `${listed.name}: the list and the product's own page disagree`,
    );
  }
  ok('the whole-shop list and a single product\'s own answer are identical');

  assert.strictEqual(priceAdvice(store.getState(), store.movements, 'nope'), null);
  assert.strictEqual(priceReview({ items: [], settings: {} }, store.movements).counts.items, 0);
  ok('an unknown product and an empty shop both answer without complaint');

  // The list of a product with no deliveries at all still carries its margin.
  assert.strictEqual(review.thin[0].history.deliveries, 0);
  assert.strictEqual(review.thin[0].margin, 40);
  ok('a product that has never been delivered still gets a margin from its cost on file');

  void flat;
}

// ============================ the moment it matters: just after the delivery
{
  const store = shop();
  const cheap = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  const same = store.addItem({ name: 'Raki', quantity: 0, price: 9.30, cost: 5.00 });
  for (let time = 0; time < 2; time += 1) {
    deliver(store, cheap.id, 10, 6.00);
    deliver(store, same.id, 10, 5.00);
  }

  // Today's delivery: one line cheaper, one at the usual price.
  let draft = store.startDraft({ kind: 'in' });
  store.updateDraft(draft.id, { number: '4418', supplier: 'Κάβα Πατέλ' });
  store.setDraftLine(draft.id, { itemId: cheap.id, quantity: 20, unitPrice: 4.80 });
  draft = store.setDraftLine(draft.id, { itemId: same.id, quantity: 10, unitPrice: 5.00 });
  const posted = store.postDraft(draft.id, {});

  const review = deliveryReview(store.getState(), store.movements, posted.document);
  assert.strictEqual(review.number, '4418');
  assert.strictEqual(review.supplier, 'Κάβα Πατέλ');
  assert.strictEqual(review.lines.length, 1, 'only the line that actually changed');
  assert.strictEqual(review.lines[0].name, 'Ouzo');
  assert.strictEqual(review.cheaper, 1);
  assert.strictEqual(review.dearer, 0);
  assert.strictEqual(review.saving, 24.00, '1,20 off each of twenty');
  ok('posting a delivery reports which lines came in at a different price, and what it is worth');

  // An outgoing invoice has no cost prices on it and nothing to say.
  const out = store.startDraft({ kind: 'out' });
  store.setDraftLine(out.id, { itemId: cheap.id, quantity: 1 });
  const sold = store.postDraft(out.id, {});
  assert.deepStrictEqual(deliveryReview(store.getState(), store.movements, sold.document), { lines: [] });
  assert.deepStrictEqual(deliveryReview(store.getState(), store.movements, null), { lines: [] });
  ok('a customer invoice is not run through the cost review, and nor is nothing at all');
}

// ==================================================== rounding, style by style
{
  const table = [
    // value      none    nearest05  nearest10  ends9   ends99
    [2.3871, 2.39, 2.40, 2.40, 2.39, 1.99],
    [9.9736, 9.97, 9.95, 10.00, 9.99, 9.99],
    [12.50, 12.50, 12.50, 12.50, 12.49, 12.99],
  ];
  for (const [value, ...expected] of table) {
    ROUNDING_STYLES.forEach((style, index) => {
      assert.strictEqual(
        tidy(value, style), expected[index],
        `${value} in ${style} should be ${expected[index]}`,
      );
    });
  }
  assert.strictEqual(tidy(2.3871, 'nonsense'), 2.40, 'an unknown style falls back to five cents');
  ok('every rounding style rounds the way its name says');

  // The style is read from the settings, and a bad one in a hand-edited file
  // cannot get through.
  const store = shop({ priceRounding: 'ends9' });
  assert.strictEqual(store.getState().settings.priceRounding, 'ends9');
  store.updateSettings({ priceRounding: 'whatever' });
  assert.strictEqual(store.getState().settings.priceRounding, 'nearest05');
  store.updateSettings({ targetMargin: 250 });
  assert.strictEqual(store.getState().settings.targetMargin, 95, 'clamped to something reachable');
  store.updateSettings({ targetMargin: -10 });
  assert.strictEqual(store.getState().settings.targetMargin, 0);
  ok('the rounding style and target margin are validated on the way in');
}

// ============================================== and it holds up at real volume
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  // Five years of weekly deliveries.
  for (let week = 260; week >= 1; week -= 1) {
    store.movements.record({
      itemId: item.id, itemName: 'Ouzo', delta: 12, quantityAfter: 12,
      reason: 'delivery', price: 12.40, cost: week === 1 ? 4.80 : 6.00, vatRate: 24,
    }, new Date(Date.now() - week * 7 * 86400000));
  }
  // Posting a delivery sets the product's cost to what that delivery charged.
  // These movements were written straight to the log to build five years in a
  // loop, so the cost is set by hand to match — otherwise the product looks like
  // one whose cost the shop has typed over, and the comparison is suppressed on
  // purpose.
  store.updateItem(item.id, { cost: 4.80 });

  const history = costHistory(store.movements, item.id);
  assert.strictEqual(history.length, 24, 'only the recent deliveries are held');
  assert.strictEqual(history[history.length - 1].cost, 4.80, 'and the latest is one of them');

  const started = Date.now();
  const advice = priceAdvice(store.getState(), store.movements, item.id);
  const took = Date.now() - started;
  assert.strictEqual(advice.history.usual, 6.00);
  assert.strictEqual(advice.change.kind, 'cheaper');
  assert.ok(took < 1000, `260 deliveries took ${took}ms`);
  console.log(`      260 deliveries → usual 6,00, latest 4,80, in ${took}ms`);
  ok('five years of deliveries stays bounded in memory and quick to read');
}

// ================================================= advice that contradicts itself
{
  // Bought cheaper than usual and still sold below cost are both true at once.
  // The screen used to offer "leave the price alone — it earns you more" beside
  // "you are selling this at a loss", which is advice that cancels itself out.
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 5.00, cost: 8.00 });
  deliver(store, item.id, 10, 8.00);
  deliver(store, item.id, 10, 8.00);
  deliver(store, item.id, 10, 6.00); // 25% cheaper, still dearer than the 5,00 price

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.ok(advice.losing, '6,00 net against a price that nets 4,03');
  assert.strictEqual(advice.change.kind, 'cheaper', 'the bargain is still reported');
  assert.deepStrictEqual(
    advice.suggestions.map((entry) => entry.kind), ['cover'],
    'but the only thing to do about it is stop losing money',
  );
  ok('a product sold at a loss is never also told to leave its price alone');
}

// ============================================ priced at nothing, costing money
{
  // Not "losing money" by any test that starts from the price — there is no
  // price. Ringing it up hands the stock over for nothing, which is the most
  // expensive line in the shop, and it used to appear on no list at all.
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 10, price: 0, cost: 5.00 });

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.margin, null, 'unpriced still has no margin');
  assert.ok(advice.losing, 'but it is certainly not making money');
  assert.strictEqual(advice.suggestions[0].kind, 'cover');
  assert.ok(advice.suggestions[0].price >= 5.00, `suggested ${advice.suggestions[0].price}`);

  const review = priceReview(store.getState(), store.movements, {});
  assert.strictEqual(review.counts.losing, 1, 'and it is on a list');
  ok('a product with a real cost and no price is caught rather than overlooked');

  // A genuinely free product — no cost either — is not nagged about.
  const free = store.addItem({ name: 'Bag', quantity: 100, price: 0, cost: 0 });
  const second = priceAdvice(store.getState(), store.movements, free.id);
  assert.strictEqual(second.losing, false, 'nothing costs nothing');
  assert.strictEqual(second.suggestions.length, 0);
  ok('and something that genuinely costs nothing is left alone');
}

// ========================================= a cost the shop has typed over itself
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 4.80);

  assert.strictEqual(
    priceAdvice(store.getState(), store.movements, item.id).change.kind, 'cheaper',
    'reported while the delivery is what decides the cost',
  );

  // Now the shop corrects the cost by hand — carriage, or a rebate, or simply
  // knowing better. The margin is worked out from 9,00 while the badge would
  // still be describing an invoice that no longer decides anything, and the two
  // shown side by side read as a contradiction.
  store.updateItem(item.id, { cost: 9.00 });
  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.cost, 9.00);
  assert.strictEqual(advice.change, null, 'so nothing is claimed about the change');
  assert.strictEqual(advice.history.last, 4.80, 'though the delivery is still on record');
  ok('a hand-typed cost silences the comparison rather than contradicting it');
}

// ============================================ a delivery the shop has cancelled
{
  const store = shop();
  const item = store.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(store, item.id, 10, 6.00);
  deliver(store, item.id, 10, 6.00);
  // A cost typed with the decimal point in the wrong place.
  const typo = deliver(store, item.id, 10, 0.01);
  assert.strictEqual(store.getState().items[0].cost, 0.01, 'which posting duly believed');

  store.voidDocument(typo.document.id, {});

  // Voiding put the stock back. It has to put the cost back too, or the shelves
  // stay valued at a price nobody paid and every margin reads as enormous.
  assert.strictEqual(store.getState().items[0].cost, 6.00, 'back to the delivery before it');
  assert.strictEqual(store.getState().items[0].quantity, 20, 'and the stock went back as well');

  const advice = priceAdvice(store.getState(), store.movements, item.id);
  assert.strictEqual(advice.history.deliveries, 2, 'the cancelled one is not a price we paid');
  assert.strictEqual(advice.history.last, 6.00);
  assert.strictEqual(advice.history.lowest, 6.00, 'and cannot drag the range down either');
  assert.strictEqual(advice.change, null);
  assert.strictEqual(advice.margin, 40, 'the margin is the one it always was');
  ok('a voided delivery leaves neither its cost on the product nor its price in the history');

  // A cost the shop has since changed on purpose is not overwritten by a void.
  const other = shop();
  const second = other.addItem({ name: 'Raki', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(other, second.id, 10, 6.00);
  const wrong = deliver(other, second.id, 10, 3.00);
  other.updateItem(second.id, { cost: 7.50 });
  other.voidDocument(wrong.document.id, {});
  assert.strictEqual(
    other.getState().items[0].cost, 7.50,
    'the shop\'s own figure is not replaced by a void',
  );
  ok('and a void does not overwrite a cost the shop typed itself');
}

// ====================================== one pass of the log, not one per line
{
  // The delivery review runs the moment an invoice is posted, so its cost is
  // paid by a shopkeeper watching the screen. Asking per line meant thirty
  // passes over the shop's whole history for a thirty-line note.
  const store = shop();
  const ids = [];
  for (let n = 0; n < 30; n += 1) {
    const made = store.addItem({ name: 'P' + n, quantity: 0, price: 10, cost: 5 });
    ids.push(made.id);
    deliver(store, made.id, 10, 5);
    deliver(store, made.id, 10, 5);
  }
  for (let n = 0; n < 20000; n += 1) {
    store.movements.record({
      itemId: ids[n % 30], itemName: 'P', delta: -1, quantityAfter: 0,
      reason: 'sale', price: 10, cost: 5, vatRate: 24,
    }, new Date(Date.now() - n * 60000));
  }

  const draft = store.startDraft({ kind: 'in' });
  for (const id of ids) store.setDraftLine(draft.id, { itemId: id, quantity: 10, unitPrice: 4 });
  const posted = store.postDraft(draft.id, {});

  const startedOne = Date.now();
  const review = deliveryReview(store.getState(), store.movements, posted.document);
  const one = Date.now() - startedOne;

  const startedAll = Date.now();
  priceReview(store.getState(), store.movements, {});
  const all = Date.now() - startedAll;

  assert.strictEqual(review.lines.length, 30, 'every line came in cheaper');
  assert.ok(
    one <= all * 2,
    `reviewing one 30-line delivery took ${one}ms against ${all}ms for the whole shop`,
  );
  console.log(`      30-line delivery reviewed in ${one}ms; whole shop in ${all}ms`);
  ok('reviewing a delivery costs one pass of the log, not one per line');

  // And the same product twice on one note is one product, not two rows.
  const twice = shop();
  const single = twice.addItem({ name: 'Ouzo', quantity: 0, price: 12.40, cost: 6.00 });
  deliver(twice, single.id, 10, 6.00);
  deliver(twice, single.id, 10, 6.00);
  const both = twice.startDraft({ kind: 'in' });
  twice.setDraftLine(both.id, { itemId: single.id, quantity: 10, unitPrice: 4.80 });
  twice.setDraftLine(both.id, { itemId: single.id, quantity: 5, unitPrice: 4.80, lineId: 99 });
  const two = twice.postDraft(both.id, {});
  assert.strictEqual(
    deliveryReview(twice.getState(), twice.movements, two.document).lines.length, 1,
    'two lines of one product is still one product',
  );
  ok('a product on two lines of the same note is reported once');
}

// ============================================ and the printout is safe to print
{
  // The page is built in the main process and every value is escaped there. A
  // product name comes off a barcode scan or a supplier's CSV, so it is not
  // trusted input — this is the same check the other printable documents get.
  const html = buildDocument('prices', {
    title: 'Prices',
    shop: '<script>alert(1)</script>',
    sections: [{
      title: 'Bought cheaper than usual',
      rows: [{
        name: 'Ouzo "700ml" & <b>more</b>',
        price: '12,40', cost: '4,80', usual: '6,00', margin: '52%', suggested: '9,90',
      }],
    }],
    target: '40%',
    labels: { product: 'Product', price: 'Price', cost: 'Cost', usual: 'Usually', margin: 'Margin', suggested: 'Suggested', targetLabel: 'Target margin:', caveat: 'Suggestions only.' },
  });

  assert.ok(html.includes('Bought cheaper than usual'));
  assert.ok(html.includes('&lt;script&gt;'), 'the shop name is escaped');
  assert.ok(!html.includes('<script>alert'), 'and never rendered as markup');
  assert.ok(html.includes('Ouzo &quot;700ml&quot; &amp; &lt;b&gt;more&lt;/b&gt;'), 'nor is a product name');
  assert.ok(html.includes('40%'), 'the target is shown');
  ok('the printed price review escapes every value that reaches the page');

  let refused = '';
  try { buildDocument('nonsense', {}); } catch (error) { refused = error.message; }
  assert.ok(refused.includes('no printable document'), refused);
  ok('and an unknown document name is refused rather than guessed at');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
