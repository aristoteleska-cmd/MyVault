'use strict';

/**
 * What to charge, and what it is really costing.
 *
 * A shop already knows what it paid for the last delivery — the invoice is in
 * MyVault. What it does not know without doing the arithmetic by hand is what
 * that means for the shelf. Two situations in particular go unnoticed for
 * months, and both cost money:
 *
 *   Bought cheaper than usual. The supplier ran a deal, or the shop bought a
 *   bigger box. Nothing on any screen changes, so the shop either never notices
 *   the extra margin it is earning, or drops the shelf price to celebrate and
 *   forgets to put it back when the next delivery arrives at the old price.
 *
 *   Bought dearer than usual. The cost crept up over three deliveries and the
 *   shelf price never moved. This is the one that quietly turns a product into a
 *   loss, and it is invisible precisely because nothing happened — no alert
 *   fires when a number stays the same.
 *
 * So this file answers three questions per product: what do I normally pay, what
 * did I pay this time, and what would I have to charge to keep the margin I had.
 * Nothing here is stored. It is all read back out of the movement log, which
 * already records the cost on every delivery, so a shop that has been running
 * for two years gets two years of cost history without having opted into
 * anything.
 *
 * Two rules the arithmetic follows, because getting either wrong makes every
 * number on the screen a lie:
 *
 *   Margin is on the net price. With VAT switched on, a shelf price of 12,40
 *   contains 2,40 that was never the shop's money. A margin worked out against
 *   the gross would flatter every product in the shop by the VAT rate.
 *
 *   A suggestion is a suggestion. MyVault does not change a price. It works out
 *   what the price would have to be and puts it next to the current one; the
 *   shop presses the button, or does not, because a shopkeeper knows about the
 *   competitor down the road and this file does not.
 */

const { normalizeRate, rateFor } = require('./vat');

/**
 * How far below the usual cost a delivery has to land, as a percentage, before
 * it is worth calling a discount. Below this it is rounding, a currency
 * conversion, or a supplier shaving a cent — not news.
 *
 * Compared against the percentage as rounded for display, not the raw division.
 * Thirty cents off six euros is five per cent, but 0,3 / 6 in binary comes to
 * 0,049999999999999996 — so an exact-threshold delivery would be shown to the
 * shop as "5% cheaper" and then not counted as a discount.
 */
const DISCOUNT_THRESHOLD = 5;

/** How far above the usual cost before the margin is worth warning about. */
const RISE_THRESHOLD = 5;

/**
 * Ways a shop likes prices to end.
 *
 *   none       to the cent, exactly as calculated
 *   nearest05  to five cents — a kiosk with a coin tray
 *   nearest10  to ten cents
 *   ends9      to the nearest price ending in 9 cents: 2,39, 2,49
 *   ends99     to the nearest whole unit less a cent: 2,99, 3,99
 *
 * ends99 only makes sense on something priced in euros rather than cents: on a
 * cheap line the nearest ,99 can be half a euro away from what the margin asked
 * for. Which is why every suggestion reports the margin the rounded price
 * actually earns rather than the one it was worked out from.
 */
const ROUNDING_STYLES = ['none', 'nearest05', 'nearest10', 'ends9', 'ends99'];

