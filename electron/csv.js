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
      if (header) record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
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

module.exports = { parseCsv, toCsv };
