import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const supplierInvoice = `<!doctype html><meta charset="utf-8">
<style>
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 11pt; margin: 40px; color: #000; }
  h1 { font-size: 15pt; margin: 0 0 4px; }
  .head { display: flex; justify-content: space-between; margin-bottom: 18px; }
  .meta div { margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border-bottom: 1px solid #999; padding: 5px 6px; }
  th { text-align: left; font-size: 10pt; }
  td.n, th.n { text-align: right; }
  .totals { margin-top: 16px; width: 45%; margin-left: auto; }
  .totals td { border: none; padding: 3px 6px; }
</style>
<div class="head">
  <div>
    <h1>ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ Α.Ε.</h1>
    <div>Χονδρικό εμπόριο ποτών</div>
    <div>Λεωφ. Αθηνών 145, Περιστέρι</div>
    <div>Α.Φ.Μ.: 094123456 — Δ.Ο.Υ.: ΦΑΕ ΑΘΗΝΩΝ</div>
  </div>
  <div class="meta">
    <div><b>ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ</b></div>
    <div>Αριθμός: 0000004821</div>
    <div>Ημερομηνία: 14/08/2026</div>
    <div>Πελάτης: ΚΑΦΕ ΤΟ ΣΤΕΚΙ</div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>Κωδικός</th><th>Περιγραφή</th><th class="n">Ποσότητα</th>
      <th class="n">Τιμή</th><th class="n">Έκπτ. %</th><th class="n">ΦΠΑ %</th><th class="n">Αξία</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>5201234567890</td><td>Ούζο Πλωμαρίου 700ml</td><td class="n">12</td><td class="n">6,20</td><td class="n">0</td><td class="n">24</td><td class="n">74,40</td></tr>
    <tr><td>5209876543210</td><td>Ρετσίνα Μαλαματίνα 500ml</td><td class="n">24</td><td class="n">1,15</td><td class="n">10</td><td class="n">24</td><td class="n">24,84</td></tr>
    <tr><td>5205555512345</td><td>Ελαιόλαδο έξτρα παρθένο 1L</td><td class="n">6</td><td class="n">7,00</td><td class="n">0</td><td class="n">13</td><td class="n">42,00</td></tr>
    <tr><td>5201111122223</td><td>Καφές φίλτρου 250g</td><td class="n">10</td><td class="n">2,10</td><td class="n">5</td><td class="n">24</td><td class="n">19,95</td></tr>
  </tbody>
</table>
<table class="totals">
  <tr><td>Καθαρή αξία</td><td class="n">161,19</td></tr>
  <tr><td>Φ.Π.Α.</td><td class="n">34,07</td></tr>
  <tr><td><b>Σύνολο</b></td><td class="n"><b>195,26</b></td></tr>
</table>`;

const englishInvoice = `<!doctype html><meta charset="utf-8">
<style>
 body{font-family:Arial,sans-serif;font-size:11pt;margin:40px}
 table{width:100%;border-collapse:collapse;margin-top:14px}
 th,td{border-bottom:1px solid #bbb;padding:5px}
 th{text-align:left}
 td.n,th.n{text-align:right}
</style>
<h2>NORTHGATE WHOLESALE LTD</h2>
<p>Invoice No: INV-2026-3391<br>Date: 03/09/2026<br>VAT Reg: GB 348 2211 09</p>
<table>
 <tr><th>Code</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Disc %</th><th class="n">VAT %</th><th class="n">Amount</th></tr>
 <tr><td>NG-4410</td><td>Sparkling water 1L</td><td class="n">48</td><td class="n">0.42</td><td class="n">0</td><td class="n">20</td><td class="n">20.16</td></tr>
 <tr><td>NG-7781</td><td>Ground coffee 1kg</td><td class="n">6</td><td class="n">11.50</td><td class="n">2.5</td><td class="n">20</td><td class="n">67.28</td></tr>
 <tr><td>NG-1020</td><td>Paper bags (500)</td><td class="n">2</td><td class="n">14.00</td><td class="n">0</td><td class="n">20</td><td class="n">28.00</td></tr>
</table>
<p style="text-align:right">Subtotal 115.44<br>VAT 23.09<br>Total due 138.53</p>`;

