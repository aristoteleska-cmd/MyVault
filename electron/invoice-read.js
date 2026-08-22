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
  total: ['καθαρή αξία', 'καθαρη αξια', 'net amount', 'line total', 'αξία', 'αξια', 'σύνολο',
    'συνολο', 'amount', 'total', 'value', 'net', 'betrag', 'importe'],
  /**
   * The unit a quantity is counted in — pieces, boxes, kilos.
   *
   * MyVault has no use for it, but the column has to be known about all the
   * same: a heading nobody recognises is a heading that does not divide its
   * neighbours, and "Τεμάχια" then lands in the quantity beside the number.
   */
  unit: ['μ.μ', 'μμ', 'μον.μετρ', 'μονάδα', 'uom', 'u/m', 'unit of measure'],
};

/** Read for the layout, never imported. */
const IGNORED_COLUMNS = new Set(['unit']);

/**
 * Where the list of products stops and the summary begins.
 *
 * Everything below this is the shop's own arithmetic — balances, VAT analysis,
 * the amount payable — laid out in the same columns as the table above it,
 * which is exactly why it gets read as three more products with quantities of
 * 2,03 and 400014893621007. A person knows the list has ended because the words
 * change; so does this.
 */
const END_OF_TABLE = [
  'υπόλοιπο', 'υπολοιπο', 'ανάλυση', 'αναλυση', 'σύνολο', 'συνολο', 'πληρωτέο', 'πληρωτεο',
  'κρατήσεις', 'κρατησεις', 'επιβαρύνσεις', 'επιβαρυνσεις', 'φόροι', 'φοροι',
  'αξία προ έκπτωσης', 'γενικό σύνολο', 'φ.π.α', 'φπα', 'παρατηρήσεις',
  'subtotal', 'sub total', 'total', 'balance', 'vat', 'amount due',
  'grand total', 'notes', 'terms',
];

/**
 * Lines that interrupt the table without ending it.
 *
 * An invoice that runs to a second page carries the running total across the
 * break — "Μεταφορά", "carried forward", "σε μεταφορά" — and then goes straight
 * on listing products. Treating that as the end of the table, which is what the
 * first version of this did, silently drops every line on every page after the
 * first: the delivery posts short and nothing says so.
 *
 * Skipped rather than stopped at, along with the page footer that follows it.
 */
const INTERRUPTS_TABLE = [
  'μεταφορά', 'μεταφορα', 'εκ μεταφοράς', 'σε μεταφορά', 'από μεταφορά',
  'carried forward', 'carry forward', 'brought forward', 'continued', 'σελίδα', 'σελιδα',
  'page',
];

/** A quantity above this is not a quantity — it is a barcode, or a stamp. */
const MAX_QUANTITY = 100000;

/**
 * What a document calls itself when it is goods coming back rather than going out.
 *
 * A credit note is printed exactly like an invoice — same supplier, same
 * columns, often the same quantities — and means the opposite. Read as an
 * invoice it adds the returned stock to the shelf a second time and claims its
 * VAT again, which is wrong twice over and in the shop's favour, which is the
 * kind of wrong that gets noticed by somebody official.
 *
 * So it is recognised and reported, and MyVault makes the document that means
 * goods leaving rather than arriving.
 */
