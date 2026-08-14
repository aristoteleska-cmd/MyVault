'use strict';

/**
 * VAT.
 *
 * The number this file produces is one a shop hands to an accountant and pays
 * out of its own bank account, so it is worth being exact about what is being
 * calculated and what is not.
 *
 * What a retailer owes is **not** the VAT on their sales. It is:
 *
 *     VAT collected on sales  −  VAT paid on purchases  =  VAT payable
 *
 * The second half matters enormously. A shop that sold €10,000 and bought
 * €6,000 of stock owes the difference in VAT, not the whole of the first
 * figure. Reporting only sales VAT would have this shop paying roughly two and
 * a half times what it owes, which is why deliveries are counted here as
 * carefully as sales.
 *
 * The other thing worth stating plainly: in a shop the price on the shelf is
 * what the customer hands over, VAT included. A supplier's invoice is usually
 * the other way round — a net figure with VAT added underneath. Both are
 * settings, because getting either backwards moves every number by about a
 * fifth.
 *
 * This is arithmetic on a shop's own records. It is not tax advice, it does not
 * know about the many special cases a real return can involve, and MyVault says
 * so on the screen as well as here.
 */

/**
 * The Greek rates, which are what this was written for: 24% standard, 13% on
 * most food and some services, 6% on medicines, books and newspapers, and 0 for
 * anything exempt. Any other whole rate can be typed in, so a shop in another
 * country is not stuck.
 */
const SUGGESTED_RATES = [24, 13, 6, 0];

const MAX_RATE = 100;

function round(value) {
  // Rounded to the cent per line, the way a till receipt and an invoice both
  // do it, then summed. Summing unrounded and rounding once at the end drifts
  // from what the paperwork says by a cent or two, and a return that disagrees
  // with the receipts is worse than one that is a cent out.
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** A usable rate, or null when there is nothing sensible to use. */
function normalizeRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) return null;
  return Math.round(rate * 100) / 100;
}

/**
 * The rate that applies to one product: its own if it has one, otherwise the
 * shop's default. A bookshop selling mostly books at 6% but a few pens at 24%
 * sets the default once and overrides the pens.
 */
function rateFor(item, settings) {
  if (!settings?.vatEnabled) return 0;
  const own = normalizeRate(item?.vatRate);
  if (own !== null) return own;
  return normalizeRate(settings?.vatRate) ?? 0;
}

/**
 * Pulls the VAT back out of a price that already contains it.
 *
 * €4.00 at 24% is €3.23 of goods and €0.77 of VAT — not €4.00 plus €0.96. This
 * is the single easiest thing to get backwards, and doing so overstates a
 * shop's liability by about a quarter.
 */
function fromGross(gross, rate) {
  const amount = Number(gross) || 0;
  const percent = normalizeRate(rate) ?? 0;
  if (percent <= 0) return { net: round(amount), vat: 0, gross: round(amount) };
  const vat = round(amount * (percent / (100 + percent)));
  return { net: round(amount - vat), vat, gross: round(amount) };
}

/** Adds VAT to a figure that does not yet include it — a supplier's invoice. */
function fromNet(net, rate) {
  const amount = Number(net) || 0;
  const percent = normalizeRate(rate) ?? 0;
  if (percent <= 0) return { net: round(amount), vat: 0, gross: round(amount) };
  const vat = round(amount * (percent / 100));
  return { net: round(amount), vat, gross: round(amount + vat) };
}

/** Splits an amount whichever way round the shop enters its figures. */
function split(amount, rate, inclusive) {
  return inclusive ? fromGross(amount, rate) : fromNet(amount, rate);
}

/** Accumulates a per-rate breakdown, which is how a VAT return is laid out. */
function bucket(map, rate, { net, vat, gross }, units) {
  const key = String(rate);
  const entry = map.get(key) || { rate, net: 0, vat: 0, gross: 0, units: 0 };
  entry.net = round(entry.net + net);
  entry.vat = round(entry.vat + vat);
  entry.gross = round(entry.gross + gross);
  entry.units += units;
  map.set(key, entry);
}

function summarise(map) {
  const rates = [...map.values()].sort((a, b) => b.rate - a.rate);
  return {
    rates,
    net: round(rates.reduce((sum, r) => sum + r.net, 0)),
    vat: round(rates.reduce((sum, r) => sum + r.vat, 0)),
    gross: round(rates.reduce((sum, r) => sum + r.gross, 0)),
  };
}

