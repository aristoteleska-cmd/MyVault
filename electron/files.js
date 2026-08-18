'use strict';

/**
 * What a file is allowed to be.
 *
 * Everything MyVault reads off the disk comes through here: the photo the shop
 * picks to read a barcode out of, a supplier's CSV, a backup being restored.
 * One place, so a rule cannot be enforced on one path and forgotten on another.
 *
 * The rule that matters is that **the bytes decide, not the name**. A file
 * called `barcode.png` is a claim, not a fact; the extension is chosen by
 * whoever produced the file and a shop is as likely to be handed a mislabelled
 * one by accident as on purpose. So a picture is identified by its own header
 * and labelled with what it actually is, and anything whose header is not a
 * picture MyVault can read is refused before a byte of it reaches the window.
 *
 * That refusal is the whole point for one format in particular. SVG is the only
 * common image format that can carry script, and an <svg onload="…"> renamed to
 * .png would be handed to the window as `data:image/png` today. It cannot run
 * there — the window declares the type and the browser believes the declaration
 * rather than sniffing — but the layer that stops it should be one that says no,
 * not one that happens not to say yes. SVG is not on the list below and reading
 * the header is what makes leaving it off mean something.
 *
 * The limits are the other half. A photograph from a phone is a few megabytes
 * and a few thousand pixels on its longest edge; a file claiming to be eighty
 * thousand pixels square is either broken or built to be opened, and the window
 * would try to draw it on a canvas. Both are capped, and a picture whose header
 * cannot be read for dimensions is allowed through on its file size alone —
 * refusing a real photograph because this file could not measure it would be a
 * worse failure than the one being prevented.
 */

const fs = require('fs');
const path = require('path');

/** A phone photograph is 2–8 MB. Anything past this is not a barcode photo. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * The longest edge, and the total pixels, a picture may have.
 *
 * The scanner resizes down to 2400 pixels before decoding anyway, so nothing
 * above this helps it. A 60-megapixel limit leaves every real camera through
 * and stops a small file that claims to unpack into something enormous.
 */
const MAX_IMAGE_EDGE = 20000;
const MAX_IMAGE_PIXELS = 60 * 1000 * 1000;

/** A stock list of 50,000 products is about 8 MB of CSV. */
const MAX_CSV_BYTES = 64 * 1024 * 1024;

/** A backup of the same shop, with its settings and staff, is smaller still. */
const MAX_JSON_BYTES = 64 * 1024 * 1024;

/**
 * The picture formats a barcode can arrive in, by the bytes they start with.
 *
 * Deliberately a short list. Every one of these is a bitmap that a browser
 * draws and nothing else — no script, no external references, no document.
 */
const SIGNATURES = [
  {
    mime: 'image/png',
    label: 'PNG',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/jpeg',
    label: 'JPEG',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    label: 'GIF',
    test: (b) => b.length > 6
      && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a'),
  },
  {
    mime: 'image/webp',
    label: 'WebP',
    test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF'
      && b.toString('latin1', 8, 12) === 'WEBP',
  },
  {
    mime: 'image/bmp',
    label: 'BMP',
    // Two bytes is a thin signature, so the size field in the header has to
    // agree with the file as well before this is believed.
    test: (b) => b.length > 14 && b[0] === 0x42 && b[1] === 0x4d,
  },
];

/** What the file actually is, or null if it is not a picture we accept. */
function sniffImage(buffer) {
  for (const signature of SIGNATURES) {
    if (signature.test(buffer)) return signature;
  }
  return null;
}

/**
 * How big the picture claims to be, read from its own header.
 *
 * Null when it cannot be worked out — a WebP in a variant not covered here, or
 * a JPEG whose size marker sits past the first chunk. The caller treats that as
 * "no opinion" rather than as a refusal.
 */
