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
function accumulate(log, { from, to, byMonth }) {
  const perPeriod = new Map();
  const perItem = new Map();
  const perClient = new Map();

  const totals = {
    sold: 0, takings: 0, costOfSales: 0,
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

  const current = accumulate(log, { from: start.toISOString(), to: end.toISOString(), byMonth });

  // The same length of time, immediately before. Comparing a fortnight against
  // a month would flatter or damn the shop for no reason.
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - spanMs);
  const previous = accumulate(log, {
    from: previousStart.toISOString(),
    to: previousEnd.toISOString(),
    byMonth: true,
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
      units: current.totals.sold,
      takings: money(current.totals.takings),
      costOfSales: money(current.totals.costOfSales),
      profit: money(current.totals.takings - current.totals.costOfSales),
      received: current.totals.received,
      spend: money(current.totals.spend),
      writtenOff: current.totals.corrections,
      movements: current.totals.movements,
    },

    /** The same figures for the period before, so the screen can say "up" or "down". */
    previous: {
      units: previous.totals.sold,
      takings: money(previous.totals.takings),
      profit: money(previous.totals.takings - previous.totals.costOfSales),
    },

    /** Oldest first, ready to draw left to right. */
    timeline: [...current.perPeriod.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((period) => ({ ...period, takings: money(period.takings) })),

    bestSellers: [...current.perItem.values()]
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

module.exports = { report, stockSnapshot, clientHistory, MAX_LIST, DAILY_LIMIT };
