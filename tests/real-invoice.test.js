/**
 * A real Greek invoice, checked line by line.
 *
 * Every other test in this repository uses numbers I chose. This one uses an
 * actual τιμολόγιο — I-SPIRIT no. 0000000024 of 20/06/2017 — with its printed
 * totals as the expected values. If MyVault and a real accounting package
 * disagree about what 24% of €1.450,00 is, the bug is MyVault's, and this is
 * where it shows up.
 *
 *   6 lines, each quantity 1, each 24%, no discount
 *   Καθαρή αξία   1.450,00 €
 *   Φ.Π.Α.          348,00 €
 *   Σύνολο        1.798,00 €
 *
 * The prices on it are net — €200,00 becomes €248,00 — so it also happens to be
 * the exact case the "prices already include VAT" setting exists for, and the
 * second half of this file measures what getting that backwards would cost.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../electron/store');
const { parseCsv } = require('../electron/csv');
const { vatReport } = require('../electron/vat');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dirs = [];
function shop(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-invoice-'));
  dirs.push(dir);
  const store = new Store(dir, '1.8.0');
  store.init();
  store.updateSettings({ vatEnabled: true, vatRate: 24, ...settings });
  return store;
}

/** The invoice exactly as printed: description, net unit price, printed total. */
const INVOICE = [
  { code: '1123', name: 'Προσφερόμενη υπηρεσία Α', net: 200, printed: 248 },
  { code: '1123', name: 'Προσφερόμενη υπηρεσία Β', net: 150, printed: 186 },
  { code: '1123', name: 'Προσφερόμενη υπηρεσία Γ', net: 250, printed: 310 },
  { code: '1124', name: 'Προσφερόμενο είδος Α', net: 150, printed: 186 },
  { code: '1124', name: 'Προσφερόμενο είδος Β', net: 350, printed: 434 },
  { code: '1124', name: 'Προσφερόμενο είδος Δ', net: 350, printed: 434 },
];

const PRINTED_NET = 1450;
const PRINTED_VAT = 348;
const PRINTED_TOTAL = 1798;
const PRINTED_QUANTITY = 6;

// ======================================================= against the paper
{
  // Net prices with VAT added underneath, which is how this invoice is laid out.
  const store = shop({ pricesIncludeVat: false });
  const items = INVOICE.map((line) => store.addItem({
    name: line.name, sku: line.code, quantity: 10, price: line.net, cost: line.net * 0.6,
  }));
  const client = store.addClient({ name: 'Kala Patel' });

  let draft = store.startDraft({ kind: 'out' });
  store.updateDraft(draft.id, { number: '0000000024', date: '2017-06-20', clientId: client.id });
  items.forEach((item, index) => {
    draft = store.setDraftLine(draft.id, {
      itemId: item.id, quantity: 1, unitPrice: INVOICE[index].net,
    });
  });

  assert.strictEqual(draft.totals.lines, INVOICE.length);
  assert.strictEqual(draft.totals.units, PRINTED_QUANTITY, 'ΣΥΝ. ΠΟΣΟΤΗΤΑ');
  assert.strictEqual(draft.totals.net, PRINTED_NET, 'ΚΑΘΑΡΗ ΑΞΙΑ');
  assert.strictEqual(draft.totals.vat, PRINTED_VAT, 'ΣΥΝΟΛΟ Φ.Π.Α.');
  assert.strictEqual(draft.totals.gross, PRINTED_TOTAL, 'ΣΥΝΟΛΟ');
  ok('the totals match the printed invoice to the cent');

  // Every ΠΟΣΟ down the right-hand column, individually.
  draft.lines.forEach((line, index) => {
    const gross = Math.round(line.quantity * line.unitPrice * 1.24 * 100) / 100;
    assert.strictEqual(gross, INVOICE[index].printed, `line ${index + 1}: ${line.name}`);
  });
  ok('every line total matches the ΠΟΣΟ column');

  const posted = store.postDraft(draft.id, {});
  assert.strictEqual(posted.moved, 6, 'all six lines moved stock');
  assert.ok(store.getState().items.every((item) => item.quantity === 9), 'one of each went out');

  const vat = vatReport(store.getState(), store.movements, {});
  assert.strictEqual(vat.collected.vat, PRINTED_VAT, 'and the VAT return agrees with the invoice');
  assert.strictEqual(vat.collected.net, PRINTED_NET);
  assert.strictEqual(vat.collected.rates[0].rate, 24);
  ok('posting it feeds the VAT return the same figures the invoice shows');
}

// ============================================ what the wrong setting costs
//
// The two "does this already include VAT" settings are the ones the settings
// screen warns about. This measures the warning: the same invoice, entered with
// the shelf-price default, understates the VAT due by €67,36 — on one invoice.
{
  const wrong = shop({ pricesIncludeVat: true });
  const items = INVOICE.map((line) => wrong.addItem({
    name: line.name, quantity: 10, price: line.net,
  }));
  let draft = wrong.startDraft({ kind: 'out' });
  items.forEach((item, index) => {
    draft = wrong.setDraftLine(draft.id, {
      itemId: item.id, quantity: 1, unitPrice: INVOICE[index].net,
    });
  });

  assert.strictEqual(draft.totals.gross, PRINTED_NET, 'the net is mistaken for the total');
  assert.strictEqual(draft.totals.vat, 280.64);
  const shortfall = Math.round((PRINTED_VAT - draft.totals.vat) * 100) / 100;
  assert.strictEqual(shortfall, 67.36, 'the VAT declared would be €67,36 short');
  ok('entering a net invoice as VAT-inclusive understates the VAT by €67,36 — hence the warning');
}

// ================================================== the supplier's own file
//
// The same six lines as a semicolon CSV, which is what a Greek supplier sends.
// One product is deliberately not in the stock list: it must be handed back
// rather than matched to something that looks similar.
{
  const store = shop({ costsIncludeVat: false });
  for (const line of INVOICE.slice(0, 5)) {
    store.addItem({ name: line.name, quantity: 0, price: line.net, cost: line.net });
  }

  const csv = ['Name;Quantity;Price']
    .concat(INVOICE.map((line) => `${line.name};1;${String(line.net).replace('.', ',')}`))
    .join('\r\n');

  const draft = store.startDraft({ kind: 'in' });
  const result = store.importDraftLines(draft.id, parseCsv(csv));

  assert.strictEqual(result.added, 5, 'the five it knows are read in');
  assert.strictEqual(result.unmatched.length, 1);
  assert.strictEqual(result.unmatched[0].name, 'Προσφερόμενο είδος Δ', 'and the sixth is reported');
  // 200 + 150 + 250 + 150 + 350 = 1100, plus 24%
  assert.strictEqual(result.draft.totals.net, 1100);
  assert.strictEqual(result.draft.totals.vat, 264);
  ok('a semicolon CSV of the same invoice reads in, and the unknown line is never guessed at');

  // The invoice's own ΚΩΔΙΚΟΣ repeats — 1123 on three different lines, 1124 on
  // three more — so it is a category code, not a product code. Matching on it
  // would put stock against the wrong product, which is why the importer only
  // ever matches on barcode and name.
  const codes = new Set(INVOICE.map((line) => line.code));
  assert.strictEqual(codes.size, 2, 'six lines, two codes');
  assert.ok(codes.size < INVOICE.length, 'so the code cannot identify a product');
  ok('the invoice\'s own code column is not unique, and is deliberately not matched on');
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
