import type { DecodedBarcode } from './barcode';

/**
 * Turning a picture the shop chose into pixels the decoder can work with.
 *
 * Separate from ./barcode.ts because everything here needs a browser — a
 * canvas, an <img>, an event loop to yield to — while the decoding itself is
 * plain arithmetic that the test suite can run directly.
 */

/**
 * Two passes at increasing detail.
 *
 * A phone photo is typically 3000–4000 pixels wide, which is far more than the
 * decoder needs and slow to work through. Most barcodes fall out of the smaller
 * pass in well under a second; the larger one is the fallback for a code that
 * is small in frame, such as a shelf label photographed from a step back.
 */
const PASSES = [1400, 2400];

/** Lets the browser paint between attempts so the "reading…" message shows. */
const yieldToUi = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file could not be opened as a picture.'));
    image.src = source;
  });
}

function pixelsAt(image: HTMLImageElement, longestEdge: number): ImageData | null {
  const natural = Math.max(image.naturalWidth, image.naturalHeight);
  if (!natural) return null;

  // Never enlarge: inventing pixels only blurs the bars.
  const scale = Math.min(1, longestEdge / natural);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * Reads the first barcode in an image, or null if there is not one to find.
 *
 * The decoder is imported on demand so a shop that never scans a photo does not
 * carry it in the startup bundle.
 */
export async function scanImage(source: string): Promise<DecodedBarcode | null> {
  const image = await loadImage(source);
  const { decodeImageData } = await import('./barcode');

  const natural = Math.max(image.naturalWidth, image.naturalHeight);
  // If the picture is already smaller than the first pass, the second pass
  // would render exactly the same pixels — do the work once.
  const passes = PASSES.filter((_edge, index) => index === 0 || natural > PASSES[index - 1]);

  for (const edge of passes) {
    const pixels = pixelsAt(image, edge);
    if (!pixels) continue;
    const found = await decodeImageData(pixels.data, pixels.width, pixels.height, yieldToUi);
    if (found) return found;
    await yieldToUi();
  }

  return null;
}
