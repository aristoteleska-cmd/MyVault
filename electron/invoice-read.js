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
  vatRate: ['φπα', 'φ π α', 'vat', 'tax', 'mwst', 'iva',
    // Which band the line is in, which is the rate by another name. Longer than
    // the bare "Φ.Π.Α." beside it, which on the same invoice is the money.
    'κατηγορία φπα', 'κατηγορία φ π α', 'κατηγορια φπα', 'κατηγορια φ π α',
    'συντελεστής φπα', 'συντελεστης φπα', 'vat rate', 'tax rate'],
  /**
   * The VAT in money, and the discount in money.
   *
   * Both are printed beside the per-cent column they were worked out from, and
   * both are read as that column if nothing tells them apart — so a line with
   * 22% off and €5.32 off becomes a line with 5.32% off, and MyVault's own
   * arithmetic then disagrees with the paper by seventeen per cent of it.
   *
   * Named so they can be ignored, which is all MyVault wants of them: it keeps
   * the rate and the percentage, and works the money out itself.
   */
  vatAmount: ['σύνολο φπα', 'σύνολο φ π α', 'συνολο φπα', 'συνολο φ π α',
    'ποσό φπα', 'ποσό φ π α', 'ποσο φπα', 'vat amount', 'tax amount'],
  discountAmount: ['σύνολο εκπτώσεων', 'συνολο εκπτωσεων', 'σύνολο έκπτωσης',
    'ποσό έκπτωσης', 'ποσο εκπτωσης', 'αξία έκπτωσης', 'discount amount'],
  total: ['καθαρή αξία', 'καθαρη αξια', 'net amount', 'line total', 'αξία', 'αξια', 'σύνολο',
    'συνολο', 'καθαρό', 'καθαρο', 'amount', 'total', 'value', 'net', 'betrag', 'importe'],
  /**
   * What the line came to before the discount was taken off it.
   *
   * Printed by suppliers who want the arithmetic shown, and never the figure
   * MyVault wants: the cost of a delivery is what was charged, not what would
   * have been charged. It has to be named all the same, because its heading is
   * usually the word for a discount with something in front of it — "Αξία Προ
   * Εκπτώσεως", "Καθαρό (Προ εκπτ.)" — and read as the discount column it turns
   * eleven euros fifty into eleven and a half per cent off every line.
   */
  netBeforeDiscount: ['προ εκπτ', 'προ εκ', 'προ έκπτωσης', 'before discount', 'gross amount'],
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
const IGNORED_COLUMNS = new Set(['unit', 'netBeforeDiscount', 'vatAmount', 'discountAmount']);

/**
 * What each column is called when MyVault has to name it in a sentence.
 *
 * Only used by the message that explains a PDF it could not read. The window
 * has its own translated names for the columns it did read; this is the main
 * process talking, and it talks in English the way the rest of the errors here
 * do.
 */
const COLUMN_NAMES = {
  code: 'the product code',
  description: 'the product name',
  quantity: 'the quantity',
  unitPrice: 'the unit price',
  discount: 'the discount',
  vatRate: 'the VAT rate',
  total: 'the line total',
  unit: 'the unit of measure',
  netBeforeDiscount: 'the amount before the discount',
  vatAmount: 'the VAT in money',
  discountAmount: 'the discount in money',
};

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
    'net total', 'net amount', 'nettobetrag',
    // "Σύνολο Καθαρού Ποσού" ends in the word for an amount and begins with the
    // word for a grand total; the longer match is what makes it the net rather
    // than the total payable.
    'σύνολο καθαρού ποσού', 'συνολο καθαρου ποσου', 'καθαρού ποσού', 'καθαρου ποσου'],
  vat: ['φπα', 'φ.π.α', 'φ.π.α.', 'vat', 'vat amount', 'tax', 'mwst', 'iva'],
  gross: ['γενικό σύνολο', 'τελικό σύνολο', 'σύνολο', 'συνολο', 'πληρωτέο', 'πληρωτεο',
    'πληρωτέο ποσό', 'πληρωτεο ποσο', 'συνολική αξία', 'συνολικη αξια',
    'total due', 'grand total', 'total', 'gesamtbetrag'],
};