/** How many products each list on the price review holds. */
const MAX_LIST = 12;

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function percent(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

/** Strips VAT out of an amount, or leaves it alone if there was none in it. */
function netOf(amount, rate, inclusive) {
  const gross = Number(amount) || 0;
  const r = normalizeRate(rate) ?? 0;
  if (!inclusive || r <= 0) return money(gross);
  return money(gross - gross * (r / (100 + r)));
}

/** Puts VAT back on, for turning a net price into something to put on a label. */
function grossOf(net, rate, inclusive) {
  const amount = Number(net) || 0;
  const r = normalizeRate(rate) ?? 0;
  if (!inclusive || r <= 0) return money(amount);
  return money(amount * (1 + r / 100));
}

/**
 * Rounds a suggested price to something a shop would actually write on a label.
 *
 * A price of 2,3871 is arithmetic, not a price. Which ending a shop wants is a
 * matter of what they sell — a kiosk rounds to five cents, a clothes shop ends
 * everything in 99 — so it is a setting rather than a decision made here.
 */
/** How far apart two prices can be in each style, and the smallest each allows. */
const STEPS = {
  none: { step: 0.01, smallest: 0.01 },
  nearest05: { step: 0.05, smallest: 0.05 },
  nearest10: { step: 0.10, smallest: 0.10 },
  ends9: { step: 0.10, smallest: 0.09 },
  ends99: { step: 1.00, smallest: 0.99 },
};

function tidy(value, style = 'nearest05') {
  const amount = Math.max(0, Number(value) || 0);
  const { smallest } = STEPS[style] || STEPS.nearest05;

  let rounded;
  switch (style) {
    case 'none':
      rounded = money(amount);
      break;
    case 'nearest10':
      rounded = money(Math.round(amount * 10) / 10);
      break;
    case 'ends9':
      // The nearest price whose last digit is a 9, so never more than five cents
      // from the figure the margin asked for.
      rounded = money((Math.round((amount * 100 - 9) / 10) * 10 + 9) / 100);
      break;
    case 'ends99': {
      // The nearest whole unit less a cent, which on a cheap line can be a long
      // way from what was asked for — hence the note on ROUNDING_STYLES.
      const below = money(Math.floor(amount) - 0.01);
      const above = money(Math.floor(amount) + 0.99);
      rounded = Math.abs(amount - below) <= Math.abs(above - amount) ? below : above;
      break;
    }
    case 'nearest05':
    default:
      rounded = money(Math.round(amount * 20) / 20);
      break;
  }

  // Rounding must never produce a price of nothing, or a negative one: on a
  // three-cent product every style but "none" would otherwise round to zero or
  // below, and a suggestion to give the stock away is not a suggestion.
  return rounded < smallest ? money(smallest) : rounded;
}

/**
 * Rounds the shop's way, but never below a floor.
 *
 * Used for the one suggestion where rounding down would defeat the suggestion:
 * a price meant to stop a product being sold at a loss must not be tidied back
 * under the cost it exists to cover. If the shop's chosen ending cannot clear
 * the floor at all, covering the cost wins and the ending is abandoned — a tidy
 * price that still loses money is the wrong answer.
 */
function tidyAtLeast(value, style, minimum) {
  const floor = money(Math.max(0, Number(minimum) || 0));
  const { step } = STEPS[style] || STEPS.nearest05;

  let result = tidy(Math.max(Number(value) || 0, floor), style);
  for (let attempt = 0; result < floor && attempt < 3; attempt += 1) {
    result = tidy(result + step, style);
  }
  return result < floor ? floor : result;
}

/**
 * The margin a price earns over a cost, as a percentage of the price.
 *
 * Null rather than zero when there is no price, because "no margin" and "no
 * price yet" are different things and a screen showing 0% for an unpriced
 * product is telling the shop something untrue.
 */
function marginOf(netPrice, netCost) {
  const price = Number(netPrice) || 0;
  if (price <= 0) return null;
  return percent(((price - (Number(netCost) || 0)) / price) * 100);
}

/** The same relationship the other way up, because shops think in both. */
function markupOf(netPrice, netCost) {
  const cost = Number(netCost) || 0;
  if (cost <= 0) return null;
  return percent((((Number(netPrice) || 0) - cost) / cost) * 100);
}

/**
 * The net price that would earn a given margin on a given cost.
 *
 * A margin of 100% or more is not reachable at any price — the price would have
 * to be infinite — so it is refused rather than approximated.
 */
function priceForMargin(netCost, marginPercent) {
  const cost = Math.max(0, Number(netCost) || 0);
  const target = Number(marginPercent) || 0;
  if (target >= 100) return null;
  if (target <= 0) return money(cost);
  return money(cost / (1 - target / 100));
}

/**
 * The median of a list of costs.
 *
 * Median rather than average, because a shop's cost history is exactly the kind
 * of list an average lies about: one panic-buy at triple the price drags the
 * mean up for a year, while the middle value stays where the shop actually
 * lives.
 */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return money(sorted[middle]);
  return money((sorted[middle - 1] + sorted[middle]) / 2);
}

