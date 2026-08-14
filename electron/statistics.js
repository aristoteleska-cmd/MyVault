'use strict';

/**
 * The numbers behind the statistics screen.
 *
 * Two questions are being answered, and they are genuinely different. "What is
 * on my shelves right now, and what is it worth" is answered from the inventory
 * itself. "What actually happened" — what sold, what came in, which day was
 * busy, who bought what — can only be answered from the movement log, because
 * a stock count knows nothing about how it got where it is.
 *
 * Everything here is computed in the main process and handed over as a finished
 * summary. That is on purpose: a shop with three years of history has hundreds
 * of thousands of movements, and sending those across the bridge so the window
 * can add them up would be the one thing that makes this screen unusable. What
 * crosses is a couple of dozen numbers and a few short lists, whatever the size
 * of the shop.
 */

const { split, normalizeRate } = require('./vat');

const MAX_LIST = 8;

/** Days above which a chart is grouped by month instead of by day. */
const DAILY_LIMIT = 92;

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** The local calendar day, because a shop's Tuesday is its own Tuesday. */
function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localMonth(date) {
  return localDay(date).slice(0, 7);
}

/**
 * What is on the shelves, and what it is worth.
 *
 * Retail value is what it would fetch; cost value is what it tied up. Both are
 * worth showing — a shop that has €40,000 on the shelves has usually paid
 * €25,000 for it, and only one of those numbers is the one they owe.
 */
function stockSnapshot(db) {
  const items = db.items || [];
  const defaultThreshold = Number(db.settings?.defaultLowStockThreshold) || 0;
  const categoryById = new Map((db.categories || []).map((c) => [c.id, c]));

  const byCategory = new Map();
  let units = 0;
  let retailValue = 0;
  let costValue = 0;
  let low = 0;
  let out = 0;

  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const retail = quantity * (Number(item.price) || 0);
    const cost = quantity * (Number(item.cost) || 0);

    units += quantity;
    retailValue += retail;
    costValue += cost;

    // The same rule the stock list colours its rows by, so the count on this
    // screen and the badges over there can never disagree.
    const threshold = item.lowStockThreshold ?? defaultThreshold;
    if (quantity <= 0) out += 1;
    else if (threshold > 0 && quantity <= threshold) low += 1;

    const key = item.categoryId || '';
    const bucket = byCategory.get(key) || { id: key, items: 0, units: 0, value: 0 };
    bucket.items += 1;
    bucket.units += quantity;
    bucket.value += retail;
    byCategory.set(key, bucket);
  }

  const categories = [...byCategory.values()]
    .map((bucket) => ({
      ...bucket,
      value: money(bucket.value),
      name: categoryById.get(bucket.id)?.name || '',
      color: categoryById.get(bucket.id)?.color || '',
    }))
    .sort((a, b) => b.value - a.value);

  // Where the money is sitting. A shop is usually surprised by this one.
  const mostValuable = items
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity) || 0,
      value: money((Number(item.quantity) || 0) * (Number(item.price) || 0)),
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_LIST);

  const needsAttention = items
    .filter((item) => {
      const quantity = Number(item.quantity) || 0;
      const threshold = item.lowStockThreshold ?? defaultThreshold;
      return quantity <= 0 || (threshold > 0 && quantity <= threshold);
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity) || 0,
      threshold: item.lowStockThreshold ?? defaultThreshold,
    }))
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, MAX_LIST);

  return {
    items: items.length,
    units,
    retailValue: money(retailValue),
    costValue: money(costValue),
    // What the shelves would earn if every last one of them sold at today's
    // price. Not a forecast — a ceiling.
    potentialProfit: money(retailValue - costValue),
    low,
    out,
    healthy: Math.max(0, items.length - low - out),
    categories,
    mostValuable,
    needsAttention,
  };
}

/**
 * One streaming pass over a date range, accumulating everything the screen
 * needs.
 *
 * Nothing here holds the movements themselves. The buckets are keyed by day (or
 * month) and by product, so memory follows the size of the shop, not the size
 * of its history.
 */
