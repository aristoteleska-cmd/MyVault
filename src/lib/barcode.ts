import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';

/**
 * Reading a barcode out of a photograph.
 *
 * A shop with no scanner still has a phone. This turns a picture of a barcode —
 * on the product, on a delivery note, on a shelf label — into the digits, so
 * the item can be registered without anyone typing thirteen numbers correctly.
 *
 * Everything happens on this machine. The decoder is bundled into the app; no
 * image is ever uploaded anywhere, and nothing here touches the network.
 */

/** The symbologies a retail shop actually meets, and nothing more. */
export const SUPPORTED_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

export interface Greyscale {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DecodedBarcode {
  text: string;
  /** "EAN-13", "Code 128" … shown next to the field so the shop can sanity-check it. */
  format: string;
}

/**
 * Weighted for green, the way every luminance conversion does it, because that
 * is where most of the perceived brightness lives. Working in one byte per
 * pixel instead of four also makes the four rotation attempts below cheap.
 */
export function toGreyscale(rgba: Uint8ClampedArray, width: number, height: number): Greyscale {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
    data[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return { data, width, height };
}

/**
 * Quarter turn clockwise.
 *
 * Photographs of shelves are taken at whatever angle is convenient, and a
 * one-dimensional barcode only scans along one axis — a sideways EAN-13 is
 * invisible to the reader until the image is turned.
 */
export function rotate90({ data, width, height }: Greyscale): Greyscale {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[x * height + (height - 1 - y)] = data[y * width + x];
    }
  }
  return { data: out, width: height, height: width };
}

function reader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
  // Slower, and worth it: a photo is not a clean scan from a fixed reader.
  hints.set(DecodeHintType.TRY_HARDER, true);
  const multi = new MultiFormatReader();
  multi.setHints(hints);
  return multi;
}

/** Human-readable name for the symbology, for the "found an EAN-13" message. */
export function formatName(format: BarcodeFormat): string {
  switch (format) {
    case BarcodeFormat.EAN_13: return 'EAN-13';
    case BarcodeFormat.EAN_8: return 'EAN-8';
    case BarcodeFormat.UPC_A: return 'UPC-A';
    case BarcodeFormat.UPC_E: return 'UPC-E';
    case BarcodeFormat.CODE_128: return 'Code 128';
    case BarcodeFormat.CODE_39: return 'Code 39';
    case BarcodeFormat.CODE_93: return 'Code 93';
    case BarcodeFormat.ITF: return 'ITF';
    case BarcodeFormat.CODABAR: return 'Codabar';
    case BarcodeFormat.QR_CODE: return 'QR';
    case BarcodeFormat.DATA_MATRIX: return 'Data Matrix';
    default: return 'Barcode';
  }
}

/** One orientation, one attempt. Returns null rather than throwing on a miss. */
export function decodeGreyscale(image: Greyscale): DecodedBarcode | null {
  if (image.width < 8 || image.height < 8) return null;
  const source = new RGBLuminanceSource(image.data, image.width, image.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  try {
    const result = reader().decode(bitmap);
    const text = result.getText().trim();
    if (!text) return null;
    return { text, format: formatName(result.getBarcodeFormat()) };
  } catch {
    // NotFoundException, ChecksumException, FormatException — all mean the same
    // thing to a shopkeeper: this picture did not have a readable barcode in it.
    return null;
  }
}

/**
 * All four orientations, upright first.
 *
 * `onAttempt` is awaited between tries so the caller can hand a frame back to
 * the browser — otherwise the whole window freezes while a large photo is
 * worked through and the "reading…" message never appears.
 */
export async function decodeGreyscaleAnyOrientation(
  image: Greyscale,
  onAttempt?: () => Promise<void> | void,
): Promise<DecodedBarcode | null> {
  let current = image;
  for (let turn = 0; turn < 4; turn += 1) {
    if (turn > 0) current = rotate90(current);
    const found = decodeGreyscale(current);
    if (found) return found;
    if (onAttempt) await onAttempt();
  }
  return null;
}

/** Convenience wrapper for callers holding raw canvas pixels. */
export async function decodeImageData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  onAttempt?: () => Promise<void> | void,
): Promise<DecodedBarcode | null> {
  return decodeGreyscaleAnyOrientation(toGreyscale(rgba, width, height), onAttempt);
}

/**
 * Barcodes on packaging are printed with a check digit; a misread that still
 * satisfies the checksum is rare, but a stray space or line break from a
 * hand-typed entry is not. Trim to what a scanner would have produced.
 */
export function tidyCode(text: string): string {
  return String(text ?? '').replace(/\s+/g, '').trim();
}
