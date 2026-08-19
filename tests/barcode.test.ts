/**
 * Reading barcodes out of pictures.
 *
 * The decoder is only worth shipping if it actually decodes, so these tests
 * draw real barcodes and read them back rather than asserting that functions
 * exist. The EAN-13 bitmaps are generated here from the published encoding
 * tables — deliberately not with the decoder's own library, so a bug in one
 * cannot hide a bug in the other.
 */
import assert from 'assert';
import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import {
  decodeGreyscale,
  decodeGreyscaleAnyOrientation,
  formatName,
  rotate90,
  tidyCode,
  toGreyscale,
  type Greyscale,
} from '../src/lib/barcode';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log('  ok  ' + label); };

// ------------------------------------------------------------ EAN-13 drawing
const L = ['0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100'];
// Which of the first six digits use the G table, chosen by the leading digit.
const PARITY = ['000000', '001011', '001101', '001110', '010011',
  '011001', '011100', '010101', '010110', '011010'];

/** The 95 modules of an EAN-13 symbol, as a string of 0 (white) and 1 (black). */
function ean13Modules(digits: string): string {
  assert.strictEqual(digits.length, 13, 'EAN-13 has thirteen digits');
  const d = [...digits].map(Number);
  const parity = PARITY[d[0]];

  let bits = '101';
  for (let i = 1; i <= 6; i += 1) bits += parity[i - 1] === '0' ? L[d[i]] : G[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
  return bits + '101';
}

/**
 * Renders modules as a greyscale image. The quiet zone matters: without white
 * space either side a reader cannot find the start guard, which is the most
 * common reason a real photograph fails.
 */
function render(modules: string, { scale = 3, height = 60, quiet = 12 } = {}): Greyscale {
  const width = (modules.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * height).fill(255);

  for (let m = 0; m < modules.length; m += 1) {
    if (modules[m] !== '1') continue;
    const x0 = (m + quiet) * scale;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x < x0 + scale; x += 1) data[y * width + x] = 0;
    }
  }
  return { data, width, height };
}

