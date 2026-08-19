'use strict';

// The document engine's own arithmetic, so what this predicts a line will come
// to is worked out by the code that will actually work it out.
const { lineAmount } = require('./documents');

/**
 * Reading a supplier's invoice the way a person reads it.
 *
 * The shop is handed a PDF by email, and typing it in is half an hour of work
 * that produces a delivery MyVault could have built itself. This turns the
 * positioned text of ./pdf-text.js into a supplier, a number, a date and a list
 * of lines with quantities and prices.
 *
 * Two rules run through all of it.
 *
 * **Nothing is invented.** Every figure reported is one the paper prints. Where
 * a column is missing the field is left empty rather than filled with a plausible
 * guess, because a guessed cost becomes a margin, and a wrong margin becomes a
 * price the shop sells at for a year. A reader that is honest about what it did
 * not find is worth far more than one that is usually right.
 *
 * **The arithmetic has to agree.** Every line the invoice prints a total for is
 * checked: quantity times price, less the discount, has to come to what is
 * printed. When it does not, that line is flagged rather than quietly imported —
 * it means a column was read as the wrong thing, and a shop that trusted it
 * would post a delivery whose value does not match the paper it was typed from.
 * The same check runs against the invoice's own total at the bottom.
 *
 * The result is a proposal, never a posting. It fills a draft that a person
 * looks at and approves, which is the only safe shape for anything that reads a
 * document it did not write.
 */

/** The words a column heading can be, in the languages a shop is likeliest to meet. */
const COLUMNS = {
  code: ['κωδικός', 'κωδ', 'κωδικος', 'code', 'sku', 'barcode', 'ean', 'item no', 'art'],
  description: ['περιγραφή', 'περιγραφη', 'είδος', 'ειδος', 'ονομασία', 'description',
    'product', 'item', 'details', 'articolo', 'descripción', 'bezeichnung'],
  quantity: ['ποσότητα', 'ποσοτητα', 'ποσ', 'τεμ', 'τεμάχια', 'qty', 'quantity', 'units',
    'menge', 'cantidad'],
  unitPrice: ['τιμή', 'τιμη', 'τιμή μονάδας', 'unit price', 'price', 'unit', 'rate',
    'preis', 'precio'],
  discount: ['έκπτ', 'εκπτ', 'έκπτωση', 'εκπτωση', 'disc', 'discount', 'rabatt'],
  vatRate: ['φπα', 'φ.π.α', 'φ.π.α.', 'vat', 'tax', 'mwst', 'iva'],
  total: ['αξία', 'αξια', 'σύνολο', 'συνολο', 'amount', 'total', 'value', 'net', 'line total',
    'betrag', 'importe'],
};

/** How many headings a line needs before it is believed to be the table header. */
const HEADER_MATCHES = 3;

/** What the invoice's own totals are called. */
const TOTAL_WORDS = {
  net: ['καθαρή αξία', 'καθαρη αξια', 'μερικό σύνολο', 'subtotal', 'sub total', 'net',
    'net total', 'net amount', 'nettobetrag'],
  vat: ['φπα', 'φ.π.α', 'φ.π.α.', 'vat', 'vat amount', 'tax', 'mwst', 'iva'],
  gross: ['γενικό σύνολο', 'τελικό σύνολο', 'σύνολο', 'συνολο', 'πληρωτέο', 'total due',
    'grand total', 'total', 'gesamtbetrag'],
};

/** Money is only ever compared to the cent. */
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** A line's arithmetic may be out by this much before it is worth flagging. */
const TOLERANCE = 0.02;

