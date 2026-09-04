'use strict';

/**
 * The printable documents, built here in the main process.
 *
 * The renderer never supplies HTML. It asks for a named document and hands over
 * plain values; the markup is assembled below and every value is escaped on the
 * way in. That is deliberate — printing works by loading the page into a real
 * browser window, and a window that renders whatever the interface sends it is a
 * window that renders whatever anything that reached the interface sends it. A
 * shop's product names come from CSV files and barcode scans, so they are not
 * trusted input either.
 *
 * The styling is plain and deliberately ink-light: these are printed on the sort
 * of laser printer a small shop already owns, often onto paper that goes on a
 * clipboard and gets written on.
 */

const { PRINT_CONTENT_SECURITY_POLICY } = require('./offline');

const ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Every value that reaches the page goes through this. No exceptions. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

const STYLE = `
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
    font-size: 10.5pt; color: #111; margin: 0;
  }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  .meta { font-size: 9pt; color: #555; display: flex; gap: 16px; flex-wrap: wrap; }
  h2 { font-size: 12pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #bbb; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em;
       color: #444; border-bottom: 1px solid #999; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .totals { display: flex; gap: 22px; flex-wrap: wrap; margin: 10px 0 16px; }
  .total { border: 1px solid #ccc; border-radius: 4px; padding: 6px 10px; min-width: 110px; }
  .total .k { font-size: 8pt; text-transform: uppercase; color: #555; letter-spacing: .04em; }
  .total .v { font-size: 13pt; font-weight: 700; }
  .short { color: #a11; font-weight: 600; }
  .over { color: #06603f; font-weight: 600; }
  .urgent { font-weight: 700; }
  .write-in { display: inline-block; min-width: 62px; border-bottom: 1px solid #999; }
  .note { font-size: 8.5pt; color: #666; margin-top: 4px; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #ccc;
           font-size: 8pt; color: #666; }
`;

function page({ title, shop, when, subtitle, body, footNote }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PRINT_CONTENT_SECURITY_POLICY}">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="meta">
    ${shop ? `<span>${esc(shop)}</span>` : ''}
    <span>${esc(when)}</span>
    ${subtitle ? `<span>${esc(subtitle)}</span>` : ''}
  </div>