function accumulate(log, { from, to, byMonth, salesInclude = true }) {
  const perPeriod = new Map();
  const perItem = new Map();
  const perClient = new Map();

  const totals = {
    sold: 0, takings: 0, costOfSales: 0,
    returned: 0, refunded: 0,
    vatCollected: 0, netTakings: 0,
    received: 0, spend: 0,
    corrections: 0, movements: 0,
  };

  const stats = log.forEach({ from, to }, (entry) => {
    const delta = Number(entry.delta) || 0;
    if (!delta) return;
    totals.movements += 1;

    const when = new Date(entry.at);
    const key = byMonth ? localMonth(when) : localDay(when);
    const period = perPeriod.get(key) || { key, sold: 0, takings: 0, received: 0 };

    if (entry.reason === 'sale') {
      const units = -delta;
      const takings = units * (Number(entry.price) || 0);
      totals.sold += units;
      totals.takings += takings;
      totals.costOfSales += units * (Number(entry.cost) || 0);
      // What of that was never the shop's money.
      const parts = split(takings, normalizeRate(entry.vatRate) ?? 0, salesInclude);
      totals.vatCollected += parts.vat;
      totals.netTakings += parts.net;
      period.sold += units;
      period.takings += takings;

      const item = perItem.get(entry.itemId)
        || { id: entry.itemId, name: entry.itemName, units: 0, takings: 0 };
      // The newest name wins: a product renamed last week should appear under
      // the name the shop uses now, not the one it had in January.
      item.name = entry.itemName || item.name;
      item.units += units;
      item.takings += takings;
      perItem.set(entry.itemId, item);

      if (entry.clientId) {
        const client = perClient.get(entry.clientId)
          || { id: entry.clientId, units: 0, takings: 0, orders: 0, lastAt: '' };
        client.units += units;
        client.takings += takings;
        client.orders += 1;
        if (entry.at > client.lastAt) client.lastAt = entry.at;
        perClient.set(entry.clientId, client);
      }
    } else if (entry.reason === 'return') {
      // Stock comes back and money goes out. Counted against the day it was
      // refunded, not against the day of the original sale — the shop's till
      // was short today, and that is the day they will be reconciling.
      const units = Math.abs(delta);
      const refund = units * (Number(entry.price) || 0);
      totals.returned += units;
      totals.refunded += refund;
      const back = split(refund, normalizeRate(entry.vatRate) ?? 0, salesInclude);
      totals.vatCollected -= back.vat;
      totals.netTakings -= back.net;
      period.sold -= units;
      period.takings -= refund;

      // A returned item is not a sale of that product, so it comes back off the
      // best-seller figures too. Otherwise a product bought and returned all
      // month would look like the shop's strongest line.
      const item = perItem.get(entry.itemId);
      if (item) {
        item.units -= units;
        item.takings -= refund;
      }
      const client = entry.clientId ? perClient.get(entry.clientId) : null;
      if (client) {
        client.units -= units;
        client.takings -= refund;
      }
    } else if (delta > 0) {
      totals.received += delta;
      totals.spend += delta * (Number(entry.cost) || 0);
      period.received += delta;
    } else {
      // Stock that left without being sold: a breakage written off, a miscount
      // put right, a product deleted. Worth knowing, and not worth counting as
      // takings.
      totals.corrections += -delta;
    }

    perPeriod.set(key, period);
  });

  return { totals, perPeriod, perItem, perClient, scanned: stats.scanned };
}

/**
 * Everything the statistics screen shows, in one call.
 *
 * The comparison against the period before is what turns a number into news: a
 * shop knows what it took this week, but what it wants to be told is whether
 * that is better or worse than last week.
 */