const strip = (text) => String(text || '')
  .toLowerCase()
  .replace(/[.:%()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * A number as an invoice writes it, in either convention.
 *
 * "1.234,56" and "1,234.56" are the same amount written by two different
 * countries, and an invoice reader that assumes one of them is wrong half the
 * time by design. The rule that settles it without knowing the country: the
 * separator nearest the end is the decimal point, because no thousands separator
 * is ever last. A lone separator with exactly three digits behind it is
 * thousands — "1.500" is fifteen hundred, not one and a half.
 */
function toNumber(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-');
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits || !/\d/.test(digits)) return null;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalized;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalized = `${digits.slice(0, decimalAt).replace(/[.,]/g, '')}.${digits.slice(decimalAt + 1)}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const at = Math.max(lastComma, lastDot);
    const after = digits.length - at - 1;
    const separators = (digits.match(/[.,]/g) || []).length;
    // Three digits behind a single separator is a thousands mark; anything else
    // — two digits, one digit, four — is a decimal point.
    normalized = (after === 3 && separators === 1 && at > 0)
      ? digits.replace(/[.,]/g, '')
      : `${digits.slice(0, at).replace(/[.,]/g, '')}.${digits.slice(at + 1)}`;
  } else {
    normalized = digits;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** True if this piece of text is a number and nothing else. */
const isNumeric = (text) => /^[-(]?[\d.,\s]+[)%]?$/.test(String(text).trim()) && /\d/.test(text);

/**
 * The line that names the columns.
 *
 * Found by counting how many known headings appear on it, rather than by
 * position: an invoice may carry a logo, an address block and a summary above
 * the table, and no two suppliers put the table at the same height.
 */
function findHeader(lines) {
  let best = null;

  for (const line of lines) {
    const found = new Map();
    for (const piece of line.pieces) {
      const text = strip(piece.text);
      if (!text) continue;
      for (const [column, words] of Object.entries(COLUMNS)) {
        if (found.has(column)) continue;
        if (words.some((word) => text === word || text.startsWith(`${word} `) || text.includes(word))) {
          found.set(column, piece);
          break;
        }
      }
    }
    // A table needs something to count and something to charge for; a line that
    // merely says "Invoice" and "Date" is not a header however many words match.
    const usable = found.has('quantity') || found.has('total') || found.has('unitPrice');
    if (found.size >= HEADER_MATCHES && usable && (!best || found.size > best.found.size)) {
      best = { line, found };
    }
  }

  return best;
}

/**
 * Where one column stops and the next begins.
 *
 * The boundary sits halfway between the end of one heading and the start of the
 * next, which handles the usual invoice layout: text columns pushed left,
 * number columns pushed right, and a heading sitting over its own column
 * whichever way its contents are aligned.
 */
function columnBounds(found) {
  const columns = [...found.entries()]
    .map(([name, piece]) => ({ name, start: piece.x, end: piece.x + (piece.width || 0) }))
    .sort((a, b) => a.start - b.start);

  return columns.map((column, index) => ({
    name: column.name,
    from: index === 0 ? -Infinity : (columns[index - 1].end + column.start) / 2,
    to: index === columns.length - 1
      ? Infinity
      : (column.end + columns[index + 1].start) / 2,
  }));
}

/** Splits one line into its columns, using where each piece of text sits. */
function cellsFor(line, bounds) {
  const cells = {};
  for (const piece of line.pieces) {
    const centre = piece.x + (piece.width || 0) / 2;
    const column = bounds.find((c) => centre >= c.from && centre < c.to);
    if (!column) continue;
    cells[column.name] = cells[column.name] ? `${cells[column.name]} ${piece.text}` : piece.text;
  }
  for (const key of Object.keys(cells)) cells[key] = cells[key].replace(/\s+/g, ' ').trim();
  return cells;
}

/**
 * One row of the table, once its cells are known.
 *
 * Returns null for anything that is not a product line — the totals block, a
 * page footer, a continuation of a long description — rather than importing it
 * as a product called "Subtotal" with a quantity of one.
 */
function lineFrom(cells) {
  const description = (cells.description || '').trim();
  const quantity = toNumber(cells.quantity);
  const unitPrice = toNumber(cells.unitPrice);
  const total = toNumber(cells.total);

  if (!description) return null;
  if (quantity === null && unitPrice === null && total === null) return null;
  // The totals block sits under the table and often lines up with its columns.
  if (quantity === null && unitPrice === null) return null;

  const discount = toNumber(cells.discount);
  const vatRate = toNumber(cells.vatRate);

  const row = {
    code: (cells.code || '').trim(),
    description,
    quantity: quantity === null ? null : quantity,
    unitPrice: unitPrice === null ? null : round2(unitPrice),
    discount: discount === null ? 0 : discount,
    vatRate: vatRate === null ? null : vatRate,
    total: total === null ? null : round2(total),
    checked: false,
    warning: '',
  };

  // The arithmetic, where there is enough of it to check.
  if (row.quantity !== null && row.unitPrice !== null && row.total !== null) {
    const expected = round2(row.quantity * row.unitPrice * (1 - (row.discount || 0) / 100));
    row.checked = Math.abs(expected - row.total) <= TOLERANCE;
    if (!row.checked) {
      row.warning = `reads as ${row.quantity} × ${row.unitPrice} = ${expected}, `
        + `but the invoice prints ${row.total}`;
    }
  }

  return row;
}

/** The last number on a line — how an invoice writes a total. */
function trailingNumber(line) {
  for (let index = line.pieces.length - 1; index >= 0; index -= 1) {
    const value = toNumber(line.pieces[index].text);
    if (value !== null && isNumeric(line.pieces[index].text)) return value;
  }
  return toNumber((line.text.match(/[-\d.,]+\s*$/) || [])[0]);
}

/** Anything that looks like a date, in the orders the world writes them. */
function findDate(text) {
  const dmy = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (dmy) {
    const [, first, second, yearPart] = dmy;
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
    // Day first is the European reading and the one every language MyVault
    // ships in uses. A first number above twelve settles it either way.
    const day = Number(first);
    const month = Number(second);
    const [d, m] = day > 12 && month <= 12 ? [day, month] : [day, month];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

/**
 * Everything above the table: who sent it, what they called it, and when.
 */
function readHeading(pages, headerLine) {
  const first = pages[0];
  const above = first.lines.filter((line) => !headerLine || line.y < headerLine.y);
  const text = above.map((line) => line.text).join('\n');

  const number = (text.match(
    /(?:αριθμ[όο]ς|αριθ|τιμολ[όο]γιο(?:\s+πώλησης)?|invoice\s*(?:no|number|nr|#)?|inv|rechnung)\s*[.:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{2,})/i,
  ) || [])[1] || '';

  const dateLine = above.find((line) => /(ημερομην|date|datum|fecha)/i.test(line.text));
  const date = findDate(dateLine ? dateLine.text : text);

  const vatNumber = (text.match(
    /(?:α\.?φ\.?μ\.?|vat\s*(?:reg(?:istration)?|no|number)?|ust-?idnr|nif|p\.?iva)\s*[.:]?\s*([A-Z]{0,2}[\s\d]{6,})/i,
  ) || [])[1]?.replace(/\s+/g, ' ').trim() || '';

  // The supplier's name is the biggest thing at the top left. Taking the left
  // half of the topmost line keeps the sender and drops the "INVOICE No 4821"
  // block that sits opposite it — they are one line to a PDF and two to a human.
  let supplier = '';
  const middle = first.width / 2;
  for (const line of above.slice(0, 3)) {
    const left = line.pieces.filter((piece) => piece.x < middle).map((piece) => piece.text).join(' ');
    const candidate = left.replace(/\s+/g, ' ').trim();
    if (candidate.length >= 3 && /\p{L}/u.test(candidate) && !/^(τιμολ|invoice|rechnung)/i.test(candidate)) {
      supplier = candidate;
      break;
    }
  }

  const currency = /€|eur/i.test(text) ? 'EUR' : (/£|gbp/i.test(text) ? 'GBP' : '');

  return { supplier, number, date, vatNumber, currency };
}

/** The totals the invoice prints for itself, so they can be checked against. */
function readTotals(lines, headerLine) {
  const totals = { net: null, vat: null, gross: null };
  const below = lines.filter((line) => !headerLine || line.y > headerLine.y);

  for (const line of below) {
    const label = strip(line.text.replace(/[\d.,]+\s*$/, ''));
    if (!label) continue;

    // The longest heading that fits wins. "Subtotal" contains "total", and a
    // reader that takes the first match calls the subtotal the grand total and
    // hands the shop an invoice that is short by its VAT.
    // "Φ.Π.Α." comes out of the PDF as three letters with stops between them,
    // which is not the same string as "ΦΠΑ" and is the same word to a person. So
    // the spaced form and the closed-up one are both tried.
    const tight = label.replace(/\s+/g, '');
    let best = null;
    for (const [key, words] of Object.entries(TOTAL_WORDS)) {
      for (const word of words) {
        const wordTight = word.replace(/[\s.]+/g, '');
        const hit = label === word || label.endsWith(word)
          || tight === wordTight || tight.endsWith(wordTight);
        if (!hit) continue;
        if (!best || word.length > best.word.length) best = { key, word };
      }
    }
    if (!best || totals[best.key] !== null) continue;
    const value = trailingNumber(line);
    if (value !== null) totals[best.key] = round2(value);
  }
  return totals;
}

/**
 * Reads an invoice out of the text of a PDF.
 *
 * @param {{pages: Array}} extracted what ./pdf-text.js produced
 * @returns an invoice as far as it could be read, with everything it could not
 *   read left empty and everything that did not add up written into `warnings`
 */
function readInvoice(extracted) {
  const pages = extracted?.pages || [];
  const warnings = [];

  if (pages.length === 0) {
    return { ok: false, reason: 'empty', supplier: '', number: '', date: '', lines: [], warnings };
  }

  const allLines = pages.flatMap((page) => page.lines);
  const header = findHeader(allLines);

  if (!header) {
    return {
      ok: false,
      reason: 'noTable',
      ...readHeading(pages, null),
      lines: [],
      totals: readTotals(allLines, null),
      warnings,
    };
  }

  const bounds = columnBounds(header.found);
  const rows = [];
  let started = false;

  for (const line of allLines) {
    if (line === header.line) { started = true; continue; }
    if (!started) continue;
    const row = lineFrom(cellsFor(line, bounds));
    if (row) rows.push(row);
  }

  const heading = readHeading(pages, header.line);
  const totals = readTotals(allLines, header.line);

  for (const row of rows) {
    if (row.warning) warnings.push(`${row.description}: ${row.warning}`);
  }

  // The invoice's own net total against the sum of its lines. A supplier who
  // prints one and not the other is common; a supplier whose two disagree means
  // a line was misread, and that is worth saying before a shop posts it.
  const summed = rows.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const netCheck = totals.net !== null && rows.every((row) => row.total !== null)
    ? Math.abs(round2(summed) - totals.net) <= Math.max(TOLERANCE, rows.length * 0.01)
    : null;
  if (netCheck === false) {
    warnings.push(
      `the lines add up to ${round2(summed)} but the invoice prints ${totals.net}`,
    );
  }

  return {
    ok: rows.length > 0,
    reason: rows.length > 0 ? '' : 'noLines',
    ...heading,
    lines: rows,
    totals,
    netCheck,
    columns: bounds.map((column) => column.name),
    warnings,
  };
}

/**
 * The invoice as rows the draft importer already understands.
 *
 * Deliberately the same shape a CSV produces, so a PDF and a spreadsheet reach
 * the draft down one path with one set of rules about matching products and one
 * report of what could not be matched.
 *
 * The interesting part is the last check. MyVault prices per unit and rounds
 * there — a decision made so that a movement, an invoice and a VAT return can
 * never disagree, and written up at length in ./documents.js. A supplier who
 * discounts the line total instead can print a figure that no price-per-unit can
 * reproduce: ten per cent off €1,15 is €1,035 a bottle, and a case of
 * twenty-four comes to €24,84 on their paper and €24,96 on any arithmetic that
 * has to round the bottle first.
 *
 * Twelve cents, and no way to be right about both. So the line is imported as
 * the supplier presented it and the difference is said out loud, with both
 * figures, rather than left for a shop to find when the invoice they print does
 * not match the invoice they were sent.
 */
function toImportRows(invoice) {
  const warnings = [];
  const rows = [];

  for (const line of invoice.lines || []) {
    if (!line.quantity) continue;

    const row = {
      barcode: /^\d{8,14}$/.test(line.code) ? line.code : '',
      code: line.code,
      name: line.description,
      quantity: line.quantity,
      price: line.unitPrice ?? '',
      discount: line.discount || 0,
      'vat rate': line.vatRate ?? '',
    };
    rows.push(row);

    // Only worth checking when the paper states a total to check against, and
    // only when its own arithmetic was right in the first place — a line already
    // flagged as not adding up is reported once, not twice.
    if (line.total === null || line.unitPrice === null || !line.checked) continue;

    const mine = lineAmount({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount || 0,
    });
    const off = round2(mine - line.total);
    if (Math.abs(off) > TOLERANCE) {
      warnings.push(
        `${line.description}: the invoice prints ${line.total} for this line and MyVault `
        + `works it out as ${mine}, because it prices per unit. Type the price you were `
        + `charged into the line if the ${Math.abs(off).toFixed(2)} matters.`,
      );
    }
  }

  return { rows, warnings };
}

module.exports = {
  readInvoice,
  toImportRows,
  toNumber,
  findHeader,
  columnBounds,
  cellsFor,
  readTotals,
  findDate,
  COLUMNS,
  TOLERANCE,
};