/** How many deliveries per product are held in memory while working this out. */
const HISTORY_LIMIT = 24;

/**
 * One pass of the log, bucketing what each product has cost into a list.
 *
 * Everything here reads the log exactly once. That is not a detail: asking this
 * question per product instead meant a thirty-line delivery took thirty passes
 * over a shop's entire history, and on five years of movements that was two and
 * a half seconds of frozen window every time an invoice was posted.
 *
 * Only deliveries count. An opening count carries whatever cost was typed when
 * the product was created, which is a guess at worst and a memory at best — and
 * a stock-take correction carries a cost so the shrinkage can be valued, not
 * because anything was bought. Neither is a price a supplier charged.
 *
 * Nor is a delivery the shop has since voided. Voiding sends the goods back to
 * the supplier and writes a correction naming the invoice, so those invoices are
 * collected on the way past and their lines dropped at the end — otherwise a
 * mistyped cost the shop had already cancelled would still count as a price it
 * paid, and would drag the "usual" figure with it for months.
 */
function deliveriesByItem(log, ids) {
  const wanted = ids ? new Set(ids) : null;
  const buckets = new Map();
  const reversed = new Set();

  log.forEach({}, (entry) => {
    if (wanted && !wanted.has(entry.itemId)) return;
    const delta = Number(entry.delta) || 0;

    if (entry.reason === 'correction' && delta < 0 && entry.docId) {
      reversed.add(entry.docId);
      return;
    }
    if (entry.reason !== 'delivery' || delta <= 0) return;

    const bucket = buckets.get(entry.itemId) || [];
    bucket.push({
      itemId: entry.itemId,
      at: entry.at,
      units: delta,
      cost: money(entry.cost),
      docId: entry.docId || '',
    });
    // Bounded like every other read of the log: a ten-year shop must not have
    // to hold a decade of deliveries in memory to be told what it usually pays.
    if (bucket.length > HISTORY_LIMIT * 2) bucket.splice(0, bucket.length - HISTORY_LIMIT);
    buckets.set(entry.itemId, bucket);
  });

  for (const [id, list] of buckets) {
    buckets.set(id, list
      .filter((entry) => !entry.docId || !reversed.has(entry.docId))
      .slice(-HISTORY_LIMIT));
  }
  return buckets;
}

/** Everything the log knows about what one product has cost. */
function costHistory(log, itemId) {
  const wanted = String(itemId || '');
  if (!wanted) return [];
  return deliveriesByItem(log, [wanted]).get(wanted) || [];
}

/**
 * What a product usually costs, what it cost this time, and whether that is a
 * change worth telling the shop about.
 *
 * "Usually" deliberately excludes the most recent delivery. Judging the latest
 * delivery against a figure it is itself part of blunts exactly the signal being
 * looked for — buy cheap three times and cheap becomes the norm, so the fourth
 * cheap delivery looks like business as usual and the shop is never told its
 * margin moved.
 */
