/**
 * Reading a supplier's PDF, against real PDF files.
 *
 * Not against a fake object shaped like one. The fixtures in tests/fixtures are
 * genuine PDFs produced by Chromium's print engine — the same engine that makes
 * the PDFs MyVault itself prints — with the layout a real invoice has: a logo
 * block, an address, a table with right-aligned numbers, and a totals box tucked
 * under it. A parser tested on hand-written strings passes and then meets its
 * first real file; this one meets them first.
 *
 * The bar for every number here is the same as everywhere else in this
 * repository: what MyVault reads has to be what the paper prints. So the tests
 * assert on the figures the invoice shows a person, and the last one takes the
 * whole route — PDF, draft, posted document — and checks the shop's total
 * against the total at the bottom of the page.
 *
 * Regenerate the fixtures with: node scripts/make-invoice-fixtures.mjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readPdfFile, MAX_PDF_BYTES } = require('../electron/files');
const { extractPdfText } = require('../electron/pdf-text');
const { readInvoice, toImportRows, toNumber, findDate } = require('../electron/invoice-read');
const { Store } = require('../electron/store');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const fixtures = path.join(__dirname, 'fixtures');
const fixture = (name) => path.join(fixtures, `${name}.pdf`);

const dirs = [];
function shop(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-pdf-'));
  dirs.push(dir);
  const store = new Store(dir, '1.11.0');
  store.init();
  store.updateSettings({
    vatEnabled: true, vatRate: 24, pricesIncludeVat: false, costsIncludeVat: false, ...settings,
  });
  return store;
}

function refused(fn, expected) {
  let message = '';
  try { fn(); } catch (error) { message = error.message; }
  assert.ok(message, 'expected this to be refused, and it was not');
  assert.ok(message.includes(expected), `refusal did not mention "${expected}": ${message}`);
  return message;
}

const read = async (name) => readInvoice(await extractPdfText(readPdfFile(fixture(name))));

(async () => {
  // ================================================ numbers, in either country
  {
    // The single most likely way to be wrong by a factor of a thousand.
    assert.strictEqual(toNumber('1.234,56'), 1234.56, 'the European way');
    assert.strictEqual(toNumber('1,234.56'), 1234.56, 'and the Anglo way');
    assert.strictEqual(toNumber('12,40'), 12.4);
    assert.strictEqual(toNumber('12.40'), 12.4);
    assert.strictEqual(toNumber('6,20 €'), 6.2, 'a currency symbol is not part of the number');
    assert.strictEqual(toNumber('24%'), 24);
    ok('a number reads the same whether it was written in Athens or in Leeds');

    // "1.500" is fifteen hundred everywhere it is written that way, and one and
    // a half nowhere. Three digits behind a lone separator settles it.
    assert.strictEqual(toNumber('1.500'), 1500);
    assert.strictEqual(toNumber('1,500'), 1500);
    assert.strictEqual(toNumber('1.5'), 1.5, 'but one digit behind it is a decimal');
    assert.strictEqual(toNumber('2,25'), 2.25, 'and so are two');
    ok('a lone separator with three digits behind it is thousands, not a decimal');

    assert.strictEqual(toNumber(''), null);
    assert.strictEqual(toNumber('—'), null);
    assert.strictEqual(toNumber('Περιγραφή'), null);
    assert.strictEqual(toNumber('(45,00)'), -45, 'brackets are how an invoice writes a credit');
    ok('anything that is not a number reads as nothing rather than as zero');

    assert.strictEqual(findDate('Ημερομηνία: 14/08/2026'), '2026-08-14');
    assert.strictEqual(findDate('Date: 03/09/2026'), '2026-09-03');
    assert.strictEqual(findDate('dated 2026-09-03'), '2026-09-03');
    assert.strictEqual(findDate('no date here'), '');
    ok('a date is read day-first, the way every language MyVault ships in writes it');
  }

  // ============================================== the file gate, before parsing
  {
    const notPdf = path.join(fixtures, 'not-really.pdf');
    fs.writeFileSync(notPdf, 'PK this is a zip wearing a PDF name', 'utf8');
    refused(() => readPdfFile(notPdf), 'not a PDF');
    fs.rmSync(notPdf);
    ok('a file called .pdf that is not one is refused before any parser sees it');

    refused(() => readPdfFile(fixtures), 'folder');
    const empty = path.join(fixtures, 'empty.pdf');
    fs.writeFileSync(empty, '');
    refused(() => readPdfFile(empty), 'empty');
    fs.rmSync(empty);
    ok('and so are a folder and an empty file');

    assert.ok(MAX_PDF_BYTES > 8 * 1024 * 1024, 'a real invoice with photographs still fits');
    assert.ok(MAX_PDF_BYTES <= 64 * 1024 * 1024, 'but a whole catalogue does not');
    ok(`the ceiling is ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB — an invoice, not a library`);

    const bytes = readPdfFile(fixture('supplier-greek'));
    assert.ok(Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === '%PDF-');
    ok('a real PDF comes back as bytes, so what parses it never touches this disk');
  }

  // ======================================================== a Greek invoice
  {
    const invoice = await read('supplier-greek');

    assert.strictEqual(invoice.ok, true);
    assert.strictEqual(invoice.supplier, 'ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ Α.Ε.');
    assert.strictEqual(invoice.number, '0000004821');
    assert.strictEqual(invoice.date, '2026-08-14');
    assert.strictEqual(invoice.vatNumber, '094123456');
    ok('who sent it, what they numbered it and when — read off the top of the page');

    assert.strictEqual(invoice.lines.length, 4);
    assert.deepStrictEqual(
      invoice.lines.map((line) => [
        line.code, line.description, line.quantity, line.unitPrice, line.discount,
        line.vatRate, line.total,
      ]),
      [
        ['5201234567890', 'Ούζο Πλωμαρίου 700ml', 12, 6.20, 0, 24, 74.40],
        ['5209876543210', 'Ρετσίνα Μαλαματίνα 500ml', 24, 1.15, 10, 24, 24.84],
        ['5205555512345', 'Ελαιόλαδο έξτρα παρθένο 1L', 6, 7.00, 0, 13, 42.00],
        ['5201111122223', 'Καφές φίλτρου 250g', 10, 2.10, 5, 24, 19.95],
      ],
    );
    ok('every column of every line, including the two rates and the two discounts');

    assert.deepStrictEqual(invoice.totals, { net: 161.19, vat: 34.07, gross: 195.26 });
    assert.strictEqual(invoice.netCheck, true, 'the lines add up to the printed net');
    assert.deepStrictEqual(invoice.warnings, []);
    ok('the totals block is read too, and the lines agree with it');

    // Greek text out of a PDF is where an encoding bug would show, and a shop
    // that gets "Οüζο" back cannot match it to anything on its shelves.
    assert.ok(invoice.lines.every((line) => /^[Ͱ-Ͽ\s\w.]+$/u.test(line.description)));
    ok('the Greek comes back as Greek, not as replacement characters');
  }

  // ====================================================== an English invoice
  {
    const invoice = await read('supplier-english');

    assert.strictEqual(invoice.supplier, 'NORTHGATE WHOLESALE LTD');
    assert.strictEqual(invoice.number, 'INV-2026-3391');
    assert.strictEqual(invoice.date, '2026-09-03');
    assert.strictEqual(invoice.lines.length, 3);
    assert.deepStrictEqual(invoice.totals, { net: 115.44, vat: 23.09, gross: 138.53 });
    ok('a different supplier, a different language, the same figures out');

    // "Subtotal" contains the word "total". A reader that takes the first match
    // calls 115.44 the grand total and the shop pays 23.09 less than it owes.
    assert.notStrictEqual(invoice.totals.gross, invoice.totals.net);
    assert.strictEqual(invoice.totals.gross, 138.53, 'the total due, not the subtotal');
    ok('"Subtotal" is not mistaken for "Total due"');

    // 6 × 11.50 less 2.5% is 67.275, which the invoice prints as 67.28.
    const coffee = invoice.lines.find((line) => line.description.includes('coffee'));
    assert.strictEqual(coffee.discount, 2.5);
    assert.strictEqual(coffee.total, 67.28);
    assert.strictEqual(coffee.checked, true);
    ok('a fractional discount still checks out to the cent');
  }

  // ================================ the totals block, read as a person reads it
  {
    const { readTotals } = require('../electron/invoice-read');
    // Positioned text, the way ./pdf-text.js hands it over.
    const line = (text, y) => ({
      y,
      text,
      pieces: text.split(' ').map((word, index) => ({
        text: word, x: 300 + index * 40, width: 30, height: 10,
      })),
    });

    const totals = readTotals([
      line('Sub total 115.44', 500),
      line('VAT 23.09', 512),
      line('Total due 138.53', 524),
    ], null);
    assert.deepStrictEqual(totals, { net: 115.44, vat: 23.09, gross: 138.53 });
    ok('a subtotal, a VAT line and a total due are three different numbers');

    // Greek prints its VAT with stops in it, which is not the same string as
    // ΦΠΑ and is the same word to everybody reading the page.
    const greek = readTotals([
      line('Καθαρή αξία 161,19', 500),
      line('Φ.Π.Α. 34,07', 512),
      line('Σύνολο 195,26', 524),
    ], null);
    assert.deepStrictEqual(greek, { net: 161.19, vat: 34.07, gross: 195.26 });
    ok('and Φ.Π.Α. is recognised however the invoice punctuates it');

    // A totals block that says nothing MyVault understands leaves the figures
    // empty rather than picking up whatever number was nearest.
    const nothing = readTotals([line('Thank you for your custom 2026', 500)], null);
    assert.deepStrictEqual(nothing, { net: null, vat: null, gross: null });
    ok('a line that is not a total contributes no total');
  }

  // ============================== an invoice that disagrees with itself
  {
    const invoice = await read('mismatched');

    assert.strictEqual(invoice.lines.length, 2);
    const [good, bad] = invoice.lines;
    assert.strictEqual(good.checked, true);
    assert.strictEqual(bad.checked, false, '5 × 2.00 is not 12.50');
    assert.strictEqual(invoice.warnings.length, 1);
    assert.ok(invoice.warnings[0].includes('12.5'), invoice.warnings[0]);
    ok('a line whose arithmetic does not work is flagged rather than imported quietly');

    // And the flag is on the line, not just in a list somewhere — the screen
    // needs to be able to point at it.
    assert.ok(bad.warning.includes('reads as'), bad.warning);
    ok('with the sum spelled out, so a person can see which column was misread');
  }

  // ================================================ a scan has nothing to read
  {
    const extracted = await extractPdfText(readPdfFile(fixture('scanned-no-text')));
    assert.strictEqual(extracted.scanned, true);
    assert.strictEqual(extracted.characters, 0);
    ok('a scanned page is recognised as a picture of an invoice, not an invoice');

    // The important part: it does not come back as an empty invoice, which would
    // read to a shop as "MyVault is broken" rather than "this file has no text".
    const invoice = readInvoice(extracted);
    assert.strictEqual(invoice.ok, false);
    assert.strictEqual(invoice.reason, 'noTable');
    ok('and it produces a reason, not a silent empty result');
  }

  // ====================================== onto a draft, and out the other side
  {
    const store = shop();
    // The shop stocks three of the four things on the Greek invoice.
    const ouzo = store.addItem({
      name: 'Ούζο Πλωμαρίου 700ml', barcode: '5201234567890', quantity: 4, price: 12.40, cost: 6.00,
    });
    const retsina = store.addItem({
      name: 'Ρετσίνα Μαλαματίνα 500ml', barcode: '5209876543210', quantity: 10, price: 3.20, cost: 1.20,
    });
    const oil = store.addItem({
      name: 'Ελαιόλαδο έξτρα παρθένο 1L', barcode: '5205555512345', quantity: 2, price: 14.00,
      cost: 7.20, vatRate: 13,
    });

    const invoice = await read('supplier-greek');
    const draft = store.startDraft({ kind: 'in' });
    const { rows, warnings } = toImportRows(invoice);
    const imported = store.importDraftLines(draft.id, rows);

    assert.strictEqual(imported.added, 3);
    assert.strictEqual(imported.unmatched.length, 1);
    assert.strictEqual(imported.unmatched[0].name, 'Καφές φίλτρου 250g');
    assert.strictEqual(imported.unmatched[0].quantity, 10);
    ok('the three products the shop stocks land on the draft, and the fourth is named');

    // The discount and the rate the supplier printed came across. Losing either
    // would leave the draft disagreeing with the paper it was read from.
    const lines = imported.draft.lines;
    assert.strictEqual(lines.find((l) => l.itemId === retsina.id).discount, 10);
    assert.strictEqual(lines.find((l) => l.itemId === ouzo.id).unitPrice, 6.20);
    assert.strictEqual(lines.find((l) => l.itemId === oil.id).vatRate, 13);
    ok('the discount and the rate on each line come across with it');

    // The one that matters, and the one place MyVault cannot be right about
    // everything at once. Two of the three lines come to exactly what the paper
    // prints. The third is a case of twenty-four at ten per cent off €1,15 —
    // €1,035 a bottle, which no price in whole cents can be — so MyVault's
    // per-unit arithmetic makes it €24,96 against the supplier's €24,84.
    //
    // Twelve cents, said out loud rather than swallowed. That is the whole
    // bargain of pricing per unit, and it is the right way round: an invoice
    // that disagrees with its own VAT return would be far worse than one that
    // disagrees with the supplier by a known amount, on a named line, in a
    // message the shop can act on.
    const expectedNet = 74.40 + 24.96 + 42.00;
    assert.strictEqual(Math.round(imported.draft.totals.net * 100) / 100, expectedNet);
    // Two of the four lines on the paper are discounted onto a half-cent, and
    // both are named — including the coffee, which this shop does not stock yet
    // and will meet the moment it does.
    assert.strictEqual(warnings.length, 2, 'both awkward lines are named');
    const said = warnings.find((warning) => warning.includes('Ρετσίνα'));
    assert.ok(said, 'the case of twenty-four is one of them');
    assert.ok(said.includes('24.84') && said.includes('24.96'), said);
    assert.ok(said.includes('0.12'), 'and it says how far apart they are');
    assert.ok(
      warnings.every((warning) => /\d+\.\d{2}/.test(warning)),
      'each one carries the figures rather than just saying something is wrong',
    );
    ok(`the draft comes to ${expectedNet.toFixed(2)} net, and the 0.12 it cannot match is named`);

    const posted = store.postDraft(draft.id, {});
    assert.strictEqual(posted.document.lines.length, 3);
    assert.strictEqual(
      Math.round(posted.document.totals.net * 100) / 100,
      expectedNet,
      'and the posted document says the same',
    );

    // The stock actually arrived.
    const after = (id) => store.getState().items.find((item) => item.id === id).quantity;
    assert.strictEqual(after(ouzo.id), 4 + 12);
    assert.strictEqual(after(retsina.id), 10 + 24);
    assert.strictEqual(after(oil.id), 2 + 6);
    ok('posting it puts the delivery on the shelves, PDF to stock in one action');

    // And the VAT the shop can deduct is the VAT the supplier charged, at both
    // rates: 24% of 99,24 and 13% of 42,00.
    const { vatReport } = require('../electron/vat');
    const owed = vatReport(store.getState(), store.movements, {
      from: '2000-01-01', to: '2100-01-01',
    });
    const deductible = Math.round(owed.paid.vat * 100) / 100;
    // 24% of the ouzo and the retsina as MyVault priced them (74,40 + 24,96),
    // and 13% of the oil. Two rates on one delivery, each deducted at its own —
    // the reason the rate is read off the paper rather than assumed.
    const expectedVat = Math.round(99.36 * 0.24 * 100) / 100 + Math.round(42 * 0.13 * 100) / 100;
    assert.strictEqual(deductible, Math.round(expectedVat * 100) / 100);
    ok(`the deductible VAT is ${expectedVat.toFixed(2)} — both rates, as the invoice charged them`);
  }

  // ============================ a delivery is never posted by the reader alone
  {
    // Everything above ends in a draft. Nothing in this path moves stock without
    // a person pressing post, because a document MyVault did not write is a
    // proposal — and a parser that could post would be a parser that could be
    // wrong about a shop's stock without anybody looking.
    const store = shop();
    store.addItem({ name: 'Ούζο Πλωμαρίου 700ml', barcode: '5201234567890', quantity: 4, price: 12, cost: 6 });

    const invoice = await read('supplier-greek');
    const draft = store.startDraft({ kind: 'in' });
    store.importDraftLines(draft.id, toImportRows(invoice).rows);

    assert.strictEqual(store.getState().items[0].quantity, 4, 'nothing has moved yet');
    let movements = 0;
    store.movements.forEach({}, (entry) => { if (entry.reason === 'delivery') movements += 1; });
    assert.strictEqual(movements, 0, 'and nothing is in the history either');
    ok('reading a PDF changes no stock until somebody posts the draft');
  }

  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n' + passed + ' checks passed.');
})().catch((error) => {
  console.error('\nFAILED:', error.message);
  console.error(error.stack);
  process.exit(1);
});