/** Money is only ever compared to the cent. */
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** A line's arithmetic may be out by this much before it is worth flagging. */
const TOLERANCE = 0.02;

/**
 * Letters that are not the letter they look like.
 *
 * One accounting package prints every capital sigma as U+01A9 — "Ʃ", an African
 * letter esh that happens to be drawn the same — so "ΣΥΝΟΛΟ" arrives as "ƩΥΝΟΛΟ"
 * and matches nothing. On screen it is a sigma; to a comparison it is not, and
 * the invoice's own totals went unread with no sign that anything had been
 * missed. Straightened for matching only: the text MyVault stores and shows is
 * always what the file actually contains.
 */
const LOOKALIKES = [[/[Ʃʃ]/g, 'σ'], [/З/g, 'ζ']];

const strip = (text) => LOOKALIKES
  .reduce((value, [pattern, letter]) => value.replace(pattern, letter), String(text || ''))
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
 * The pieces of one line, gathered back into the headings a person sees.
 *
 * A PDF has no words in it, only glyphs at coordinates, and how many pieces a
 * producer emits for "Φ.Π.Α. %" is entirely its own business. One real invoice
 * hands it over as six: "Φ", ".", "Π", ".", "Α", ". %". Matched piece by piece
 * none of them is a heading at all, so the VAT column went unnamed, its rate
 * was never read, and — worse — the column beside it was left undivided.
 *
 * Pieces closer together than a fraction of their own height are one heading.
 * That threshold is not a guess about typography: within a heading the pieces
 * abut, gaps of a tenth of a millimetre, while the space between two headings
 * is a whole column of white. On the invoice this was written for the two are
 * 1.6 units and 5.9 units apart against a 6.2-unit line.
 */
const HEADING_PIECES = 0.4;

/** Where a gap is wide enough to be a space rather than nothing at all. */
const HEADING_SPACE = 0.15;

/** How many wrapped lines above the header may belong to its headings. */
const HEADING_LINES = 3;

function mergeHeadings(pieces) {
  const groups = [];
  for (const piece of [...pieces].sort((a, b) => a.x - b.x)) {
    const last = groups[groups.length - 1];
    const gap = last ? piece.x - last.end : Infinity;
    if (last && gap <= piece.height * HEADING_PIECES) {
      last.text += (gap > piece.height * HEADING_SPACE ? ' ' : '') + piece.text;
      last.end = piece.x + (piece.width || 0);
    } else {
      groups.push({
        text: piece.text,
        x: piece.x,
        end: piece.x + (piece.width || 0),
        height: piece.height,
      });
    }
  }
  return groups;
}

/**
 * The headings, including the parts of them printed on the lines above.
 *
 * A narrow column with a long name gets wrapped — "Καθαρό / (Προ / εκπτ.)"
 * stacked over one column — and the header line then holds only its last
 * fragment. Read alone that fragment says "εκπτ.)", which is the word for a
 * discount, so the amount before the discount was imported as the discount
 * itself: eleven euros fifty read as eleven and a half per cent off. The line
 * still added up, because the figure it was compared against was the same wrong
 * column, and nothing said anything.
 *
 * So the lines above are read too, as long as they carry no numbers — a number
 * above the table is the row of some other table, not a heading — and each
 * fragment joins the heading it sits over.
 */
function headingsFor(lines, index) {
  const line = lines[index];
  const groups = mergeHeadings(line.pieces);

  for (let above = index - 1; above >= 0 && index - above <= HEADING_LINES; above -= 1) {
    const candidate = lines[above];
    if (!candidate || candidate.y >= line.y) break;
    if (line.y - candidate.y > line.height * (HEADING_LINES + 1)) break;
    // Most of a line being numbers means it is a row of some table, not the
    // top of a heading. Any number at all is too strict: one supplier heads two
    // columns "Εκπτ. 1 %" and "Έκπτ. 1", and that lone "1" was enough to
    // abandon the whole stacked heading — taking "Τιμή Μονάδας" with it, so the
    // unit price went unread on every line of the invoice.
    const numbers = candidate.pieces.filter((piece) => isNumeric(piece.text)).length;
    if (numbers * 2 >= candidate.pieces.length) break;

    for (const fragment of mergeHeadings(candidate.pieces)) {
      const over = groups.find((group) => fragment.x < group.end && fragment.end > group.x);
      if (over) over.text = `${fragment.text} ${over.text}`;
    }
  }

  return groups;
}