// The runner bundles these suites as CommonJS, which has no top-level await,
// so the checks live in a function rather than running as the file loads.
async function run() {
  // 5901234123457 is a well-formed EAN-13: its check digit really is 7.
  const EAN = '5901234123457';

  const barcode = render(ean13Modules(EAN));
  const found = decodeGreyscale(barcode);
  assert.ok(found, 'a clean EAN-13 is readable');
  assert.strictEqual(found?.text, EAN);
  assert.strictEqual(found?.format, 'EAN-13');
  ok('a rendered EAN-13 decodes back to its digits');

  // A shop photographing a shelf holds the phone however is convenient.
  for (const turns of [1, 2, 3]) {
    let image = barcode;
    for (let i = 0; i < turns; i += 1) image = rotate90(image);
    const rotated = await decodeGreyscaleAnyOrientation(image);
    assert.strictEqual(rotated?.text, EAN, `readable after ${turns * 90}°`);
  }
  ok('a sideways or upside-down photo still decodes');

  // Small on the page, as when the whole product is in frame.
  const small = render(ean13Modules(EAN), { scale: 2, height: 28 });
  assert.strictEqual(decodeGreyscale(small)?.text, EAN);
  ok('a small, short barcode still decodes');

  // Several codes, to be sure it is not one lucky bitmap.
  for (const digits of ['4006381333931', '9780201379624', '5000112637922']) {
    const result = decodeGreyscale(render(ean13Modules(digits)));
    assert.strictEqual(result?.text, digits, `${digits} decodes`);
  }
  ok('three more real-world EAN-13 codes decode');

  // An EAN-13 beginning with 0 *is* a UPC-A — the same bars, printed on most
  // American packaging — and it comes back in the twelve-digit form without the
  // leading zero. That is correct, and it is also what a USB scanner reports,
  // so the two ways of registering an item agree with each other. Worth pinning
  // because it looks like a dropped character until you know.
  const upc = decodeGreyscale(render(ean13Modules('0012345678905')));
  assert.strictEqual(upc?.text, '012345678905');
  assert.strictEqual(upc?.format, 'UPC-A');
  ok('a leading-zero EAN-13 reads back as the UPC-A it really is');

  // ------------------------------------------------------------------ 2D codes
  // The writer dereferences its hints map, so an empty one is required.
  const qr = new MultiFormatWriter()
    .encode('MYVAULT-TEST-42', BarcodeFormat.QR_CODE, 120, 120, new Map());
  const qrImage: Greyscale = {
    data: new Uint8ClampedArray(qr.getWidth() * qr.getHeight()),
    width: qr.getWidth(),
    height: qr.getHeight(),
  };
  for (let y = 0; y < qr.getHeight(); y += 1) {
    for (let x = 0; x < qr.getWidth(); x += 1) {
      qrImage.data[y * qrImage.width + x] = qr.get(x, y) ? 0 : 255;
    }
  }
  const qrResult = decodeGreyscale(qrImage);
  assert.strictEqual(qrResult?.text, 'MYVAULT-TEST-42');
  assert.strictEqual(qrResult?.format, 'QR');
  ok('a QR code decodes too, for shops that use them');

  // ------------------------------------------------------- when there is no code
  assert.strictEqual(decodeGreyscale(render('0'.repeat(95))), null, 'a blank image finds nothing');
  assert.strictEqual(
    await decodeGreyscaleAnyOrientation({
      data: new Uint8ClampedArray(200 * 200).fill(128),
      width: 200,
      height: 200,
    }),
    null,
    'flat grey finds nothing',
  );
  assert.strictEqual(
    decodeGreyscale({ data: new Uint8ClampedArray(4), width: 2, height: 2 }),
    null,
    'a tiny image is rejected rather than crashing',
  );
  ok('a picture with no barcode returns nothing rather than a wrong guess');

  // A miss must not be silent-but-slow: every orientation is tried exactly once.
  let attempts = 0;
  await decodeGreyscaleAnyOrientation(
    { data: new Uint8ClampedArray(64 * 64).fill(255), width: 64, height: 64 },
    () => { attempts += 1; },
  );
  assert.strictEqual(attempts, 4, 'four orientations, and the UI gets a breath between each');
  ok('all four orientations are tried, yielding between them');

  // ------------------------------------------------------------------- plumbing
  const grey = toGreyscale(new Uint8ClampedArray([
    255, 255, 255, 255, 0, 0, 0, 255,
  ]), 2, 1);
  assert.strictEqual(grey.width, 2);
  assert.strictEqual(grey.data[0], 255, 'white stays white');
  assert.strictEqual(grey.data[1], 0, 'black stays black');
  // Green carries most of the perceived brightness, so a pure green pixel is
  // lighter than a pure blue one of the same intensity.
  const channels = toGreyscale(new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
  ]), 3, 1);
  assert.ok(channels.data[1] > channels.data[0] && channels.data[0] > channels.data[2],
    'green is weighted above red, and red above blue');
  ok('colour becomes brightness the way the eye sees it');

  // A quarter turn clockwise: the top-left pixel ends up at the top-right.
  const turned = rotate90({ data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]), width: 3, height: 2 });
  assert.strictEqual(turned.width, 2);
  assert.strictEqual(turned.height, 3);
  assert.deepStrictEqual([...turned.data], [4, 1, 5, 2, 6, 3]);
  // Four turns must land exactly back where it started, or the search above
  // would be quietly testing the same orientation twice.
  let round: Greyscale = { data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]), width: 3, height: 2 };
  for (let i = 0; i < 4; i += 1) round = rotate90(round);
  assert.deepStrictEqual([...round.data], [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(round.width, 3);
  ok('rotation is exact, and four turns come full circle');

  assert.strictEqual(tidyCode('  590 1234\n123457 '), '5901234123457');
  assert.strictEqual(tidyCode(undefined as unknown as string), '');
  ok('stray spaces and line breaks are stripped from a code');

  assert.strictEqual(formatName(BarcodeFormat.EAN_13), 'EAN-13');
  assert.strictEqual(formatName(BarcodeFormat.CODE_128), 'Code 128');
  assert.strictEqual(formatName(BarcodeFormat.MAXICODE), 'Barcode', 'an unexpected format still reads sensibly');
  ok('formats are named the way a shopkeeper would recognise them');

  console.log('\n' + passed + ' checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