function imageSize(buffer, mime) {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      // IHDR is always the first chunk, so the dimensions are at a fixed place.
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }

    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }

    if (mime === 'image/bmp' && buffer.length >= 26) {
      // Signed: a BMP stores height negative when the rows run top-down.
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
    }

    if (mime === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.toString('latin1', 12, 16);
      if (chunk === 'VP8X') {
        return {
          width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
          height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
        };
      }
      if (chunk === 'VP8 ') {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      return null;
    }

    if (mime === 'image/jpeg') {
      // Walk the segments to the start-of-frame, which is where the size lives.
      let at = 2;
      while (at + 9 < buffer.length) {
        if (buffer[at] !== 0xff) { at += 1; continue; }
        const marker = buffer[at + 1];
        // Start-of-frame, any encoding, except the four that are not frames.
        if (marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && marker !== 0xd8) {
          return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          at += 2;
          continue;
        }
        const length = buffer.readUInt16BE(at + 2);
        if (length < 2) return null;
        at += 2 + length;
      }
      return null;
    }
  } catch {
    // A header too short or malformed to read is not a crash; it is an unknown.
    return null;
  }
  return null;
}

/**
 * Refuses anything that is not an ordinary file the current user can read.
 *
 * A directory, a device, a pipe or a socket can all be reached by typing a path
 * into the file dialog, and reading one either fails oddly or never returns.
 */
function assertOrdinaryFile(filePath, { maxBytes, what }) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw new Error('That file could not be opened.');
  }

  if (stats.isDirectory()) throw new Error('That is a folder, not a file.');
  if (!stats.isFile()) throw new Error('That is not an ordinary file.');
  if (stats.size === 0) throw new Error('That file is empty.');
  if (stats.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`That ${what} is too large. Anything up to ${mb} MB is fine.`);
  }
  return stats;
}

/**
 * Reads a picture the shop chose, having satisfied itself that it is one.
 *
 * Returns the data URL the window renders, labelled with the type found in the
 * file rather than the one implied by its name.
 */
function readImageFile(filePath) {
  assertOrdinaryFile(filePath, { maxBytes: MAX_IMAGE_BYTES, what: 'picture' });

  const bytes = fs.readFileSync(filePath);
  const found = sniffImage(bytes);
  if (!found) {
    throw new Error(
      'That file is not a picture MyVault can read. '
      + 'JPEG, PNG, GIF, WebP and BMP photographs work; anything else — including '
      + 'a drawing saved as SVG — does not, whatever the file is called.',
    );
  }

  const size = imageSize(bytes, found.mime);
  if (size && (size.width > 0 || size.height > 0)) {
    const pixels = size.width * size.height;
    if (size.width > MAX_IMAGE_EDGE || size.height > MAX_IMAGE_EDGE || pixels > MAX_IMAGE_PIXELS) {
      throw new Error(
        `That picture says it is ${size.width} × ${size.height}, which is far larger `
        + 'than any camera produces. MyVault will not try to open it.',
      );
    }
  }

  return {
    dataUrl: `data:${found.mime};base64,${bytes.toString('base64')}`,
    name: path.basename(filePath),
    kind: found.label,
    bytes: bytes.length,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
  };
}

/**
 * Reads a text file the shop chose — a CSV, or a backup.
 *
 * The size limit is the point: both callers used to hand an arbitrary path
 * straight to readFileSync and then to a parser, so picking a very large file
 * by mistake took the whole window down with it. A limit turns that into a
 * sentence the shop can read.
 */
function readTextFile(filePath, { maxBytes, what }) {
  assertOrdinaryFile(filePath, { maxBytes, what });
  const text = fs.readFileSync(filePath, 'utf8');
  // A UTF-8 byte order mark survives readFileSync and would otherwise become
  // part of the first column heading, so "Name" quietly stops matching.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readCsvFile(filePath) {
  return readTextFile(filePath, { maxBytes: MAX_CSV_BYTES, what: 'file' });
}

function readJsonFile(filePath) {
  const text = readTextFile(filePath, { maxBytes: MAX_JSON_BYTES, what: 'backup' });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not a MyVault backup — it is not readable as JSON.');
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  MAX_CSV_BYTES,
  MAX_JSON_BYTES,
  SIGNATURES,
  sniffImage,
  imageSize,
  assertOrdinaryFile,
  readImageFile,
  readTextFile,
  readCsvFile,
  readJsonFile,
};