/**
 * The whole return for one period, in one streaming pass over the history.
 *
 * Only three kinds of movement touch VAT:
 *
 *   • a sale collects it,
 *   • a return hands it back — it reduces what is owed, and a quarter with more
 *     refunds than sales genuinely produces a negative figure,
 *   • a delivery pays it to a supplier, and that is deductible.
 *
 * Everything else — stock takes, write-offs, corrections, products deleted —
 * is deliberately left out. Whether a write-off requires an input-VAT
 * adjustment is a real question with a real answer that depends on why the
 * stock went, and guessing at it here would put a wrong number on a tax return.
 * They are counted and reported separately so the shop can raise them with
 * their accountant rather than not knowing they exist.
 */
function vatReport(db, log, { from, to, now = new Date() } = {}) {
  const settings = db.settings || {};
  const end = to ? new Date(to) : now;
  const start = from ? new Date(from) : new Date(end.getFullYear(), 0, 1);

  const salesInclude = settings.pricesIncludeVat !== false;
  const costsInclude = Boolean(settings.costsIncludeVat);

  const output = new Map();
  const input = new Map();

  let excluded = 0;
  let excludedUnits = 0;
  let missingRate = 0;

  const stats = log.forEach({ from: start.toISOString(), to: end.toISOString() }, (entry) => {
    const delta = Number(entry.delta) || 0;
    if (!delta) return;

    // The rate as it stood that day. A shop that changes a rate — or turns VAT
    // on for the first time — must not have last year's return rewritten
    // underneath it, exactly as with prices.
    const rate = normalizeRate(entry.vatRate);

    if (entry.reason === 'sale' || entry.reason === 'return') {
      const units = Math.abs(delta);
      if (rate === null) { missingRate += units; return; }
      const amount = units * (Number(entry.price) || 0);
      const parts = split(amount, rate, salesInclude);
      const sign = entry.reason === 'return' ? -1 : 1;
      bucket(output, rate, {
        net: sign * parts.net, vat: sign * parts.vat, gross: sign * parts.gross,
      }, sign * units);
      return;
    }

    if (entry.reason === 'delivery' && delta > 0) {
      if (rate === null) { missingRate += delta; return; }
      const amount = delta * (Number(entry.cost) || 0);
      const parts = split(amount, rate, costsInclude);
      bucket(input, rate, parts, delta);
      return;
    }

    // Counted, named, and kept out of the arithmetic.
    excluded += 1;
    excludedUnits += Math.abs(delta);
  });

  const collected = summarise(output);
  const paid = summarise(input);

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    enabled: Boolean(settings.vatEnabled),
    pricesIncludeVat: salesInclude,
    costsIncludeVat: costsInclude,

    /** VAT charged to customers, broken down by rate the way a return is. */
    collected,
    /** VAT paid to suppliers on stock coming in — deductible. */
    paid,
    /**
     * What the shop actually owes. Negative means more was paid out than taken
     * in, which is a refund position rather than a bill — it happens to a shop
     * that stocked up heavily in a quiet quarter, and it is not an error.
     */
    payable: round(collected.vat - paid.vat),

    /** Movements left out of the sums on purpose, so they are not invisible. */
    excluded: { movements: excluded, units: excludedUnits },
    /**
     * Stock that moved before VAT was switched on, or with no rate recorded.
     * Shown rather than silently treated as zero-rated.
     */
    withoutRate: missingRate,
    movements: stats.scanned,
  };
}

/**
 * The calendar periods a VAT return is actually filed for.
 *
 * Deliberately not the rolling "last 90 days" the statistics screen uses: a
 * return covers January to March, and a figure for the ninety days ending today
 * is not a figure anybody can file.
 */
function vatPeriods(now = new Date()) {
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3);
  const at = (y, q) => ({
    from: new Date(y, q * 3, 1, 0, 0, 0, 0).toISOString(),
    to: new Date(y, q * 3 + 3, 0, 23, 59, 59, 999).toISOString(),
    year: y,
    quarter: q + 1,
  });

  const previousQuarter = quarter === 0 ? at(year - 1, 3) : at(year, quarter - 1);

  return {
    thisQuarter: at(year, quarter),
    lastQuarter: previousQuarter,
    thisYear: {
      from: new Date(year, 0, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(year, 11, 31, 23, 59, 59, 999).toISOString(),
      year,
      quarter: 0,
    },
    lastYear: {
      from: new Date(year - 1, 0, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(year - 1, 11, 31, 23, 59, 59, 999).toISOString(),
      year: year - 1,
      quarter: 0,
    },
  };
}

module.exports = {
  SUGGESTED_RATES,
  MAX_RATE,
  normalizeRate,
  rateFor,
  fromGross,
  fromNet,
  split,
  vatReport,
  vatPeriods,
};