function report(db, log, { from, to, now = new Date() } = {}) {
  const end = to ? new Date(to) : now;
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 86400000);

  const spanMs = Math.max(86400000, end.getTime() - start.getTime());
  const days = Math.max(1, Math.round(spanMs / 86400000));
  const byMonth = days > DAILY_LIMIT;

  const salesInclude = db.settings?.pricesIncludeVat !== false;
  const current = accumulate(log, {
    from: start.toISOString(), to: end.toISOString(), byMonth, salesInclude,
  });

  // The same length of time, immediately before. Comparing a fortnight against
  // a month would flatter or damn the shop for no reason.
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - spanMs);
  const previous = accumulate(log, {
    from: previousStart.toISOString(),
    to: previousEnd.toISOString(),
    byMonth: true,
    salesInclude,
  });

  const clientName = new Map((db.clients || []).map((c) => [c.id, c.name]));
  const soldIds = new Set(current.perItem.keys());

  return {
    range: {
      from: start.toISOString(),
      to: end.toISOString(),
      days,
      // The chart is per day for a few weeks and per month beyond that; a
      // three-year bar chart with a bar per day is not a chart.
      grouping: byMonth ? 'month' : 'day',
    },

    stock: stockSnapshot(db),

    sales: {
      // Net of refunds, both of them: what the shop actually sold and what it
      // actually took. A gross figure that ignored returns would be a number
      // the till could never be reconciled against.
      units: current.totals.sold - current.totals.returned,
      takings: money(current.totals.takings - current.totals.refunded),
      costOfSales: money(current.totals.costOfSales),
      profit: money(current.totals.takings - current.totals.refunded - current.totals.costOfSales),
      returned: current.totals.returned,
      refunded: money(current.totals.refunded),
      // Shown only when a shop has VAT switched on. Takings above are what went
      // into the till; this is the part of it that belongs to the shop.
      vatCollected: money(current.totals.vatCollected),
      netTakings: money(current.totals.netTakings),
      netProfit: money(current.totals.netTakings - current.totals.costOfSales),
      received: current.totals.received,
      spend: money(current.totals.spend),
      writtenOff: current.totals.corrections,
      movements: current.totals.movements,
    },

    /** The same figures for the period before, so the screen can say "up" or "down". */
    previous: {
      units: previous.totals.sold - previous.totals.returned,
      takings: money(previous.totals.takings - previous.totals.refunded),
      profit: money(previous.totals.takings - previous.totals.refunded - previous.totals.costOfSales),
    },

    /** Oldest first, ready to draw left to right. */
    timeline: [...current.perPeriod.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((period) => ({ ...period, takings: money(period.takings) })),

    bestSellers: [...current.perItem.values()]
      // A product sold three times and returned three times sold nothing.
      .filter((item) => item.units > 0)
      .sort((a, b) => b.units - a.units)
      .slice(0, MAX_LIST)
      .map((item) => ({ ...item, takings: money(item.takings) })),

    /**
     * Stock sitting there unsold for the whole period. The most expensive thing
     * in a small shop is money on a shelf that nobody is buying.
     */
    notMoving: (db.items || [])
      .filter((item) => (Number(item.quantity) || 0) > 0 && !soldIds.has(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: Number(item.quantity) || 0,
        value: money((Number(item.quantity) || 0) * (Number(item.price) || 0)),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_LIST),

    topClients: [...current.perClient.values()]
      .map((client) => ({
        ...client,
        name: clientName.get(client.id) || '',
        takings: money(client.takings),
      }))
      // A customer deleted from the address book still has sales in the log;
      // showing them as a blank row would be a puzzle rather than information.
      .filter((client) => client.name)
      .sort((a, b) => b.takings - a.takings)
      .slice(0, MAX_LIST),
  };
}

/**
 * What to order this morning.
 *
 * The shop already knows what is low; what it does not know without doing the
 * arithmetic by hand is how fast each thing actually sells, and therefore how
 * many to ask for. This joins the two: everything at or under its limit, with a
 * suggested quantity based on what really left the shelf over `days`, grouped
 * by the supplier the order has to be sent to.
 *
 * Deliberately a suggestion and not an instruction. A shopkeeper knows about
 * the bank holiday and the school term; the number is a starting point they can
 * type over.
 */
function reorderList(db, log, { days = 30, cover = 30, now = new Date() } = {}) {
  const from = new Date(now.getTime() - days * 86400000);
  const defaultThreshold = Number(db.settings?.defaultLowStockThreshold) || 0;

  // How many of each actually sold, net of anything handed back.
  const soldByItem = new Map();
  log.forEach({ from: from.toISOString(), to: now.toISOString() }, (entry) => {
    const delta = Number(entry.delta) || 0;
    if (entry.reason === 'sale') {
      soldByItem.set(entry.itemId, (soldByItem.get(entry.itemId) || 0) - delta);
    } else if (entry.reason === 'return') {
      soldByItem.set(entry.itemId, (soldByItem.get(entry.itemId) || 0) - Math.abs(delta));
    }
  });

  const bySupplier = new Map();
  let lines = 0;
  let estimatedCost = 0;

  for (const item of db.items || []) {
    const quantity = Number(item.quantity) || 0;
    const threshold = item.lowStockThreshold ?? defaultThreshold;
    const isLow = quantity <= 0 || (threshold > 0 && quantity <= threshold);
    if (!isLow) continue;

    const sold = Math.max(0, soldByItem.get(item.id) || 0);
    const perDay = sold / days;

    // Enough to cover the next stretch at the rate it has been selling, or —
    // for something with no recent sales but a limit set — enough to get back
    // above that limit. Never less than one, or the line is pointless.
    const forDemand = Math.ceil(perDay * cover) - quantity;
    const toThreshold = threshold > 0 ? (threshold * 2) - quantity : 0;
    const suggested = Math.max(1, forDemand, toThreshold);

    const supplier = (item.supplier || '').trim();
    const key = supplier.toLowerCase();
    const bucket = bySupplier.get(key)
      || { supplier, items: [], units: 0, cost: 0 };

    const cost = Math.round(suggested * (Number(item.cost) || 0) * 100) / 100;
    bucket.items.push({
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      quantity,
      threshold,
      sold,
      suggested,
      cost,
      // Out of stock is a different urgency from merely low: one is a customer
      // being turned away today.
      urgent: quantity <= 0,
    });
    bucket.units += suggested;
    bucket.cost = Math.round((bucket.cost + cost) * 100) / 100;
    bySupplier.set(key, bucket);

    lines += 1;
    estimatedCost += cost;
  }

  const suppliers = [...bySupplier.values()]
    .map((bucket) => ({
      ...bucket,
      // Anything out of stock first, then whatever is selling fastest.
      items: bucket.items.sort((a, b) => (Number(b.urgent) - Number(a.urgent)) || (b.sold - a.sold)),
    }))
    // Named suppliers first; the "no supplier" pile belongs at the bottom.
    .sort((a, b) => {
      if (!a.supplier !== !b.supplier) return a.supplier ? -1 : 1;
      return b.cost - a.cost;
    });

  return {
    days,
    cover,
    generatedAt: now.toISOString(),
    lines,
    suppliers,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    urgent: suppliers.reduce((sum, s) => sum + s.items.filter((i) => i.urgent).length, 0),
  };
}

/**
 * What one customer has bought, and what that adds up to.
 *
 * Read straight from the log rather than kept alongside the contact, so the
 * client list never has to be rewritten when something sells.
 */
function clientHistory(log, clientId, { limit = 100 } = {}) {
  const wanted = String(clientId || '');
  if (!wanted) return { lines: [], units: 0, spent: 0, orders: 0, firstAt: '', lastAt: '' };

  const lines = [];
  let units = 0;
  let spent = 0;
  let orders = 0;
  let firstAt = '';
  let lastAt = '';

  // One pass. The totals cover everything they ever bought — a regular of ten
  // years should not appear to have spent whatever their last hundred purchases
  // came to — while only the most recent lines are kept to put on screen.
  //
  // The filtering happens before the limit is applied, not after: a delivery
  // that happened to fall inside the window must not cost the customer a row.
  log.forEach({}, (entry) => {
    if (entry.clientId !== wanted || entry.reason !== 'sale') return;
    const bought = -(Number(entry.delta) || 0);
    units += bought;
    spent += bought * (Number(entry.price) || 0);
    orders += 1;
    if (!firstAt || entry.at < firstAt) firstAt = entry.at;
    if (entry.at > lastAt) lastAt = entry.at;

    lines.push(entry);
    if (lines.length > limit * 2) lines.splice(0, lines.length - limit);
  });

  return {
    lines: lines.slice(-limit).reverse(),
    units,
    spent: money(spent),
    orders,
    firstAt,
    lastAt,
  };
}

module.exports = {
  report, stockSnapshot, reorderList, clientHistory, MAX_LIST, DAILY_LIMIT,
};