function costProfile(log, item, settings = {}) {
  const history = costHistory(log, item?.id);
  const costsInclude = Boolean(settings.costsIncludeVat);
  const rate = rateFor(item, settings);

  const entered = money(item?.cost);
  const profile = {
    deliveries: history.length,
    /** As typed, in the same terms the shop enters costs. */
    cost: entered,
    /** With any VAT taken back out, which is what margins are worked out on. */
    netCost: netOf(entered, rate, costsInclude),
    last: null,
    lastAt: '',
    lastUnits: 0,
    usual: null,
    lowest: null,
    highest: null,
    change: null,
  };

  if (history.length === 0) return profile;

  const latest = history[history.length - 1];
  const costs = history.map((entry) => entry.cost);
  profile.last = latest.cost;
  profile.lastAt = latest.at;
  profile.lastUnits = latest.units;
  profile.lowest = money(Math.min(...costs));
  profile.highest = money(Math.max(...costs));

  const earlier = costs.slice(0, -1);
  profile.usual = earlier.length > 0 ? median(earlier) : null;

  // One delivery is a fact, not a pattern. Without something earlier to compare
  // against there is no such thing as "cheaper than usual", and saying otherwise
  // would put a discount badge on every product the first time it was delivered.
  if (profile.usual === null || profile.usual <= 0) return profile;

  // And nothing is said at all once the shop has typed its own cost over the
  // one the delivery set. The two figures then measure different things — the
  // margin is worked out from what the shop says it costs, while the badge would
  // be describing an invoice that no longer decides anything — and showing them
  // side by side reads as a contradiction, because it is one.
  if (profile.cost !== latest.cost) return profile;

  const difference = money(latest.cost - profile.usual);
  // The one figure, rounded once, used both for the decision and for the screen —
  // so the shop can never be shown a percentage that the threshold disagreed with.
  const moved = percent((Math.abs(difference) / profile.usual) * 100);

  if (difference < 0 && moved >= DISCOUNT_THRESHOLD) {
    profile.change = {
      kind: 'cheaper',
      from: profile.usual,
      to: latest.cost,
      difference,
      percent: moved,
      at: latest.at,
      units: latest.units,
      /** What the deal was worth across the whole delivery. */
      saving: money(Math.abs(difference) * latest.units),
    };
  } else if (difference > 0 && moved >= RISE_THRESHOLD) {
    profile.change = {
      kind: 'dearer',
      from: profile.usual,
      to: latest.cost,
      difference,
      percent: moved,
      at: latest.at,
      units: latest.units,
      /** What the rise costs across the whole delivery. */
      saving: money(-Math.abs(difference) * latest.units),
    };
  }

  return profile;
}

/**
 * What to charge for one product, and why.
 *
 * The suggestions are ordered by what a shop most often ought to do, not by
 * size, and each one carries the margin it would earn so the choice is made on
 * the number rather than on the wording.
 */