const CREDIT_NOTE = [
  'πιστωτικό', 'πιστωτικο', 'πιστωτικό τιμολόγιο', 'επιστροφή', 'επιστροφη',
  'credit note', 'credit memo', 'gutschrift', 'nota de crédito', 'nota di credito',
];

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
    const strength = new Map();
    for (const piece of line.pieces) {
      const text = strip(piece.text);
      if (!text) continue;

      // The longest heading that fits wins, for the piece and for the column.
      // A real invoice prints "Αξία Προ Εκπτώσεως" and "Καθαρή αξία" side by
      // side and both contain "αξία"; first-match takes the amount before the
      // discount and calls it the line total, which is wrong by the discount on
      // every discounted line.
      let best = null;
      for (const [column, words] of Object.entries(COLUMNS)) {
        for (const word of words) {
          const hit = text === word || text.startsWith(`${word} `) || text.includes(word);
          if (!hit) continue;
          if (!best || word.length > best.word.length) best = { column, word };
        }
      }
      if (!best) continue;
      if (found.has(best.column) && strength.get(best.column) >= best.word.length) continue;
      found.set(best.column, piece);
      strength.set(best.column, best.word.length);
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
 * Built from every heading on the line, including the ones MyVault has no name
 * for. That is the whole point: an unrecognised heading still separates its
 * neighbours, and leaving it out merges its column into the next one. On a real
 * Greek invoice that merger put the line's net amount and its VAT rate in the
 * same cell — "8,46" and "24,00" read as 84624 per cent — which is the kind of
 * number that is either caught here or believed by a tax return.
 *
 * The boundary sits halfway between the end of one heading and the start of the
 * next, which handles the usual invoice layout: text columns pushed left, number
 * columns pushed right, and a heading sitting over its own column whichever way
 * its contents are aligned.
 */
function columnBounds(found, headerLine) {
  const named = new Map();
  for (const [name, piece] of found.entries()) named.set(piece, name);

  const columns = (headerLine ? headerLine.pieces : [...found.values()])
    .map((piece) => ({
      name: named.get(piece) || null,
      start: piece.x,
      end: piece.x + (piece.width || 0),
    }))
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
    if (!column || !column.name || IGNORED_COLUMNS.has(column.name)) continue;
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
  // A quantity with fifteen digits in it is a document stamp or a barcode that
  // has landed in the wrong column, not a delivery of four hundred trillion.
  if (quantity !== null && Math.abs(quantity) > MAX_QUANTITY) return null;
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

/**
 * True when this line is the start of the summary rather than another product.
 *
 * Judged on the words at the left of the line, where the label sits — a product
 * called "Σύνολο" is not a thing, and a summary row that does not say what it is
 * has not been printed by any accounting package a shop will meet.
 */
function endsTable(line) {
  const label = strip(line.text).slice(0, 48);
  if (!label) return false;
  // A carry-over or a page number is not the end of anything.
  if (INTERRUPTS_TABLE.some((word) => label.startsWith(word) || label.includes(` ${word}`))) {
    return false;
  }
  return END_OF_TABLE.some((word) => label.startsWith(word) || label.includes(` ${word}`));
}

/** True for a line that is skipped and then forgotten about. */
function interruptsTable(line) {
  const label = strip(line.text).slice(0, 48);
  if (!label) return false;
  return INTERRUPTS_TABLE.some((word) => label.startsWith(word) || label.includes(` ${word}`));
}

/**
 * A repeat of the column headings, printed again at the top of a later page.
 *
 * Read as a product it becomes a line called "Περιγραφή είδους" with no
 * quantity; skipped, the table simply continues.
 */
function repeatsHeader(line, headerLine) {
  if (!headerLine) return false;
  return strip(line.text) === strip(headerLine.text);
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

/** Makes a piece of text safe to put inside a regular expression. */
const escapeForSearch = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What is left of a piece of text once its label has been taken off the front.
 *
 * Matched against the text as printed rather than the tidied-up copy the label
 * was recognised in: "Invoice No: INV-2026-3391" carries a colon that tidying
 * removes, so a search for the tidied label finds nothing in the original and
 * the whole piece survives as the "value" — which is how the invoice number
 * came back as the word "Invoice".
 */
function stripLabel(original, word) {
  const pattern = word.split(/\s+/).map(escapeForSearch).join('\\W+');
  return String(original).replace(new RegExp(`^\\s*${pattern}\\W*`, 'i'), '').trim();
}

/** Labels an invoice puts over, or in front of, the values this needs. */
const FIELD_LABELS = {
  number: ['αριθμός', 'αριθμος', 'αριθ', 'αρ παραστατικού', 'number', 'invoice no', 'no', 'nr',
    'rechnungsnummer', 'número'],
  date: ['ημερομηνία', 'ημερομηνια', 'date', 'datum', 'fecha'],
};

/**
 * The value that belongs to a label, whether it is beside it or under it.
 *
 * Both layouts are ordinary. A small shop's invoice writes "Αριθμός: 4821" on
 * one line; an accounting package prints a grid — the labels on one row, the
 * values on the next, each under its own heading. Reading only the first shape
 * is how MyVault came back with no number and no date from a real Greek invoice
 * that prints both in letters an inch high.
 */
function labelledValue(lines, kinds) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const piece of line.pieces) {
      const text = strip(piece.text);
      const matched = kinds.find((word) => text === word || text.startsWith(`${word} `));
      if (!matched) continue;

      // Inside the same piece: "Invoice No: INV-2026-3391" arrives whole, and
      // the value is the tail of the label's own text. Looked at first, because
      // a label that already carries its value is not pointing at the line below
      // — where the next label is, and where MyVault duly read the word "Date"
      // as an invoice number.
      const inline = stripLabel(piece.text, matched);

      // Beside it: the rest of this line, after the label.
      const after = line.pieces
        .filter((other) => other.x > piece.x + (piece.width || 0) - 1)
        .map((other) => other.text)
        .join(' ')
        .trim();
      // Under it: on the next line, whatever sits within the label's own width.
      const below = lines[index + 1];
      const under = below
        ? below.pieces
            .filter((other) => {
              const centre = other.x + (other.width || 0) / 2;
              return centre >= piece.x - 6 && centre <= piece.x + (piece.width || 0) + 6;
            })
            .map((other) => other.text)
            .join(' ')
            .trim()
        : '';

      if (inline || after || under) return { inline, after, under, label: piece, line };
    }
  }
  return null;
}