const scanned = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
  <rect width="600" height="800" fill="#f2f2ef"/>
  <rect x="60" y="70" width="330" height="16" fill="#3a3a3a"/>
  <rect x="60" y="120" width="480" height="9" fill="#555"/>
  <rect x="60" y="140" width="440" height="9" fill="#555"/>
  <rect x="60" y="200" width="480" height="9" fill="#555"/>
</svg>`;


const mismatched = `<!doctype html><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;font-size:11pt;margin:40px}
table{width:100%;border-collapse:collapse;margin-top:14px}
th,td{border-bottom:1px solid #bbb;padding:5px}th{text-align:left}
td.n,th.n{text-align:right}</style>
<h2>SLOPPY SUPPLIES</h2>
<p>Invoice No: 77-B<br>Date: 21/07/2026</p>
<table>
 <tr><th>Code</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">VAT %</th><th class="n">Amount</th></tr>
 <tr><td>5201234567890</td><td>Ouzo 700ml</td><td class="n">10</td><td class="n">6.00</td><td class="n">24</td><td class="n">60.00</td></tr>
 <tr><td>5209876543210</td><td>Retsina 500ml</td><td class="n">5</td><td class="n">2.00</td><td class="n">24</td><td class="n">12.50</td></tr>
</table>
<p style="text-align:right">Net 72.50<br>VAT 17.40<br>Total due 89.90</p>`;

/**
 * The layout a real Greek accounting package prints.
 *
 * Modelled line for line on an actual Epsilon Net invoice — the same label grid
 * for the number and the date, the same unit-of-measure column, the same pair of
 * "amount before discount" and "net amount" headings, the same summary block of
 * balances underneath — with every name, number and bank account invented. The
 * layout is what broke the reader; the shop's details were nobody's business and
 * are not in here.
 */
const epsilonStyle = `<!doctype html><meta charset="utf-8">
<style>
  body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:7.5pt;margin:24px;color:#000}
  .head{text-align:center;line-height:1.35}
  .head .name{font-size:11pt;font-weight:bold}
  .title{text-align:center;font-weight:bold;margin:10px 0 6px}
  table{width:100%;border-collapse:collapse}
  .grid td{border:1px solid #999;padding:2px 4px}
  .items{margin-top:8px}
  .items th{border:1px solid #999;padding:2px 3px;font-weight:normal;text-align:left}
  .items td{border:1px solid #999;padding:2px 3px}
  .items .n{text-align:right}
  .summary{margin-top:150px}
  .summary td{padding:2px 6px}
  .summary .n{text-align:right}
  .legal{margin-top:26px;font-size:6pt;line-height:1.5}
</style>
<div class="head">
  <div class="name">ΚΑΡΑΓΙΑΝΝΗΣ Α. ΝΙΚΟΛΑΟΣ</div>
  <div>ΧΑΡΤΙΚΑ * ΠΛΑΣΤΙΚΑ * ΑΠΟΡΡΥΠΑΝΤΙΚΑ * ΕΙΔΗ ΣΥΣΚΕΥΑΣΙΑΣ</div>
  <div>2ο χλμ Επαρχιακής Οδού * 46100 ΠΑΡΑΔΕΙΓΜΑΤΟΥΠΟΛΗ</div>
  <div>ΤΗΛ: 26650 00000 * FAX 26650 00001</div>
  <div>ΑΦΜ:999000111 * ΔΟΥ: ΠΑΡΑΔΕΙΓΜΑΤΟΣ</div>
</div>
<div class="title">ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ -ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ</div>
<table class="grid">
  <tr><td>Σχετικά</td><td>Σειρά</td><td>Αριθμός</td><td>Ημερομηνία</td><td>Ωρα</td></tr>
  <tr><td>Παραστατικά</td><td>1</td><td>007412</td><td>18/08/2026</td><td>8:46</td></tr>
</table>
<table class="items">
  <tr>
    <th>Κωδικός</th><th>Περιγραφή είδους</th><th>Μ.Μ</th><th class="n">Ποσότητ</th>
    <th class="n">Τιμή μον.</th><th class="n">Αξία Προ Εκ</th><th class="n">Έκπτω</th>
    <th class="n">Καθαρή αξία</th><th class="n">ΦΠΑ%</th>
  </tr>
  <tr>
    <td>558</td><td>ΤΣΑΝΤΑ ΧΑΡΤΙΝΗ (37*26*12)</td><td>Τεμάχια</td><td class="n">1,00</td>
    <td class="n">8,4600</td><td class="n">8,46</td><td class="n">0,00</td>
    <td class="n">8,46</td><td class="n">24,00</td>
  </tr>
  <tr>
    <td>612</td><td>ΣΑΚΟΥΛΕΣ ΑΠΟΡΡΙΜΜΑΤΩΝ 52*75</td><td>Κιβώτια</td><td class="n">4,00</td>
    <td class="n">12,5000</td><td class="n">50,00</td><td class="n">5,00</td>
    <td class="n">47,50</td><td class="n">24,00</td>
  </tr>
</table>
<table class="items summary">
  <tr>
    <td>Προηγ. Υπόλοιπο</td><td>Ανάλυση ανά κατηγορία ΦΠΑ</td><td></td><td class="n"></td>
    <td class="n"></td><td class="n"></td><td class="n">Αξία προ έκπτωσης</td>
    <td class="n">58,46</td><td class="n"></td>
  </tr>
  <tr>
    <td>-4,48</td><td>Καθ. αξία Φ.Π.Α. % Αξία Φ.Π.Α. Συν. Αξία</td><td></td><td class="n"></td>
    <td class="n"></td><td class="n"></td><td class="n">Έκπτωση</td>
    <td class="n">2,50</td><td class="n"></td>
  </tr>
  <tr>
    <td>Νέο Υπόλοιπο</td><td></td><td></td><td class="n">55,96</td>
    <td class="n">24,00</td><td class="n">13,43</td><td class="n">69,39</td>
    <td class="n">Φ.Π.Α.</td><td class="n">13,43</td>
  </tr>
  <tr>
    <td>51,48</td><td>Σύνολο Ποσότητας</td><td></td><td class="n">5,00</td>
    <td class="n"></td><td class="n"></td><td class="n">Γενικό Σύνολο</td>
    <td class="n">69,39</td><td class="n"></td>
  </tr>
  <tr>
    <td></td><td>Παρατηρήσεις</td><td></td><td class="n"></td>
    <td class="n"></td><td class="n"></td><td class="n">Πληρωτέο</td>
    <td class="n">69,39</td><td class="n"></td>
  </tr>
</table>
<div class="legal">
  ΤΑ ΕΜΠΟΡΕΥΜΑΤΑ ΤΑΞΙΔΕΥΟΥΝ ΓΙΑ ΛΟΓΑΡΙΑΣΜΟ ΚΑΙ ΜΕ ΚΙΝΔΥΝΟ ΤΟΥ ΠΕΛΑΤΗ. 1,00 Mark: 400014893621007<br>
  UID: 1682B14C1D5FBFF7E8AD4203B96183E67820D6C7<br>
  Epsilon Net AE Σελίδα 1 από 1
</div>`;

/** An invoice that runs to a second page, carry-over line and all. */
const twoPages = `<!doctype html><meta charset="utf-8">
<style>
 body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:9pt;margin:30px}
 table{width:100%;border-collapse:collapse;margin-top:8px}
 th,td{border-bottom:1px solid #bbb;padding:3px}
 th{text-align:left;font-weight:normal}
 td.n,th.n{text-align:right}
 .break{page-break-after:always}
</style>
<h3>ΒΟΡΕΙΑ ΤΡΟΦΟΔΟΣΙΑ Α.Ε.</h3>
<p>Αριθμός: 5567 &nbsp; Ημερομηνία: 02/09/2026</p>
<table>
 <tr><th>Κωδικός</th><th>Περιγραφή είδους</th><th class="n">Ποσότητα</th><th class="n">Τιμή μον.</th><th class="n">Έκπτω</th><th class="n">ΦΠΑ%</th><th class="n">Καθαρή αξία</th></tr>
 <tr><td>A-1</td><td>Αλεύρι 1kg</td><td class="n">10</td><td class="n">1,20</td><td class="n">0</td><td class="n">13</td><td class="n">12,00</td></tr>
 <tr><td>A-2</td><td>Ζάχαρη 1kg</td><td class="n">8</td><td class="n">1,50</td><td class="n">0</td><td class="n">13</td><td class="n">12,00</td></tr>
 <tr><td></td><td>Μεταφορά</td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n">24,00</td></tr>
</table>
<div class="break"></div>
<p>Σελίδα 2 από 2</p>
<table>
 <tr><th>Κωδικός</th><th>Περιγραφή είδους</th><th class="n">Ποσότητα</th><th class="n">Τιμή μον.</th><th class="n">Έκπτω</th><th class="n">ΦΠΑ%</th><th class="n">Καθαρή αξία</th></tr>
 <tr><td></td><td>Εκ μεταφοράς</td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n">24,00</td></tr>
 <tr><td>A-7</td><td>Ρύζι 1kg</td><td class="n">6</td><td class="n">2,00</td><td class="n">0</td><td class="n">13</td><td class="n">12,00</td></tr>
 <tr><td>A-9</td><td>Λάδι 5L</td><td class="n">2</td><td class="n">30,00</td><td class="n">10</td><td class="n">13</td><td class="n">54,00</td></tr>
</table>
<p style="text-align:right">Καθαρή αξία 90,00<br>Φ.Π.Α. 11,70<br>Γενικό Σύνολο 101,70</p>`;

/** A credit note: goods going back, printed exactly like an invoice. */
const creditNote = `<!doctype html><meta charset="utf-8">
<style>
 body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:9pt;margin:30px}
 table{width:100%;border-collapse:collapse;margin-top:8px}
 th,td{border-bottom:1px solid #bbb;padding:3px}
 th{text-align:left;font-weight:normal}
 td.n,th.n{text-align:right}
</style>
<h3>ΒΟΡΕΙΑ ΤΡΟΦΟΔΟΣΙΑ Α.Ε.</h3>
<div style="text-align:center;font-weight:bold">ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ</div>
<p>Αριθμός: 118 &nbsp; Ημερομηνία: 09/09/2026</p>
<table>
 <tr><th>Κωδικός</th><th>Περιγραφή είδους</th><th class="n">Ποσότητα</th><th class="n">Τιμή μον.</th><th class="n">ΦΠΑ%</th><th class="n">Καθαρή αξία</th></tr>
 <tr><td>A-9</td><td>Λάδι 5L</td><td class="n">1</td><td class="n">30,00</td><td class="n">13</td><td class="n">30,00</td></tr>
</table>
<p style="text-align:right">Καθαρή αξία 30,00<br>Φ.Π.Α. 3,90<br>Γενικό Σύνολο 33,90</p>`;


/**
 * The shapes a shop meets that are not Greek and not English.
 *
 * Each of these was written because the reader got it wrong: the French one was
 * refused outright for having no table, the Spanish one lost its code and
 * discount columns, and the one whose discount is printed as money rather than
 * as a rate had every line disagreeing with the paper. They are kept so that
 * stays fixed.
 */
const shared = `body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:11pt;margin:36px}
h1{font-size:14pt;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border-bottom:1px solid #999;padding:4px 6px}th{text-align:left;font-size:10pt}
td.n,th.n{text-align:right}.tot{margin-top:14px;width:46%;margin-left:auto}.tot td{border:none}`;

const sheet = (title, meta, head, rows, totals) => `<!doctype html><meta charset="utf-8">
<style>${shared}</style><h1>${title}</h1><div>${meta}</div>
<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
<table class="tot">${totals}</table>`;

/** Dot thousands, comma decimals, dd.mm.yyyy, and two VAT rates on one page. */
const german = sheet('Getränke Grosshandel GmbH',
  'Rechnung Nr. 2026-0442<br>Datum: 14.08.2026',
  '<th>Art.-Nr.</th><th>Bezeichnung</th><th class="n">Menge</th><th class="n">Einzelpreis</th><th class="n">MwSt %</th><th class="n">Betrag</th>',
  `<tr><td>A-1001</td><td>Mineralwasser 1L</td><td class="n">24</td><td class="n">0,45</td><td class="n">19</td><td class="n">10,80</td></tr>
   <tr><td>A-1002</td><td>Apfelsaft naturtrüb 1L</td><td class="n">12</td><td class="n">1,20</td><td class="n">19</td><td class="n">14,40</td></tr>
   <tr><td>A-1003</td><td>Kaffeebohnen 1kg</td><td class="n">6</td><td class="n">12,50</td><td class="n">7</td><td class="n">75,00</td></tr>`,
  '<tr><td>Nettobetrag</td><td class="n">100,20</td></tr><tr><td>MwSt</td><td class="n">17,08</td></tr><tr><td><b>Gesamtbetrag</b></td><td class="n"><b>117,28</b></td></tr>');

/** "Código", "Dto %" and "Base imponible" — three headings that were unreadable. */
const spanish = sheet('Distribuciones García S.L.',
  'Factura Nº F-2026/318<br>Fecha: 03/08/2026',
  '<th>Código</th><th>Descripción</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Dto %</th><th class="n">IVA %</th><th class="n">Importe</th>',
  `<tr><td>ES-01</td><td>Aceite de oliva 1L</td><td class="n">12</td><td class="n">4,80</td><td class="n">0</td><td class="n">10</td><td class="n">57,60</td></tr>
   <tr><td>ES-02</td><td>Arroz bomba 1kg</td><td class="n">20</td><td class="n">2,15</td><td class="n">5</td><td class="n">10</td><td class="n">40,85</td></tr>`,
  '<tr><td>Base imponible</td><td class="n">98,45</td></tr><tr><td>IVA</td><td class="n">9,85</td></tr><tr><td><b>Total</b></td><td class="n"><b>108,30</b></td></tr>');

/** Every heading accented. This one was refused outright before. */
const french = sheet('Établissements Dubois SARL',
  'Facture N° 2026-1177<br>Date : 21/07/2026',
  '<th>Réf.</th><th>Désignation</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">TVA %</th><th class="n">Montant</th>',
  `<tr><td>FR-9</td><td>Farine T55 5kg</td><td class="n">10</td><td class="n">3,90</td><td class="n">5,5</td><td class="n">39,00</td></tr>
   <tr><td>FR-12</td><td>Sucre en poudre 1kg</td><td class="n">15</td><td class="n">1,10</td><td class="n">5,5</td><td class="n">16,50</td></tr>`,
  '<tr><td>Total HT</td><td class="n">55,50</td></tr><tr><td>TVA</td><td class="n">3,05</td></tr><tr><td><b>Total TTC</b></td><td class="n"><b>58,55</b></td></tr>');

/** The quantity carries its unit, and a line runs past a thousand. */
const unitsAndThousands = sheet('Northern Supply Co.',
  'Invoice 88214<br>Date: 2026-08-05',
  '<th>SKU</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">VAT</th><th class="n">Amount</th>',
  `<tr><td>NS-100</td><td>Flour, plain</td><td class="n">12 pcs</td><td class="n">1.95</td><td class="n">20%</td><td class="n">23.40</td></tr>
   <tr><td>NS-101</td><td>Sunflower oil 5L</td><td class="n">6 pcs</td><td class="n">8.40</td><td class="n">20%</td><td class="n">50.40</td></tr>
   <tr><td>NS-102</td><td>Rice 25kg sack</td><td class="n">80 pcs</td><td class="n">17.25</td><td class="n">20%</td><td class="n">1,380.00</td></tr>`,
  '<tr><td>Net</td><td class="n">1,453.80</td></tr><tr><td>VAT</td><td class="n">290.76</td></tr><tr><td><b>Total</b></td><td class="n"><b>1,744.56</b></td></tr>');

/** The discount is money, and there is no rate anywhere to read it from. */
const moneyDiscount = sheet('Vasilis Trading',
  'ΤΙΜΟΛΟΓΙΟ 5512<br>Ημερομηνία: 09/08/2026',
  '<th>Κωδικός</th><th>Περιγραφή</th><th class="n">Ποσότητα</th><th class="n">Τιμή</th><th class="n">Ποσό έκπτωσης</th><th class="n">ΦΠΑ %</th><th class="n">Καθαρή αξία</th>',
  `<tr><td>V-1</td><td>Χαρτοπετσέτες 100τεμ</td><td class="n">20</td><td class="n">0,90</td><td class="n">1,80</td><td class="n">24</td><td class="n">16,20</td></tr>
   <tr><td>V-2</td><td>Ποτήρια πλαστικά 50τεμ</td><td class="n">30</td><td class="n">1,40</td><td class="n">4,20</td><td class="n">24</td><td class="n">37,80</td></tr>`,
  '<tr><td>Καθαρή αξία</td><td class="n">54,00</td></tr><tr><td>ΦΠΑ</td><td class="n">12,96</td></tr><tr><td><b>Σύνολο</b></td><td class="n"><b>66,96</b></td></tr>');

/** A small supplier on one rate, who prints no VAT column at all. */
const noVatColumn = sheet('Corner Bakery Supplies',
  'Invoice 4471<br>Date: 11/08/2026',
  '<th>Code</th><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Total</th>',
  `<tr><td>CB-1</td><td>Baking paper 50m</td><td class="n">8</td><td class="n">3.25</td><td class="n">26.00</td></tr>
   <tr><td>CB-2</td><td>Piping bags 100</td><td class="n">4</td><td class="n">5.50</td><td class="n">22.00</td></tr>`,
  '<tr><td>Net</td><td class="n">48.00</td></tr><tr><td>VAT 20%</td><td class="n">9.60</td></tr><tr><td><b>Total</b></td><td class="n"><b>57.60</b></td></tr>');

/** Not an invoice at all: a bill with an amount due and nothing to deliver. */
const utilityBill = `<!doctype html><meta charset="utf-8"><style>${shared}</style>
<h1>City Water Board</h1><div>Account 55-2213-9<br>Billing period: 01/07/2026 – 31/07/2026</div>
<p>Meter reading previous: 4,182 &nbsp; current: 4,231</p>
<table class="tot"><tr><td>Water used</td><td class="n">49 m³</td></tr>
<tr><td>Standing charge</td><td class="n">8,00</td></tr>
<tr><td><b>Amount due</b></td><td class="n"><b>73,40</b></td></tr></table>
<p>Please pay within 30 days.</p>`;

/**
 * A heading so wide it wraps onto three rows, with a per-cent discount and the
 * money it came to side by side.
 *
 * MyVault does not read this one, and the fixture is kept for that reason: it
 * refuses the file rather than importing the nonsense it used to make of it.
 * See tests/invoice-formats.test.js.
 */
const wrappedHeading = `<!doctype html><meta charset="utf-8"><style>${shared}</style>
<h1>Impact Wholesale</h1><div>ΤΙΜΟΛΟΓΙΟ 0001744<br>Ημερομηνία: 01/08/2026</div>
<table><thead><tr><th>Κωδικός</th><th>Περιγραφή</th><th class="n">Ποσότητα</th>
<th class="n">Τιμή</th><th class="n">Έκπτ. %</th><th class="n">Ποσό έκπτωσης</th>
<th class="n">ΦΠΑ %</th><th class="n">Καθαρή αξία</th></tr></thead><tbody>
<tr><td>G0009</td><td>MONOPOLY CLASSIC</td><td class="n">1</td><td class="n">31,01</td><td class="n">22</td><td class="n">6,82</td><td class="n">24</td><td class="n">24,19</td></tr>
<tr><td>W2087</td><td>UNO ΚΑΡΤΕΣ</td><td class="n">4</td><td class="n">7,23</td><td class="n">22</td><td class="n">6,36</td><td class="n">24</td><td class="n">22,56</td></tr>
</tbody></table>
<table class="tot"><tr><td>Καθαρή αξία</td><td class="n">46,75</td></tr>
<tr><td>ΦΠΑ</td><td class="n">11,22</td></tr><tr><td><b>Σύνολο</b></td><td class="n"><b>57,97</b></td></tr></table>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const [name, html] of [
  ['supplier-greek', supplierInvoice], ['supplier-english', englishInvoice],
  ['scanned-no-text', scanned], ['mismatched', mismatched], ['epsilon-style', epsilonStyle],
  ['two-pages', twoPages], ['credit-note', creditNote],
  ['german', german], ['spanish', spanish], ['french', french],
  ['units-and-thousands', unitsAndThousands], ['money-discount', moneyDiscount],
  ['no-vat-column', noVatColumn], ['utility-bill', utilityBill],
  ['wrapped-heading', wrappedHeading],
]) {
  await page.setContent(html, { waitUntil: 'load' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  writeFileSync(`tests/fixtures/${name}.pdf`, pdf);
  console.log(name, pdf.length, 'bytes');
}
await browser.close();