function priceAdvice(db, log, itemId) {
  const settings = db.settings || {};
  const item = (db.items || []).find((candidate) => candidate.id === itemId);
  if (!item) return null;

  const pricesInclude = settings.pricesIncludeVat !== false;
  const rounding = ROUNDING_STYLES.includes(settings.priceRounding)
    ? settings.priceRounding : 'nearest05';
  const rate = rateFor(item, settings);
  const profile = costProfile(log, item, settings);

  const price = money(item.price);
  const netPrice = netOf(price, rate, pricesInclude);
  const marginNow = marginOf(netPrice, profile.netCost);

  const advice = {
    id: item.id,
    name: item.name,
    barcode: item.barcode || '',
    quantity: Number(item.quantity) || 0,
    vatRate: normalizeRate(rate) ?? 0,
    rounding,
    price,
    netPrice,
    cost: profile.cost,
    netCost: profile.netCost,
    margin: marginNow,
    markup: markupOf(netPrice, profile.netCost),
    /** Per unit, and only ever the shop's own share of it. */
    profit: money(netPrice - profile.netCost),
    history: {
      deliveries: profile.deliveries,
      last: profile.last,
      lastAt: profile.lastAt,
      lastUnits: profile.lastUnits,
      usual: profile.usual,
      lowest: profile.lowest,
      highest: profile.highest,
    },
    change: profile.change,
    /**
     * Selling at or below what it cost, which is worth saying out loud.
     *
     * Keyed off the cost rather than the price, so a product that has a real
     * cost and no price yet is caught. Ringing that one up hands the stock over
     * for nothing, which is the most expensive thing on this screen and used to
     * appear on no list at all.
     */
    losing: profile.netCost > 0 && profile.netCost >= netPrice,
    suggestions: [],
  };

  const suggest = (kind, gross, note, floor = 0) => {
    if (gross === null || !Number.isFinite(gross)) return;
    const tidied = floor > 0 ? tidyAtLeast(gross, rounding, floor) : tidy(gross, rounding);
    if (tidied <= 0) return;
    const net = netOf(tidied, rate, pricesInclude);
    advice.suggestions.push({
      kind,
      price: tidied,
      margin: marginOf(net, profile.netCost),
      profit: money(net - profile.netCost),
      /** What the change would be, so the shop sees the size of the move. */
      difference: money(tidied - price),
      note: note || '',
    });
  };

  const netCostNow = profile.netCost;
  const change = profile.change;

  // Everything a cost change has to say is only worth saying while the product
  // is still making money. Below cost there is exactly one thing to do about it,
  // and offering "leave the price alone" or "pass the saving on" beside "you are
  // selling this at a loss" is advice that cancels itself out.
  if (change && !advice.losing) {
    // The usual cost, netted the same way, so the two margins are comparable.
    const usualNet = netOf(change.from, rate, Boolean(settings.costsIncludeVat));
    const usualMargin = marginOf(netPrice, usualNet);

    if (change.kind === 'cheaper') {
      // Hold first, because it is usually right. The saving is already earned;
      // the only question is whether to give it away.
      advice.suggestions.push({
        kind: 'hold',
        price,
        margin: marginNow,
        profit: money(netPrice - netCostNow),
        difference: 0,
        note: 'earnsExtra',
        /** What holding the price is worth over the batch that arrived cheap. */
        extra: money((usualNet - netCostNow) * change.units),
        wasMargin: usualMargin,
      });

      // Or pass the deal on and keep the margin the product had before it.
      if (usualMargin !== null) {
        suggest('passOn', grossOf(priceForMargin(netCostNow, usualMargin), rate, pricesInclude), 'oneOffCost');
      }
    } else if (usualMargin !== null) {
      // Put the margin back where it was before the cost went up. This is the
      // suggestion the shop never asks for and most needs.
      suggest('restore', grossOf(priceForMargin(netCostNow, usualMargin), rate, pricesInclude), 'costRose');
    }
  }

  // And whatever target the shop has set for itself, if it has set one.
  const target = Number(settings.targetMargin) || 0;
  if (target > 0 && target < 100 && (marginNow === null || marginNow < target)) {
    suggest('target', grossOf(priceForMargin(netCostNow, target), rate, pricesInclude), 'belowTarget');
  }

  // Selling below cost outranks everything else on the list.
  if (advice.losing) {
    const wanted = target > 0 && target < 100 ? target : 0;
    const cover = grossOf(priceForMargin(netCostNow, wanted), rate, pricesInclude);
    // The floor is the cost itself, grossed up the same way, so tidying can
    // never round the suggestion back under the cost it exists to cover.
    const floor = grossOf(netCostNow, rate, pricesInclude);
    advice.suggestions = advice.suggestions.filter((entry) => entry.kind !== 'target');
    suggest('cover', cover, 'belowCost', floor);
    advice.suggestions.sort((a, b) => {
      if (a.kind === b.kind) return 0;
      if (a.kind === 'cover') return -1;
      if (b.kind === 'cover') return 1;
      return 0;
    });
  }

  // A suggestion identical to the price already on the shelf is not a
  // suggestion. Held prices are exempt: saying "leave it alone" is the advice.
  advice.suggestions = advice.suggestions.filter(
    (entry) => entry.kind === 'hold' || entry.price !== price,
  );

  return advice;
}

/**
 * The whole shop, sorted into the four things worth acting on.
 *
 * One pass of the movement log per product would be one pass too many for a
 * shop with two thousand lines, so the log is read once and the deliveries are
 * bucketed by product on the way through.
 */