/**
 * Which of the VAT columns is the rate and which is the money.
 *
 * An invoice that prints both — "Φ.Π.Α." for the amount and "Φ.Π.Α. %" for the
 * rate — says the same three letters twice, and the only thing telling them
 * apart is the per-cent sign, which strip() throws away along with the full
 * stops. Read in order the amount wins, and every line then carries a VAT rate
 * of two euros seventy-six.
 *
 * Where only one such column exists it is the rate, because that is the one a
 * shop's own arithmetic needs. Where there are two, the one marked % is the
 * rate and the other is left unnamed — still dividing its neighbours, which is
 * the other half of what a heading is for.
 */
function settlePercentColumns(found, groups) {
  for (const [column, pattern] of [
    ['vatRate', /φ\s*\.?\s*π\s*\.?\s*α|φπα|vat|mwst|iva/i],
    ['discount', /εκπτ|έκπτ|disc|rabatt/i],
  ]) {
    const claiming = groups.filter((group) => pattern.test(strip(group.text)));
    if (claiming.length < 2) continue;
    const marked = claiming.find((group) => group.text.includes('%'));
    if (marked) found.set(column, marked);
  }
}

/**
 * The line that names the columns.
 *
 * Found by counting how many known headings appear on it, rather than by
 * position: an invoice may carry a logo, an address block and a summary above
 * the table, and no two suppliers put the table at the same height.
 */
function findHeader(lines) {
  let best = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const groups = headingsFor(lines, index);
    const found = new Map();
    const strength = new Map();
    for (const piece of groups) {
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
    settlePercentColumns(found, groups);
    // A table needs something to count and something to charge for; a line that
    // merely says "Invoice" and "Date" is not a header however many words match.
    const usable = found.has('quantity') || found.has('total') || found.has('unitPrice');
    if (found.size >= HEADER_MATCHES && usable && (!best || found.size > best.found.size)) {
      best = { line, found, groups };
    }
  }

  return best;
}

/**
 * The line that came closest to being a table heading, when none was good enough.
 *
 * Every supplier prints a different invoice, and the shop that meets one MyVault
 * cannot read is the person least able to say why. "Could not find a table" is
 * true and useless. This gathers the line that matched the most column words and
 * says which words those were, so the answer becomes "it found the quantity and
 * the price on this line but nothing it recognised as a product name" — which is
 * a sentence somebody can act on, or send on.
 *
 * Deliberately looser than `findHeader`: it does not care whether the line could
 * actually carry a table, because the whole point is to describe the line that
 * could not.
 */
