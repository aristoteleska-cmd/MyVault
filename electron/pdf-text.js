'use strict';

/**
 * Getting the words, and where they sit, out of a PDF.
 *
 * A PDF is not a document in the sense a person means it. It is a list of
 * instructions for putting glyphs at coordinates, and the fact that a run of
 * them looks like a table is something the eye does, not something the file
 * says. There are no rows in there, no columns, and frequently no spaces: a
 * line reading "Ούζο 700ml   12   6,20" may arrive as eleven separate pieces of
 * text, each with its own position, in whatever order the producer emitted them.
 *
 * So this module does one job and refuses to do the next one. It gathers the
 * pieces with their coordinates, groups them into lines by how far apart they
 * are vertically, and orders each line left to right. What those columns *mean*
 * is a separate question, answered in ./invoice-read.js against these lines —
 * separate because meaning is where the guessing lives, and guessing is much
 * easier to test when it is a function from text to numbers with no PDF in
 * sight.
 *
 * Everything happens on this machine. pdfjs is bundled into the app, no page is
 * ever uploaded, and the parser is handed bytes rather than a path so it has
 * nothing to open on its own account.
 */

/**
 * How close two pieces of text have to be, vertically, to be the same line.
 *
 * Expressed as a fraction of the text's own height so it holds for a heading
 * and for the small print. Table rows in a real invoice are typically a whole
 * line-height apart; superscripts and the odd baseline wobble are much less.
 */
const SAME_LINE = 0.5;

/**
 * A gap wide enough to mean "different column", as a multiple of a space.
 *
 * Used only to decide whether to put a space between two pieces of text when
 * flattening a line to a string. The reader works off the coordinates, not the
 * flattened string, so this affects readability rather than correctness.
 */
const GAP_IS_SPACE = 0.25;

/** Nothing sane has this many pages, and a malformed file can claim to. */
const MAX_PAGES = 40;

let pdfjs = null;

/**
 * Loads pdfjs once, on the first PDF a shop opens.
 *
 * It is a couple of megabytes of parser and most shops never read a PDF at all,
 * so it stays off the startup path. The legacy build is the one that runs on
 * plain Node without a DOM, which is what the main process is.
 */
async function library() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjs;
}

/**
 * One page's text, as lines of positioned pieces.
 *
 * Coordinates are in PDF units with the origin moved to the top left, because
 * every question anybody asks of an invoice — "what is above this?", "which
 * column is this in?" — is easier to think about the way the page is read.
 */
function linesFrom(textContent, viewport) {
  const pieces = [];

  for (const item of textContent.items) {
    const text = typeof item.str === 'string' ? item.str : '';
    if (!text.trim()) continue;

    // transform is [a, b, c, d, e, f]; e and f are where the piece starts and
    // d is its height once scaled. The y is flipped so the top of the page is 0.
    const [, , , scaleY, x, y] = item.transform;
    const height = Math.abs(scaleY) || Math.abs(item.height) || 10;
    pieces.push({
      text,
      x,
      y: viewport.height - y,
      width: item.width || 0,
      height,
    });
  }

  pieces.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const lines = [];
  for (const piece of pieces) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(piece.height, last ? last.height : 0) * SAME_LINE;
    if (last && Math.abs(piece.y - last.y) <= tolerance) {
      last.pieces.push(piece);
      last.height = Math.max(last.height, piece.height);
    } else {
      lines.push({ y: piece.y, height: piece.height, pieces: [piece] });
    }
  }

  for (const line of lines) {
    line.pieces.sort((a, b) => a.x - b.x);
    // The flattened string, with a space wherever the gap between two pieces is
    // wide enough that a person would read one. Pieces that already end in a
    // space are left alone rather than given a second one.
    let text = '';
    let cursor = null;
    for (const piece of line.pieces) {
      if (cursor !== null) {
        const gap = piece.x - cursor;
        const wide = gap > piece.height * GAP_IS_SPACE;
        if (wide && !/\s$/.test(text) && !/^\s/.test(piece.text)) text += ' ';
      }
      text += piece.text;
      cursor = piece.x + piece.width;
    }
    line.text = text.replace(/\s+/g, ' ').trim();
    line.x = line.pieces[0].x;
    line.right = cursor;
  }

  return lines.filter((line) => line.text);
}

/**
 * Reads a PDF's text, page by page.
 *
 * @param {Uint8Array|Buffer} bytes the file, already checked to be a PDF
 * @returns {Promise<{pages: Array, characters: number, scanned: boolean}>}
 *
 * `scanned` is the important one for a shop. A PDF produced by a scanner or a
 * photocopier is a picture of a page with no text in it at all, and no amount of
 * parsing will find words that were never written. Saying so plainly — "this is
 * a photograph of an invoice, type it or ask for a different file" — is the only
 * honest answer, and much better than an empty result that reads as a failure of
 * the program.
 */
async function extractPdfText(bytes) {
  const { getDocument } = await library();

  const task = getDocument({
    data: new Uint8Array(bytes),
    // No fonts fetched, no images decoded, nothing from anywhere but this file.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });

  let document;
  try {
    document = await task.promise;
  } catch (error) {
    const message = String(error?.message || error);
    if (/password/i.test(message)) {
      throw new Error('That PDF is locked with a password, so MyVault cannot read it.');
    }
    throw new Error('That PDF could not be opened. It may be damaged or only partly downloaded.');
  }

  try {
    const pages = [];
    let characters = 0;
    const count = Math.min(document.numPages, MAX_PAGES);

    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines = linesFrom(content, viewport);
      for (const line of lines) characters += line.text.length;
      pages.push({ number, width: viewport.width, height: viewport.height, lines });
      page.cleanup();
    }

    return {
      pages,
      characters,
      pageCount: document.numPages,
      truncated: document.numPages > count,
      // A handful of stray characters is what a scanned page with a page number
      // stamped on it produces, and it is not text worth parsing either.
      scanned: characters < 40,
    };
  } finally {
    await document.destroy();
  }
}

module.exports = { extractPdfText, linesFrom, SAME_LINE, MAX_PAGES };