function priceReview(db, log, { limit = MAX_LIST } = {}) {
  const settings = db.settings || {};
  const items = db.items || [];
  const target = Number(settings.targetMargin) || 0;

  const byItem = deliveriesByItem(log, items.map((item) => item.id));

  const cheaper = [];
  const dearer = [];
  const thin = [];
  const losing = [];
  const cap = Math.min(50, Math.max(1, Number(limit) || MAX_LIST));

  for (const item of items) {
    // Reuse the single-product answer so the screen and the list can never
    // disagree about one product, using the deliveries already gathered above.
    const advice = adviceFromBucket(db, item.id, byItem.get(item.id));
    if (!advice) continue;

    if (advice.losing) losing.push(advice);
    else if (advice.change?.kind === 'cheaper') cheaper.push(advice);
    else if (advice.change?.kind === 'dearer') dearer.push(advice);
    else if (target > 0 && advice.margin !== null && advice.margin < target) thin.push(advice);
  }

  const bySize = (a, b) => Math.abs(b.change?.saving || 0) - Math.abs(a.change?.saving || 0);

  return {
    target,
    rounding: ROUNDING_STYLES.includes(settings.priceRounding)
      ? settings.priceRounding : 'nearest05',
    generatedAt: new Date().toISOString(),
    /** Bought cheaper than usual: either extra margin earned or a promotion. */
    cheaper: cheaper.sort(bySize).slice(0, cap),
    /** Cost went up and the price did not. The quiet one. */
    dearer: dearer.sort(bySize).slice(0, cap),
    /** Below the shop's own target, if it set one. */
    thin: thin.sort((a, b) => (a.margin || 0) - (b.margin || 0)).slice(0, cap),
    /** At or below cost. Every one of these is losing money on every sale. */
    losing: losing.sort((a, b) => a.profit - b.profit).slice(0, cap),
    counts: {
      cheaper: cheaper.length,
      dearer: dearer.length,
      thin: thin.length,
      losing: losing.length,
      items: items.length,
    },
  };
}

/**
 * Presents an already-gathered list of deliveries with the same shape the
 * movement log has, so priceAdvice does not need to know whether it is reading
 * the log or a bucket someone else filled from it.
 */
function bucketReader(entries) {
  const list = entries || [];
  return (options, visit) => {
    for (const entry of list) visit({ ...entry, reason: 'delivery', delta: entry.units });
    return { scanned: list.length };
  };
}

/**
 * A product's advice without re-reading the log, for callers that already have
 * this product's deliveries in hand.
 */
function adviceFromBucket(db, itemId, entries) {
  return priceAdvice(db, { forEach: bucketReader(entries) }, itemId);
}

/**
 * Which lines on a delivery just came in at a different price than usual.
 *
 * Called straight after an invoice is posted, because that is the one moment the
 * shop is looking at the costs and can act on them. Anything else is a report
 * nobody opens.
 */
function deliveryReview(db, log, document) {
  if (!document || document.kind !== 'in') return { lines: [] };

  // One pass for the whole document, not one per line. A thirty-line delivery
  // used to mean thirty passes over the shop's entire history, which on five
  // years of movements froze the window for two and a half seconds at exactly
  // the moment the shop had just pressed Post.
  const ids = (document.lines || []).map((line) => line.itemId);
  const byItem = deliveriesByItem(log, ids);

  const lines = [];
  const seen = new Set();
  for (const line of document.lines || []) {
    // The same product can appear on two lines of one delivery note. It is one
    // product either way, and listing it twice would just double the figures.
    if (seen.has(line.itemId)) continue;
    seen.add(line.itemId);
    const advice = adviceFromBucket(db, line.itemId, byItem.get(line.itemId));
    if (!advice || !advice.change) continue;
    lines.push(advice);
  }

  return {
    number: document.number || '',
    supplier: document.supplier || '',
    lines: lines.sort((a, b) => Math.abs(b.change.saving) - Math.abs(a.change.saving)),
    cheaper: lines.filter((line) => line.change.kind === 'cheaper').length,
    dearer: lines.filter((line) => line.change.kind === 'dearer').length,
    /** Net effect of this delivery's price changes against what is usual. */
    saving: money(lines.reduce((sum, line) => sum + line.change.saving, 0)),
  };
}

module.exports = {
  DISCOUNT_THRESHOLD,
  RISE_THRESHOLD,
  ROUNDING_STYLES,
  MAX_LIST,
  netOf,
  grossOf,
  tidy,
  tidyAtLeast,
  adviceFromBucket,
  marginOf,
  markupOf,
  priceForMargin,
  median,
  costHistory,
  costProfile,
  priceAdvice,
  priceReview,
  deliveryReview,
};
