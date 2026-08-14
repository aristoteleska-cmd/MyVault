'use strict';

/**
 * The record of what actually happened: every sale, delivery and correction.
 *
 * This is deliberately NOT kept in myvault.json. That file is rewritten in full
 * every time anything changes, which is fine for a few thousand products but
 * ruinous for a history that only ever grows — a shop doing two hundred sales a
 * day would be rewriting a year of history on every press of the minus button.
 *
 * So movements are appended, one JSON object per line, to a file per year. An
 * append costs the same whether the shop opened yesterday or a decade ago, and
 * a year nobody is looking at is never read. Nothing here is loaded when
 * MyVault starts; the file is only opened when somebody asks for statistics or
 * a client's history.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Why the stock moved. The sign of `delta` says which way.
 *
 * `return` and `stocktake` both look like a delivery from the shelf's point of
 * view — something appears — but they mean entirely different things to the
 * takings. A return hands money back; a stock take found what was already
 * there. Neither is a delivery, and lumping them in with one would quietly
 * overstate what the shop bought in.
 */
const REASONS = [
  'sale', 'return', 'delivery', 'correction', 'stocktake',
  'new', 'import', 'delete', 'restore',
];

/**
 * Reading is streamed in chunks rather than with readFileSync, so a large year
 * never has to sit in memory in one piece.
 */
const READ_CHUNK = 1 << 20; // 1 MiB

class MovementLog {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'history');
  }

  fileFor(year) {
    return path.join(this.dir, `movements-${year}.ndjson`);
  }

  /** Which years this shop actually has history for, oldest first. */
  years() {
    try {
      return fs.readdirSync(this.dir)
        .map((name) => /^movements-(\d{4})\.ndjson$/.exec(name))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /**
   * Appends one movement. Never rewrites, never reads — the cost does not grow
   * with the size of the history.
   */
  record({
    itemId, itemName, delta, quantityAfter, reason,
    price = 0, cost = 0, vatRate = 0, clientId = '', docId = '', by = '',
  }, at = new Date()) {
    const amount = Math.trunc(Number(delta) || 0);
    if (!itemId || amount === 0) return null;

    const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

    const entry = {
      id: crypto.randomUUID(),
      at: at.toISOString(),
      itemId: String(itemId),
      // The name is copied in on purpose: a product deleted next year should
      // still be readable in this year's takings.
      itemName: String(itemName || '').slice(0, 120),
      delta: amount,
      after: Math.max(0, Math.trunc(Number(quantityAfter) || 0)),
      reason: REASONS.includes(reason) ? reason : 'correction',
      // The price and cost as they stood at that moment. Reading today's price
      // off the product would rewrite history every time a shop marks something
      // up: last month's takings would silently change.
      price: money(price),
      cost: money(cost),
      // The VAT rate as it stood that day, for the same reason as the price
      // beside it: changing a rate must not rewrite a return already filed.
      vatRate: Math.max(0, Math.min(100, Number(vatRate) || 0)),
      clientId: String(clientId || ''),
      // The invoice this came from, when it came from one. Lets a whole
      // delivery be traced back to the piece of paper that caused it.
      docId: String(docId || ''),
      by: String(by || '').slice(0, 60),
    };

    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.fileFor(at.getUTCFullYear()), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  /**
   * Walks the movements between two dates, oldest first, handing each one to
   * `onEntry`. Only the years that overlap the range are opened at all.
   *
   * A half-written final line — the shop's PC lost power mid-append — is
   * skipped rather than throwing. One lost sale is a far better outcome than a
   * statistics screen that will not open.
   */
  forEach({ from, to } = {}, onEntry) {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    const firstYear = Number.isFinite(start) ? new Date(start).getUTCFullYear() : -Infinity;
    const lastYear = Number.isFinite(end) ? new Date(end).getUTCFullYear() : Infinity;

    let scanned = 0;
    let skipped = 0;

    for (const year of this.years()) {
      if (year < firstYear || year > lastYear) continue;

      let handle;
      try {
        handle = fs.openSync(this.fileFor(year), 'r');
      } catch {
        continue;
      }

      try {
        const buffer = Buffer.allocUnsafe(READ_CHUNK);
        let carry = '';
        let bytes = 0;
        // eslint-disable-next-line no-cond-assign
        while ((bytes = fs.readSync(handle, buffer, 0, READ_CHUNK, null)) > 0) {
          const text = carry + buffer.toString('utf8', 0, bytes);
          const lines = text.split('\n');
          // The last piece may be half a line; hold it until the next chunk.
          carry = lines.pop() ?? '';
          for (const line of lines) {
            if (!line) continue;
            scanned += 1;
            let entry;
            try {
              entry = JSON.parse(line);
            } catch {
              skipped += 1;
              continue;
            }
            const when = Date.parse(entry.at);
            if (!Number.isFinite(when) || when < start || when > end) continue;
            onEntry(entry);
          }
        }
        if (carry.trim()) {
          scanned += 1;
          try {
            const entry = JSON.parse(carry);
            const when = Date.parse(entry.at);
            if (Number.isFinite(when) && when >= start && when <= end) onEntry(entry);
          } catch {
            skipped += 1;
          }
        }
      } finally {
        fs.closeSync(handle);
      }
    }

    return { scanned, skipped };
  }

  /** Convenience for small ranges — a client's history, say. Never for a whole shop. */
  list({ from, to, limit = 500 } = {}) {
    const found = [];
    this.forEach({ from, to }, (entry) => {
      found.push(entry);
      // Keep only the newest `limit`, without holding the whole year.
      if (found.length > limit * 2) found.splice(0, found.length - limit);
    });
    return found.slice(-limit).reverse();
  }

  /** Everything one client ever bought, newest first. */
  forClient(clientId, { limit = 200 } = {}) {
    // Most sales are over the counter with nobody named, and those carry an
    // empty clientId. Matching on a blank would hand every one of them back as
    // though they belonged to a single customer.
    const wanted = String(clientId || '');
    if (!wanted) return [];

    const found = [];
    this.forEach({}, (entry) => {
      if (entry.clientId === wanted) found.push(entry);
      if (found.length > limit * 2) found.splice(0, found.length - limit);
    });
    return found.slice(-limit).reverse();
  }
}

module.exports = { MovementLog, REASONS };