function nearestHeader(lines) {
  let best = null;

  for (let index = 0; index < lines.length; index += 1) {
    const groups = headingsFor(lines, index);
    const found = new Set();
    for (const piece of groups) {
      const text = strip(piece.text);
      if (!text) continue;
      for (const [column, words] of Object.entries(COLUMNS)) {
        if (words.some((word) => text === word || text.includes(word))) found.add(column);
      }
    }
    if (!found.size || (best && found.size <= best.found.size)) continue;
    best = {
      found,
      text: groups.map((piece) => piece.text.trim()).filter(Boolean).join(' · '),
    };
  }

  if (!best) return null;
  // Trimmed because this ends up in a message on the screen, and a footer that
  // happened to match two words can be a paragraph long.
  return { columns: [...best.found], text: best.text.slice(0, 160) };
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
function columnBounds(found, headerLine, headings) {
  const named = new Map();
  for (const [name, piece] of found.entries()) named.set(piece, name);

  // The merged headings where findHeader worked them out, and the raw pieces
  // otherwise, so a caller holding only a line still gets sensible boundaries.
  const source = headings
    || (headerLine ? mergeHeadings(headerLine.pieces) : [...found.values()]);

  const columns = source
    .map((piece) => ({
      name: named.get(piece) || null,
      start: piece.x,
      end: piece.end !== undefined ? piece.end : piece.x + (piece.width || 0),
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
/** Columns that hold figures, and therefore never hold words. */
const FIGURE_COLUMNS = new Set(['quantity', 'unitPrice', 'discount', 'vatRate', 'total']);

function cellsFor(line, bounds) {
  const gathered = new Map();
  const spilled = [];
  // Whether the piece just read was the overflow of a product name, so that the
  // bracket closing it goes the same way.
  let carrying = false;

  for (const piece of line.pieces) {
    const centre = piece.x + (piece.width || 0) / 2;
    const column = bounds.find((c) => centre >= c.from && centre < c.to);
    if (!column || !column.name || IGNORED_COLUMNS.has(column.name)) continue;

    // A product name wider than its column runs into the next one. Left there
    // it is dropped with that cell's stray text, and the shop gets "HOT WHEELS
    // ΠΙΣΤΕΣ CITY (" — a name cut off mid-bracket, in the stock list for good.
    // Words in a column of figures belong to the name they ran out of.
    // Words, and whatever punctuation trails them: "(ΚΙΝΑ)" arrives as three
    // pieces and only the middle one has letters in it, so a rule that took
    // only words handed the shop a product called "… CITY (".
    const wordy = /\p{L}/u.test(piece.text);
    const figures = /\d/.test(piece.text);
    if (FIGURE_COLUMNS.has(column.name) && !figures && (wordy || carrying)) {
      spilled.push(piece);
      carrying = true;
      continue;
    }
    carrying = false;

    if (!gathered.has(column.name)) gathered.set(column.name, []);
    gathered.get(column.name).push(piece);
  }

  if (spilled.length && gathered.has('description')) {
    gathered.get('description').push(...spilled);
  }

  const cells = {};
  for (const [name, pieces] of gathered.entries()) {
    // Joined the way the page prints them rather than with a space between
    // every piece: "56τεμ.(ΚΙΝΑ)" arrives in five pieces and was being written
    // into the stock list as "56 τεμ .( ΚΙΝΑ )".
    cells[name] = mergeHeadings(pieces).map((group) => group.text).join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return cells;
}

/**
 * One row of the table, once its cells are known.
 *
 * Returns null for anything that is not a product line — the totals block, a
 * page footer, a continuation of a long description — rather than importing it
 * as a product called "Subtotal" with a quantity of one.
 */
/**
 * The rest of a product name, printed on its own line under the one it finishes.
 *
 * Nothing else in the table looks like this: text in the description column, no
 * figures anywhere, and no code of its own. A line carrying a number is a row of
 * something, however badly read, and is left alone.
 */
function continuation(cells) {
  const text = (cells.description || '').trim();
  if (!text) return '';
  const carriesFigures = ['quantity', 'unitPrice', 'total', 'discount', 'vatRate', 'code']
    .some((column) => String(cells[column] ?? '').trim() !== '');
  if (carriesFigures) return '';
  // A stray word that is really the start of the summary — "Σημειώσεις" under
  // the description column — must not be glued onto somebody's product.
  if (endsTable({ text, pieces: [] }) || interruptsTable({ text, pieces: [] })) return '';
  return text;
}

/**
 * The figure in a cell that also caught the end of a long product name.
 *
 * A description too wide for its column runs into the one beside it, and the
 * quantity cell then reads "ΑΡΑΧΝΗS2 1,00" — from which the plain reading is
 * twenty-one, because the stray S2 and the 1,00 run together into a number. One
 * real invoice ordered one spider and MyVault proposed twenty-one of them.
 *
 * Figures on an invoice are set against the right of their column and the
 * overflow arrives on the left, so the last number in the cell is the one the
 * column is for. Where the cell is a plain number this is that number.
 */
function figureIn(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;
  const direct = toNumber(text);
  if (!/\p{L}/u.test(text)) return direct;
  const tokens = text.split(/\s+/).filter((token) => /\d/.test(token) && !/\p{L}/u.test(token));
  if (!tokens.length) return direct;
  return toNumber(tokens[tokens.length - 1]);
}

function lineFrom(cells) {
  const description = (cells.description || '').trim();
  const quantity = figureIn(cells.quantity);
  const unitPrice = figureIn(cells.unitPrice);
  const total = figureIn(cells.total);

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
function labelledValues(lines, kinds) {
  const found = [];
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

      if (inline || after || under) found.push({ inline, after, under, label: piece, line });
    }
  }
  return found;
}

/** The first thing a label points at — what most fields want. */
function labelledValue(lines, kinds) {
  return labelledValues(lines, kinds)[0] || null;
}

/**
 * A label that is really the first half of a longer label.
 *
 * "Αριθμός ΓΕΜΗ" is a company registry number and "Αριθμός Αδειοδότησης" is a
 * software licence; both begin with the word for a number, and both sit at the
 * top of an invoice above the actual invoice number. Read in order the first
 * one wins, and MyVault files the supplier's registry number as the number of
 * the invoice — which is wrong on the screen, wrong in the records, and wrong
 * again when a second invoice from the same supplier claims the same number.
 *
 * What separates them is what comes next: a qualifying word rather than a
 * value. A label followed immediately by more letters is pointing at something
 * else, unless the value it wants is printed underneath it instead.
 */
function isQualified(candidate) {
  const next = String(candidate.after || '').trim().split(/\s+/)[0] || '';
  return next.length >= 2 && !/\d/.test(next);
}

/**
 * Everything above the table: who sent it, what they called it, and when.
 */
function readHeading(pages, headerLine) {
  const first = pages[0];
  const above = first.lines.filter((line) => !headerLine || line.y < headerLine.y);
  const text = above.map((line) => line.text).join('\n');

  // The number, from a label beside the value or above it.
  const numberFields = labelledValues(above, FIELD_LABELS.number);
  // Greek letters count as letters. A Greek invoice is numbered by series —
  // "Α-2818", "ΤΔΑ 4821" — and a pattern written in ASCII drops the series and
  // keeps the digits, which is not the number on the paper and not the number
  // the shop will be asked about.
  // "Α -2818" is one number with a gap in it, because the series letter and the
  // rest sit far enough apart that the page put a space between them. Closed up
  // around the dash before anything is matched.
  const pickNumber = (value) => (String(value || '')
    .replace(/\s*([-/])\s*/g, '$1')
    // "ΤΔΑ 0001744" is one number written in two pieces: a short series in
    // capitals, then the digits. Left apart, the digits alone are taken and the
    // series — the half that says which book the invoice came out of — is lost.
    // Without a lookbehind this needs \b, and a word boundary in JavaScript is
    // an ASCII idea: there is none in front of a Greek tau, so the series went
    // on being dropped by a pattern that looked like it handled it.
    .replace(/(?<=^|\s)(\p{Lu}{1,4})\s+(?=\d)/gu, '$1')
    .match(/[\p{L}\d][\p{L}\d\-/]{2,}/gu) || [])
    // A number has a number in it. Without that the pattern happily returns
    // the word next to the label — the invoice numbered "Ημερομηνία".
    .find((candidate) => /\d/.test(candidate)) || '';
  let fromLabel = '';
  for (const candidate of numberFields) {
    // What the label carries itself, then what is printed under it, and only
    // then what follows it on the line — because a label followed by another
    // word is naming something other than this invoice. See isQualified.
    const value = pickNumber(candidate.inline)
      || pickNumber(candidate.under)
      || (isQualified(candidate) ? '' : pickNumber(candidate.after));
    if (value) { fromLabel = value; break; }
  }
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
    // Built from headings rather than raw pieces so that a name arriving as
    // "Α" "." "Ε" "." is written back the way it is printed. Joining every piece
    // with a space gave shops called "STAR BALLS & TOYS Α . Ε ." — which is the
    // name they are filed under, and the one their next invoice has to match.
    for (const piece of mergeHeadings(line.pieces)) {
      if (current && piece.x - current.right > 40) { blocks.push(current); current = null; }
      if (!current) current = { text: piece.text, right: piece.end };
      else {
        current.text += ` ${piece.text}`;
        current.right = piece.end;
      }
    }
    if (current) blocks.push(current);

    // A supplier who prints their name and address in one block hands over
    // "STAR BALLS & TOYS Α.Ε. ΑΦΜ EL082759207 Οδός ΛΕΧΟΥΡΙΤΗ 9 ΑΘΗΝΑ", which
    // reads as an address and is thrown away whole — leaving the logo beside it
    // as the shop's name. Cut at the word that starts the address instead.
    // Written with a lookahead rather than \b: a word boundary in JavaScript is
    // an ASCII idea, and there is none between a Greek mu and the space after
    // it, so "ΑΦΜ" at the end of the pattern matched nothing at all.
    const ADDRESS_STARTS = /\s(?:α\.?φ\.?μ\.?|αφμ|οδ[όο]ς|τηλ\.?|τ\.?κ\.?|vat|ust|nif|e-?mail|αρ\.?\s*εγκατ[άα]στασης|εγκατ[άα]στασης|δραστηρι[όο]τητες|[έε]δρα|αριθμ[όο]ς\s*γεμη|γεμη|δ\.?ο\.?υ\.?|φαξ|fax|π[όο]λη)(?=[\s:.]|$)/i;
    const names = blocks
      .map((block) => block.text.replace(/\s+/g, ' ').trim().split(ADDRESS_STARTS)[0].trim())
      .filter((value) => value.length >= 3 && /\p{L}/u.test(value) && !NOT_A_NAME.test(value));

    // The logo prints the first words of the name on its own — "STAR BALLS"
    // beside "STAR BALLS & TOYS Α.Ε." — and the shorter one is not the name of
    // anybody. Where one candidate begins the other, the whole of it wins.
    const candidate = names.find((value) => !names.some(
      (other) => other !== value && other.startsWith(value),
    )) || names[0];
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
/** True when this line comes after that one, reading the document as printed. */
function comesAfter(line, mark) {
  if (!mark) return true;
  const page = line.page ?? 1;
  const markPage = mark.page ?? 1;
  return page > markPage || (page === markPage && line.y > mark.y);
}

function readTotals(lines, headerLine) {
  const totals = { net: null, vat: null, gross: null };
  const below = lines.filter((line) => comesAfter(line, headerLine));

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
        // Ends with, because a label is usually "Σύνολο Φ.Π.Α."; begins with,
        // because it is sometimes "Πληρωτέο ποσό πελάτη", where the words that
        // say what the figure is come first and the rest is who owes it.
        const hit = label === word || label.endsWith(word) || label.startsWith(`${word} `)
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

  // Which page a line is on, carried with it. Coordinates start again at the
  // top of every page, so a line's y says where it is on its own page and
  // nothing at all about where it is in the document — and "everything below
  // the table" therefore has to be asked page first, y second. Asked on y
  // alone, an invoice whose totals are on page two has no totals at all: they
  // sit at y=114 against a header at y=648 and read as being above it.
  const allLines = pages.flatMap((page) => page.lines.map(
    (line) => (line.page === undefined ? Object.assign(line, { page: page.number }) : line),
  ));
  const header = findHeader(allLines);

  if (!header) {
    return {
      ok: false,
      reason: 'noTable',
      ...readHeading(pages, null),
      lines: [],
      totals: readTotals(allLines, null),
      // What it nearly found, so the failure can be described rather than
      // merely reported. See nearestHeader.
      nearest: nearestHeader(allLines),
      columns: [],
      warnings,
    };
  }

  const bounds = columnBounds(header.found, header.line, header.groups);
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
    const cells = cellsFor(line, bounds);
    const row = lineFrom(cells);
    if (row) { rows.push(row); continue; }

    // A product name too long for its column runs onto the next line, in that
    // column and nowhere else: "BB JUNIOR RC Lil Drivers Ferrari" with
    // "LaFerrari" underneath it. There is no quantity and no price on such a
    // line, so it is not a row, and dropping it costs the shop the end of the
    // name — the part that says which Ferrari. It belongs to the line above.
    const carriedOn = continuation(cells);
    if (carriedOn && rows.length) {
      const last = rows[rows.length - 1];
      last.description = `${last.description} ${carriedOn}`.trim();
    }
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
  nearestHeader,
  IGNORED_COLUMNS,
  COLUMN_NAMES,
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
