'use strict';

/**
 * Invoices and delivery notes — a whole piece of paper, posted in one action.
 *
 * Until now stock moved one press at a time. That is right at the till, but
 * wrong for the other half of a shop's day: a delivery arrives with thirty
 * lines on a printed note, and pressing plus thirty times is how a shop ends up
 * not bothering. A document collects the lines first, shows the totals, and
 * posts them together.
 *
 * Two kinds, and the difference is only which way the stock goes:
 *
 *   in   a supplier's invoice or delivery note. Stock arrives, money is owed,
 *        and the VAT on it is deductible.
 *   out  a customer's invoice or receipt. Stock leaves, money comes in, and the
 *        VAT on it is collected.
 *
 * Where they live follows the same rule as the movement log. A draft — the one
 * being typed right now — sits in myvault.json, because there is normally one
 * of them and it has to survive the shop closing the program mid-delivery. A
 * posted document is history: it is appended to a file per year and never
 * rewritten, so a shop's tenth year of invoices costs nothing to carry.
 *
 * Posting is the only thing that touches stock, and it is deliberately not
 * reversible by deletion. A posted invoice that was wrong is voided, which
 * posts the opposite movements — because the stock really did move, and a
 * history that can be edited afterwards is not a history.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['in', 'out'];

const READ_CHUNK = 1 << 20; // 1 MiB, as for the movement log

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function whole(value) {
  const n = Math.round(Number(value) || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The store of posted documents: one file per year, appended to, never edited.
 */
class DocumentLog {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'invoices');
  }

  fileFor(year) {
    return path.join(this.dir, `invoices-${year}.ndjson`);
  }

  years() {
    try {
      return fs.readdirSync(this.dir)
        .map((name) => /^invoices-(\d{4})\.ndjson$/.exec(name))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  append(document) {
    fs.mkdirSync(this.dir, { recursive: true });
    const year = new Date(document.postedAt || Date.now()).getUTCFullYear();
    fs.appendFileSync(this.fileFor(year), `${JSON.stringify(document)}\n`, 'utf8');
    return document;
  }

  /** Oldest first. A torn last line is skipped, exactly as in the movement log. */
  forEach({ from, to } = {}, onDocument) {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    let scanned = 0;
    let skipped = 0;

    for (const year of this.years()) {
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
        const handleLine = (line) => {
          if (!line.trim()) return;
          scanned += 1;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            skipped += 1;
            return;
          }
          const when = Date.parse(parsed.postedAt);
          if (!Number.isFinite(when) || when < start || when > end) return;
          onDocument(parsed);
        };
        // eslint-disable-next-line no-cond-assign
        while ((bytes = fs.readSync(handle, buffer, 0, READ_CHUNK, null)) > 0) {
          const text = carry + buffer.toString('utf8', 0, bytes);
          const lines = text.split('\n');
          carry = lines.pop() ?? '';
          for (const line of lines) handleLine(line);
        }
        if (carry.trim()) handleLine(carry);
      } finally {
        fs.closeSync(handle);
      }
    }
    return { scanned, skipped };
  }

  /** Newest first, for the list on screen. */
  list({ from, to, limit = 100 } = {}) {
    const found = [];
    this.forEach({ from, to }, (document) => {
      found.push(document);
      if (found.length > limit * 2) found.splice(0, found.length - limit);
    });
    return found.slice(-limit).reverse();
  }

  find(id) {
    let match = null;
    this.forEach({}, (document) => {
      if (document.id === id) match = document;
    });
    return match;
  }
}

/**
 * One line, tidied. A line with no product or no quantity is not a line — an
 * invoice with a blank row on it should post the rest rather than refuse.
 */