/**
 * Everything above the table: who sent it, what they called it, and when.
 */
function readHeading(pages, headerLine) {
  const first = pages[0];
  const above = first.lines.filter((line) => !headerLine || line.y < headerLine.y);
  const text = above.map((line) => line.text).join('\n');

  // The number, from a label beside the value or above it.
  const numberField = labelledValue(above, FIELD_LABELS.number);
  const pickNumber = (value) => (String(value || '').match(/[A-Za-z0-9][A-Za-z0-9\-/]{2,}/) || [])[0] || '';
  const fromLabel = numberField
    ? pickNumber(numberField.inline) || pickNumber(numberField.after) || pickNumber(numberField.under)
    : '';
  const number = fromLabel || (text.match(
    /(?:αριθμ[όο]ς|αριθ|τιμολ[όο]γιο(?:\s+πώλησης)?|invoice\s*(?:no|number|nr|#)?|inv|rechnung)\s*[.:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{2,})/i,
  ) || [])[1] || '';

  const dateField = labelledValue(above, FIELD_LABELS.date);
  const date = (dateField && (
    findDate(dateField.inline) || findDate(dateField.after) || findDate(dateField.under)
  )) || findDate(text);

  const vatNumber = (text.match(
    /(?:α\.?φ\.?μ\.?|vat\s*(?:reg(?:istration)?|no|number)?|ust-?idnr|nif|p\.?iva)\s*[.:]?\s*([A-Z]{0,2}[\s\d]{6,})/i,
  ) || [])[1]?.replace(/\s+/g, ' ').trim() || '';

  // The supplier's name is the first real thing at the top of the page.
  //
  // Not "the left half of the top line": a printed invoice centres the shop's
  // name and puts the document type opposite it, and on a real one the name
  // started right of centre while the strapline underneath started left of it —
  // so the half-page rule confidently returned "PAPER * PLASTIC * DETERGENTS".
  // What actually distinguishes them is that a name is the first block of words
  // that is not an address, a phone number or the word "invoice".
  const NOT_A_NAME = /(τιμολ|invoice|rechnung|factura|δελτίο|@|τηλ|fax|κιν\.|χλμ|α\.?φ\.?μ|vat|www\.|https?:)/i;
  let supplier = '';
  for (const line of above.slice(0, 4)) {
    // Split the line where a wide gap says two blocks, and take the first block
    // that reads like a name.
    const blocks = [];
    let current = null;
    for (const piece of line.pieces) {
      if (current && piece.x - current.right > 40) { blocks.push(current); current = null; }
      if (!current) current = { text: piece.text, right: piece.x + (piece.width || 0) };
      else {
        current.text += ` ${piece.text}`;
        current.right = piece.x + (piece.width || 0);
      }
    }
    if (current) blocks.push(current);

    const candidate = blocks
      .map((block) => block.text.replace(/\s+/g, ' ').trim())
      .find((value) => value.length >= 3 && /\p{L}/u.test(value) && !NOT_A_NAME.test(value));
    if (candidate) { supplier = candidate; break; }
  }

  const currency = /€|eur/i.test(text) ? 'EUR' : (/£|gbp/i.test(text) ? 'GBP' : '');

  // Judged on the document's own title block rather than anywhere it might
  // merely mention the word — a footnote about the returns policy is not a
  // credit note.
  const title = strip(above.slice(0, 12).map((line) => line.text).join(' '));
  const creditNote = CREDIT_NOTE.some((word) => title.includes(word));

  return { supplier, number, date, vatNumber, currency, creditNote };
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

  const bounds = columnBounds(header.found, header.line);
  const rows = [];
  let started = false;

  for (const line of allLines) {
    if (line === header.line) { started = true; continue; }
    if (!started) continue;
    // Asked before endsTable, and that order is the whole of it. A Greek
    // invoice heads its VAT column "ΦΠΑ %", and "φπα" is one of the words that
    // means the products have finished and the totals have begun — so the
    // headings printed again at the top of page two ended the table, and every
    // line on every page after the first was dropped. On a thirty-line delivery
    // that posts two thirds of the goods and says nothing beyond a total that
    // disagrees with the paper. The headings repeated are the one line that
    // cannot mean the table is over: it is the table starting again.
    if (repeatsHeader(line, header.line)) continue;
    // The summary under the table is laid out in the table's own columns, so it
    // parses as products: a balance carried forward becomes a quantity of 2,03,
    // and the legal footnote's stamp becomes a quantity of four hundred
    // trillion. The words are what tell a person the list has ended.
    if (endsTable(line)) break;
    if (interruptsTable(line)) continue;
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
    /**
     * Which way the stock moves. A credit note is goods going back to the
     * supplier, so it fills an outgoing document; everything else is a delivery.
     */
    kind: heading.creditNote ? 'out' : 'in',
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
