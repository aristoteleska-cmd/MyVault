'use strict';

/**
 * Minimal, dependency-free CSV reader/writer.
 *
 * Handles quoted fields, embedded commas/newlines, escaped quotes, a UTF-8 BOM
 * and both comma and semicolon delimiters (European spreadsheets export
 * semicolons, which is what most small shops will have).
 */

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  if (!clean.trim()) return [];

  const delimiter = detectDelimiter(clean);
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') { value += '"'; i += 1; }
        else inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(value); value = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; continue; }
    value += char;
  }
  row.push(value);
  rows.push(row);

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = restoreFormula((cells[index] ?? '').trim());
    });
    return record;
  });
}

/**
 * Characters a spreadsheet reads as "this cell is a formula".
 *
 * Excel, LibreOffice and Google Sheets all treat a cell beginning with one of
 * these as an expression to evaluate rather than text to show. That matters here
 * because a product name is not something the shop typed: names arrive from
 * suppliers' CSV files and from barcode labels, travel through MyVault, and come
 * back out of the export — so a name like `=cmd|'/c calc'!A0` would sit quietly
 * in the stock list and then run when somebody opened the export.
 *
 * Nothing is removed. A leading apostrophe is what a spreadsheet itself uses to
 * mean "this is text", so the cell still reads as the shop wrote it and the file
 * is still a faithful copy of the stock list.
 */
const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'];

function neutraliseFormula(str) {
  return FORMULA_STARTERS.includes(str[0]) ? `'${str}` : str;
}

/**
 * The exact inverse, applied on the way in.
 *
 * Without it MyVault's own export and import would not round-trip: a product
 * called `-500ml` would come back as `'-500ml`, and again the next time, growing
 * an apostrophe with every trip. Only an apostrophe that is doing the escaping
 * job is removed — one in front of a character a spreadsheet would have treated
 * as a formula — so a name that genuinely begins with an apostrophe is untouched.
 */
function restoreFormula(str) {
  return str[0] === "'" && FORMULA_STARTERS.includes(str[1]) ? str.slice(1) : str;
}

function escapeCell(value) {
  const str = neutraliseFormula(
    value === null || value === undefined ? '' : String(value),
  );
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  // BOM keeps accented characters readable when the file is opened in Excel.
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = {
  neutraliseFormula,
  restoreFormula, parseCsv, toCsv };