</header>
${body}
<footer>${esc(footNote || 'MyVault — printed on this computer. Nothing was sent anywhere.')}</footer>
</body></html>`;
}

function rows(list, cells) {
  return list.map((entry) => `<tr>${cells(entry)}</tr>`).join('');
}

/**
 * The sheet a shop carries round the shelves.
 *
 * Two modes, and the difference matters. Before counting, it prints the blank
 * column to write in — the whole point of paper. After counting, it prints what
 * was found and what was expected, which is the record worth keeping.
 */
function stockTakeSheet({ title, shop, when, lines, totals, blank, labels }) {
  const head = blank
    ? `<tr><th>${esc(labels.product)}</th><th>${esc(labels.barcode)}</th>
        <th class="num">${esc(labels.counted)}</th></tr>`
    : `<tr><th>${esc(labels.product)}</th><th>${esc(labels.barcode)}</th>
        <th class="num">${esc(labels.expected)}</th><th class="num">${esc(labels.counted)}</th>
        <th class="num">${esc(labels.difference)}</th><th class="num">${esc(labels.value)}</th></tr>`;

  const body = blank
    ? rows(lines, (line) => `
        <td>${esc(line.name)}</td>
        <td>${esc(line.barcode)}</td>
        <td class="num"><span class="write-in">&nbsp;</span></td>`)
    : rows(lines, (line) => `
        <td>${esc(line.name)}</td>
        <td>${esc(line.barcode)}</td>
        <td class="num">${esc(line.expected)}</td>
        <td class="num">${esc(line.counted)}</td>
        <td class="num ${line.difference < 0 ? 'short' : 'over'}">${line.difference > 0 ? '+' : ''}${esc(line.difference)}</td>
        <td class="num">${esc(line.value)}</td>`);

  const summary = blank ? '' : `
    <div class="totals">
      <div class="total"><div class="k">${esc(labels.counted)}</div><div class="v">${esc(totals.counted)}</div></div>
      <div class="total"><div class="k">${esc(labels.matching)}</div><div class="v">${esc(totals.matching)}</div></div>
      <div class="total"><div class="k">${esc(labels.missing)}</div><div class="v">${esc(totals.missingUnits)}</div></div>
      <div class="total"><div class="k">${esc(labels.extra)}</div><div class="v">${esc(totals.extraUnits)}</div></div>
      <div class="total"><div class="k">${esc(labels.shrinkage)}</div><div class="v">${esc(totals.shrinkage)}</div></div>
    </div>`;

  return page({
    title,
    shop,
    when,
    subtitle: blank ? labels.blankNote : '',
    body: `${summary}<table><thead>${head}</thead><tbody>${body}</tbody></table>
      ${lines.length === 0 ? `<p class="note">${esc(labels.nothing)}</p>` : ''}`,
  });
}

/** One page a shop can hand to, or read down the phone to, each supplier. */
function reorderSheet({ title, shop, when, suppliers, totals, labels }) {
  const sections = suppliers.map((supplier) => `
    <h2>${esc(supplier.supplier || labels.noSupplier)}</h2>
    <table>
      <thead><tr>
        <th>${esc(labels.product)}</th><th>${esc(labels.barcode)}</th>
        <th class="num">${esc(labels.inStock)}</th><th class="num">${esc(labels.sold)}</th>
        <th class="num">${esc(labels.suggested)}</th><th class="num">${esc(labels.order)}</th>
      </tr></thead>
      <tbody>${rows(supplier.items, (item) => `
        <td class="${item.urgent ? 'urgent' : ''}">${esc(item.name)}${item.urgent ? ` — ${esc(labels.outNow)}` : ''}</td>
        <td>${esc(item.barcode)}</td>
        <td class="num">${esc(item.quantity)}</td>
        <td class="num">${esc(item.sold)}</td>
        <td class="num">${esc(item.suggested)}</td>
        <td class="num"><span class="write-in">&nbsp;</span></td>`)}
      </tbody>
    </table>
    <p class="note">${esc(labels.supplierTotal)}: ${esc(supplier.units)} — ${esc(supplier.cost)}</p>`).join('');

  return page({
    title,
    shop,
    when,
    subtitle: labels.basedOn,
    body: `
      <div class="totals">
        <div class="total"><div class="k">${esc(labels.lines)}</div><div class="v">${esc(totals.lines)}</div></div>
        <div class="total"><div class="k">${esc(labels.outNow)}</div><div class="v">${esc(totals.urgent)}</div></div>
        <div class="total"><div class="k">${esc(labels.estimatedCost)}</div><div class="v">${esc(totals.estimatedCost)}</div></div>
      </div>
      ${suppliers.length ? sections : `<p class="note">${esc(labels.nothing)}</p>`}`,
  });
}

/** The whole stock list, for the folder in the office or the insurance file. */
function inventorySheet({ title, shop, when, lines, totals, labels }) {
  return page({
    title,
    shop,
    when,
    body: `
      <div class="totals">
        <div class="total"><div class="k">${esc(labels.products)}</div><div class="v">${esc(totals.items)}</div></div>
        <div class="total"><div class="k">${esc(labels.pieces)}</div><div class="v">${esc(totals.units)}</div></div>
        <div class="total"><div class="k">${esc(labels.retailValue)}</div><div class="v">${esc(totals.retailValue)}</div></div>
        <div class="total"><div class="k">${esc(labels.costValue)}</div><div class="v">${esc(totals.costValue)}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>${esc(labels.product)}</th><th>${esc(labels.barcode)}</th><th>${esc(labels.category)}</th>
          <th class="num">${esc(labels.inStock)}</th><th class="num">${esc(labels.price)}</th>
          <th class="num">${esc(labels.value)}</th>
        </tr></thead>
        <tbody>${rows(lines, (line) => `
          <td>${esc(line.name)}</td>
          <td>${esc(line.barcode)}</td>
          <td>${esc(line.category)}</td>
          <td class="num">${esc(line.quantity)}</td>
          <td class="num">${esc(line.price)}</td>
          <td class="num">${esc(line.value)}</td>`)}
        </tbody>
      </table>
      ${lines.length === 0 ? `<p class="note">${esc(labels.nothing)}</p>` : ''}`,
  });
}

/**
 * A list of invoices, in or out.
 *
 * The same sheet serves both screens, because they are asking the same question
 * of the same records: what did this supplier send us, and what did we sell in
 * this fortnight. The reversed ones are printed rather than dropped — a voided
 * invoice is a thing that happened, and a list that quietly leaves it out is a
 * list somebody will one day reconcile against a bank statement and lose an
 * afternoon to. It is marked instead, and left out of the totals.
 */
function documentsSheet({ title, shop, when, lines, totals, labels }) {
  // One supplier's own sheet has their name in the title, so repeating it on
  // every row is a column of the same eighteen characters. Leaving the label
  // out is how the caller says the column has nothing to say.
  const named = Boolean(labels.who);
  return page({
    title,
    shop,
    when,
    subtitle: totals.range || '',
    body: `
      <div class="totals">
        <div class="total"><div class="k">${esc(labels.count)}</div><div class="v">${esc(totals.count)}</div></div>
        <div class="total"><div class="k">${esc(labels.net)}</div><div class="v">${esc(totals.net)}</div></div>
        <div class="total"><div class="k">${esc(labels.vat)}</div><div class="v">${esc(totals.vat)}</div></div>
        <div class="total"><div class="k">${esc(labels.total)}</div><div class="v">${esc(totals.gross)}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>${esc(labels.date)}</th><th>${esc(labels.number)}</th>
          ${named ? `<th>${esc(labels.who)}</th>` : ''}
          <th class="num">${esc(labels.lines)}</th><th class="num">${esc(labels.net)}</th>
          <th class="num">${esc(labels.vat)}</th><th class="num">${esc(labels.total)}</th>
        </tr></thead>
        <tbody>${rows(lines, (line) => `
          <td>${esc(line.date)}</td>
          <td>${esc(line.number)}${line.mark ? ` <span class="short">${esc(line.mark)}</span>` : ''}</td>
          ${named ? `<td>${esc(line.who)}</td>` : ''}
          <td class="num">${esc(line.lines)}</td>
          <td class="num">${esc(line.net)}</td>
          <td class="num">${esc(line.vat)}</td>
          <td class="num">${esc(line.total)}</td>`)}
        </tbody>
      </table>
      ${lines.length === 0 ? `<p class="note">${esc(labels.nothing)}</p>` : ''}`,
  });
}

/**
 * The VAT return, as a sheet to hand an accountant.
 *
 * Laid out the way a return is: turnover and tax per rate, what was collected,
 * what was paid on purchases, and the difference. The caveat at the bottom is
 * printed on purpose — this is a shop's own arithmetic, not a filing.
 */
/**
 * The price review, for going round the shelves with a pen.
 *
 * Sections in the order they came off the screen, which is the order the shop
 * should work through them — the lines losing money first. Each section is only
 * printed if it has anything in it, because a page of empty headings is a page
 * that teaches the shop the report is not worth printing.
 */
function pricesSheet({ title, shop, when, sections, target, labels }) {
  const list = Array.isArray(sections) ? sections : [];
  const body = list.map((section) => `
    <h2>${esc(section.title)}</h2>
    <table>
      <thead><tr>
        <th>${esc(labels.product)}</th>
        <th class="num">${esc(labels.price)}</th>
        <th class="num">${esc(labels.cost)}</th>
        <th class="num">${esc(labels.usual)}</th>
        <th class="num">${esc(labels.margin)}</th>
        <th class="num">${esc(labels.suggested)}</th>
        <th class="num">&nbsp;</th>
      </tr></thead>
      <tbody>${rows(section.rows || [], (row) => `
        <td>${esc(row.name)}</td>
        <td class="num">${esc(row.price)}</td>
        <td class="num">${esc(row.cost)}</td>
        <td class="num">${esc(row.usual)}</td>
        <td class="num">${esc(row.margin)}</td>
        <td class="num">${esc(row.suggested)}</td>
        <td class="num"><span class="write-in">&nbsp;</span></td>`)}
      </tbody>
    </table>`).join('');

  return page({
    title,
    shop,
    when,
    subtitle: target ? `${labels.targetLabel} ${target}` : '',
    body: body || `<p class="note">${esc(labels.caveat)}</p>`,
    footNote: labels.caveat,
  });
}

function vatSheet({ title, shop, when, lines, totals, labels }) {
  const table = (heading, rates, empty) => `
    <h2>${esc(heading)}</h2>
    <table>
      <thead><tr>
        <th>${esc(labels.rate)}</th>
        <th class="num">${esc(labels.net)}</th>
        <th class="num">${esc(labels.vat)}</th>
        <th class="num">${esc(labels.gross)}</th>
      </tr></thead>
      <tbody>${rates.length ? rows(rates, (r) => `
        <td>${esc(r.rate)}</td>
        <td class="num">${esc(r.net)}</td>
        <td class="num">${esc(r.vat)}</td>
        <td class="num">${esc(r.gross)}</td>`) : `<tr><td colspan="4">${esc(empty)}</td></tr>`}
      </tbody>
    </table>`;

  return page({
    title,
    shop,
    when,
    subtitle: labels.period,
    body: `
      <div class="totals">
        <div class="total"><div class="k">${esc(labels.collected)}</div><div class="v">${esc(totals.collected)}</div></div>
        <div class="total"><div class="k">${esc(labels.paid)}</div><div class="v">${esc(totals.paid)}</div></div>
        <div class="total"><div class="k">${esc(totals.payableLabel)}</div><div class="v">${esc(totals.payable)}</div></div>
      </div>
      ${table(labels.onSales, lines.collected || [], labels.noSales)}
      ${table(labels.onPurchases, lines.paid || [], labels.noPurchases)}
      ${totals.excluded ? `<p class="note">${esc(totals.excluded)}</p>` : ''}
      ${totals.withoutRate ? `<p class="note">${esc(totals.withoutRate)}</p>` : ''}
      <p class="note">${esc(labels.caveat)}</p>`,
    footNote: labels.caveat,
  });
}

const DOCUMENTS = {
  stocktake: stockTakeSheet,
  reorder: reorderSheet,
  inventory: inventorySheet,
  vat: vatSheet,
  prices: pricesSheet,
  documents: documentsSheet,
};

/**
 * Builds one of the known documents. An unknown name is refused rather than
 * guessed at — this is the only entry point the renderer can reach.
 */
function buildDocument(kind, payload = {}) {
  const build = Object.prototype.hasOwnProperty.call(DOCUMENTS, kind) ? DOCUMENTS[kind] : null;
  if (!build) throw new Error(`MyVault has no printable document called "${kind}".`);
  return build({
    title: String(payload.title || 'MyVault'),
    shop: String(payload.shop || ''),
    when: String(payload.when || new Date().toLocaleString()),
    labels: payload.labels || {},
    totals: payload.totals || {},
    // Most documents are a list of rows; the VAT return is two lists, so an
    // object is passed through untouched rather than forced into an array.
    lines: Array.isArray(payload.lines) || (payload.lines && typeof payload.lines === 'object')
      ? payload.lines
      : [],
    suppliers: Array.isArray(payload.suppliers) ? payload.suppliers : [],
    sections: Array.isArray(payload.sections) ? payload.sections : [],
    target: String(payload.target || ''),
    blank: Boolean(payload.blank),
  });
}

module.exports = { buildDocument, esc };