function normalizeLine(input, { kind }) {
  const quantity = Math.abs(whole(input?.quantity));
  if (!input?.itemId || quantity === 0) return null;
  return {
    itemId: String(input.itemId),
    name: String(input.name || '').slice(0, 160),
    barcode: String(input.barcode || '').slice(0, 64),
    quantity,
    // On a supplier's invoice this is what the shop paid; on a customer's, what
    // the shop charged. Same field, opposite direction — and never below zero,
    // because a negative price on one line quietly subtracts from the total of
    // the whole invoice. A refund is a document the other way round, not a
    // minus sign on a line.
    unitPrice: Math.max(0, money(input.unitPrice)),
    /**
     * A discount on this line, as a percentage, the way real invoices print it.
     *
     * Per line rather than per document because that is how a supplier gives
     * one: 10% off the wine, nothing off the spirits. A hundred per cent is
     * allowed — a line given away free is a real thing, and it still belongs on
     * the paper with its VAT worked out at zero rather than left off.
     */
    discount: Math.max(0, Math.min(100, Math.round((Number(input.discount) || 0) * 100) / 100)),
    vatRate: Math.max(0, Math.min(100, Number(input.vatRate) || 0)),
    kind,
  };
}

/**
 * What one unit of a discounted line actually costs, to the cent.
 *
 * The discount is applied to the unit price and rounded there, not to the line
 * total, and everything downstream is built from this one figure — the invoice
 * totals, the movement written when it posts, and therefore the VAT return.
 *
 * That ordering is deliberate. A movement stores a price per unit, so a VAT
 * return worked out as units × price can only agree with the paper if the paper
 * was worked out from the same per-unit figure. Discounting the line total
 * instead would leave the two a cent or two apart on awkward quantities, and an
 * invoice its own VAT return disagrees with is the exact fault this file has
 * already been fixed for twice.
 *
 * The cost is that a supplier's own paper, which discounts the line total, can
 * differ by a cent or so on a quantity like seven. The shop can always type the
 * discounted figure straight into the unit price instead, and the line total is
 * on screen next to it either way.
 */
function unitAfterDiscount(line) {
  const off = Math.max(0, Math.min(100, Number(line?.discount) || 0));
  return money((Number(line?.unitPrice) || 0) * (1 - off / 100));
}

/** What one line comes to, after its discount and before VAT. */
function lineAmount(line) {
  return money(unitAfterDiscount(line) * (Number(line?.quantity) || 0));
}

/**
 * Totals for a document, per line and then summed — the same rounding rule the
 * VAT report uses, so an invoice and the return it feeds always agree.
 */
function totalsFor(lines, { inclusive }) {
  let net = 0;
  let vat = 0;
  let gross = 0;
  let units = 0;

  for (const line of lines) {
    // Discounted first, then rounded, then taxed — the order a printed invoice
    // does it in. Taxing before the discount would put VAT on money nobody paid.
    const amount = lineAmount(line);
    const rate = Number(line.vatRate) || 0;
    let lineNet;
    let lineVat;
    if (rate <= 0) {
      lineNet = amount;
      lineVat = 0;
    } else if (inclusive) {
      lineVat = money(amount * (rate / (100 + rate)));
      lineNet = money(amount - lineVat);
    } else {
      lineNet = amount;
      lineVat = money(amount * (rate / 100));
    }
    net = money(net + lineNet);
    vat = money(vat + lineVat);
    gross = money(gross + lineNet + lineVat);
    units += line.quantity;
  }

  return { net, vat, gross, units, lines: lines.length };
}

function emptyDraft({ kind = 'in', by = '' } = {}) {
  return {
    id: crypto.randomUUID(),
    kind: KINDS.includes(kind) ? kind : 'in',
    /** The supplier's or customer's own invoice number, as printed on it. */
    number: '',
    /** Who it is from, for an incoming document. Free text — suppliers are. */
    supplier: '',
    /** Who it is for, for an outgoing one. A customer id, or empty. */
    clientId: '',
    /** The date on the piece of paper, which is not always today. */
    date: new Date().toISOString().slice(0, 10),
    note: '',
    lines: [],
    startedAt: new Date().toISOString(),
    by: String(by || '').slice(0, 60),
  };
}

module.exports = {
  KINDS,
  DocumentLog,
  normalizeLine,
  unitAfterDiscount,
  lineAmount,
  totalsFor,
  emptyDraft,
  money,
};
