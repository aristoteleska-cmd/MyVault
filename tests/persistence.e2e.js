/**
 * Does MyVault actually remember the shop's stock?
 *
 * Every other suite tests a piece in isolation. This one answers the question a
 * shopkeeper would ask: if I add my products today and open the program
 * tomorrow, is my work still there — or does it start again from an empty list?
 *
 * So nothing here is mocked. It starts the real Electron application, clicks
 * the real buttons, closes the window, starts it again, and looks. Between runs
 * it also checks the file on disk directly: same file, not a new one, with the
 * items really written into it.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { _electron: electron } = require('playwright');
const { HEADLESS_FLAGS, assertWindowAnimates } = require('./headless');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-e2e-'));
const dataFile = path.join(dataDir, 'myvault.json');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

/**
 * Starts the app exactly as an installed copy starts, apart from being pointed
 * at a scratch folder.
 */
async function open() {
  const app = await electron.launch({
    args: [root, '--no-sandbox', ...HEADLESS_FLAGS],
    cwd: root,
    env: { ...process.env, MYVAULT_DATA_DIR: dataDir },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('.view', { timeout: 30_000 });
  await assertWindowAnimates(window, 'the MyVault window');
  return { app, window };
}

const readFileOnDisk = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));

/**
 * A server the probes below can actually reach.
 *
 * Pointing them at somewhere on the internet would prove nothing here: a build
 * machine with no route out would report every request "blocked" whether or not
 * MyVault had blocked it, and the check would be green for the wrong reason.
 * A server on this very machine is definitely reachable, so anything that fails
 * to reach it was stopped by the app.
 */
function startProbeServer() {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const server = http.createServer((request, response) => {
    if (request.url.endsWith('.png')) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG);
    } else if (request.url.endsWith('.js')) {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end('window.__probeReached = true;');
    } else {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('reachable');
    }
  });

  // Enough of a handshake for the browser to call the socket open.
  server.on('upgrade', (request, socket) => {
    const accept = crypto
      .createHash('sha1')
      .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Adds one product through the actual form, the way a shop would. */
async function addItem(window, { name, price, quantity, barcode }) {
  // The toolbar button and the dialog's own submit button both read "Add item",
  // so both are addressed by what they are rather than what they say.
  await window.click('button.btn-lg:has-text("Add item")');
  await window.waitForSelector('#field-name');
  await window.fill('#field-name', name);
  await window.fill('#field-barcode', barcode);
  await window.fill('#field-quantity', String(quantity));
  await window.fill('#field-price', String(price));
  await window.click('button[type="submit"][form="item-form"]');
  await window.waitForSelector('#field-name', { state: 'detached', timeout: 10_000 });
}

const PRODUCTS = [
  { name: 'Cotton T-shirt', price: '12.5', quantity: 40, barcode: '5901234123457' },
  { name: 'Wooden train', price: '24', quantity: 7, barcode: '4006381333931' },
  { name: 'Olive oil 1L', price: '9.9', quantity: 120, barcode: '5000112637922' },
];

async function main() {
  // ------------------------------------------------- first run: an empty shop
  let { app, window } = await open();

  assert.ok(fs.existsSync(dataFile), 'a data file is created on the very first run');
  const firstRun = readFileOnDisk();
  assert.strictEqual(firstRun.items.length, 0, 'a new shop starts empty');
  const originalCreatedAt = firstRun.createdAt;
  assert.ok(originalCreatedAt, 'the file records when it was created');
  ok('first run creates one data file, and the shop starts empty');

  for (const product of PRODUCTS) await addItem(window, product);

  // Also change a setting, because a shop losing its currency or its shop name
  // on restart is the same bug wearing a different hat.
  await window.click('.nav-item:has-text("Settings")');
  await window.waitForSelector('input[aria-label="Shop name"]');
  await window.fill('input[aria-label="Shop name"]', 'Kiosk Aristotelis');
  // Settings save as they are typed; give the write a moment to land.
  await window.waitForTimeout(500);

  const afterTyping = readFileOnDisk();
  assert.strictEqual(afterTyping.items.length, 3, 'all three products are on disk before closing');
  assert.strictEqual(
    afterTyping.settings.shopName,
    'Kiosk Aristotelis',
    'the setting is on disk before closing',
  );
  ok('work is written to disk as it happens, not only when the app closes');

  // The ids are what prove the records are the same records later on, rather
  // than three new ones that happen to be spelled the same way.
  const originalIds = afterTyping.items.map((item) => item.id).sort();

  await app.close();

  // ------------------------------------------- second run: is the work there?
  ({ app, window } = await open());

  const secondRun = readFileOnDisk();
  assert.strictEqual(
    secondRun.createdAt,
    originalCreatedAt,
    'reopening reuses the same file rather than starting a new one',
  );
  assert.deepStrictEqual(
    secondRun.items.map((item) => item.id).sort(),
    originalIds,
    'the same three records came back, not three lookalikes',
  );
  assert.ok(!secondRun.recoveredFrom, 'the file was read normally, not rescued as unreadable');
  // Saving writes a temp file and renames it over the original, so that a crash
  // mid-write can never leave a half-written stock list. That means the file's
  // inode legitimately changes on every save — "same file" has to be judged by
  // what is in it, not by which inode it occupies. What must not happen is a
  // leftover temp file, or a fresh createdAt.
  const strays = fs.readdirSync(dataDir).filter((file) => file.includes('.tmp'));
  assert.deepStrictEqual(strays, [], `no half-written files are left behind: ${strays}`);
  ok('the second run opens the same file, not a fresh one');

  assert.strictEqual(secondRun.items.length, 3, 'all three products are still stored');
  for (const product of PRODUCTS) {
    const stored = secondRun.items.find((item) => item.name === product.name);
    assert.ok(stored, `${product.name} survived the restart`);
    assert.strictEqual(stored.quantity, product.quantity, `${product.name} kept its quantity`);
    assert.strictEqual(stored.barcode, product.barcode, `${product.name} kept its barcode`);
    assert.strictEqual(stored.price, Number(product.price), `${product.name} kept its price`);
  }
  assert.strictEqual(secondRun.settings.shopName, 'Kiosk Aristotelis', 'the setting survived too');
  ok('every product, quantity, price and barcode is remembered');

  // On disk is one thing; the shop needs to *see* them.
  for (const product of PRODUCTS) {
    await window.waitForSelector(`text=${product.name}`, { timeout: 10_000 });
  }
  const rows = await window.locator('table.items tbody tr').count();
  assert.strictEqual(rows, 3, 'the stock list shows the three products, not an empty shop');
  ok('the stock list opens showing yesterday\'s work');

  // -------------------------------------- changing something and closing again
  // A sale: one T-shirt out, through the row's own minus button.
  await window.click('table.items tbody tr:has-text("Cotton T-shirt") button[title*="Sold"]');
  await window.waitForTimeout(400);
  await app.close();

  ({ app, window } = await open());
  const thirdRun = readFileOnDisk();
  assert.strictEqual(
    thirdRun.items.find((i) => i.name === 'Cotton T-shirt').quantity,
    39,
    'the sale made just before closing was kept',
  );
  assert.strictEqual(thirdRun.createdAt, originalCreatedAt, 'still the same file');
  assert.strictEqual(thirdRun.items.length, 3, 'and nothing else was lost');
  ok('a change made seconds before closing is still there afterwards');

  await app.close();

  // ---------------------------------------------- and after an update is installed
  // What MyVault actually notices about an update is that the file in front of
  // it was last written by a different version of itself. Stamping an older
  // version into the file reproduces that exactly, and does not depend on being
  // able to change the version this test run reports.
  const beforeUpdate = readFileOnDisk();
  assert.strictEqual(
    typeof beforeUpdate.appVersion,
    'string',
    'the file records which version wrote it',
  );
  fs.writeFileSync(
    dataFile,
    JSON.stringify({ ...beforeUpdate, appVersion: '0.9.0' }, null, 2),
    'utf8',
  );

  ({ app, window } = await open());

  const afterUpdate = readFileOnDisk();
  assert.strictEqual(afterUpdate.items.length, 3, 'an update keeps every product');
  assert.strictEqual(afterUpdate.createdAt, originalCreatedAt, 'an update reuses the same file');
  assert.strictEqual(
    afterUpdate.settings.shopName,
    'Kiosk Aristotelis',
    'an update keeps the settings',
  );
  assert.strictEqual(
    afterUpdate.items.find((i) => i.name === 'Cotton T-shirt').quantity,
    39,
    'an update keeps the quantities exactly',
  );

  // And it should have parked a copy of the old file first, in case it had not.
  const snapshots = fs.readdirSync(path.join(dataDir, 'backups'))
    .filter((file) => file.startsWith('myvault-before-0.9.0'));
  assert.strictEqual(
    snapshots.length,
    1,
    `an untouched copy of the pre-update file is kept (found ${JSON.stringify(snapshots)})`,
  );
  // That copy has to be the real thing, not an empty placeholder.
  const parked = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', snapshots[0]), 'utf8'));
  assert.strictEqual(parked.items.length, 3, 'the parked copy holds the stock as it was');
  assert.strictEqual(parked.appVersion, '0.9.0', 'and is stamped with the version that wrote it');

  assert.strictEqual(
    afterUpdate.appVersion,
    require(path.join(root, 'package.json')).version,
    'the file is now stamped with the version that opened it',
  );
  ok('installing a new version keeps the stock, and copies the old file aside first');

  await window.waitForSelector('text=Olive oil 1L', { timeout: 10_000 });
  ok('the shop still sees its stock after the update');

  // ---------------------------------------- the PDF reader is where the job starts
  //
  // It was buried: the button existed only inside an open delivery, so somebody
  // holding a supplier's invoice had to know to create a blank document first
  // and then look inside it. A feature nobody can find is a feature nobody has.
  await window.click('.nav-item:has-text("Invoices")');
  await window.waitForSelector('button:has-text("Read a PDF invoice")', { timeout: 10_000 });
  const beforeAnyDraft = await window.isVisible('button:has-text("Read a PDF invoice")');
  assert.strictEqual(beforeAnyDraft, true, 'the button is on the Invoices screen itself');
  ok('reading a PDF invoice is offered before any document has been started');

  await app.close();

  // ------------------------------------- and it is still an offline program
  // The README promises that the interface cannot reach the network by any
  // route. With a real window already open, that is worth proving rather than
  // asserting about a helper function.
  //
  // These five checks were confirmed to be capable of failing: with both the
  // Content-Security-Policy and the request handler removed, fetch reports
  // "reached". With only the request handler removed it still reports
  // "blocked" — the two layers are independent, and either one alone is enough.
  const { server, port } = await startProbeServer();

  // Prove the server really is reachable from this machine before asking the
  // app to fail to reach it — otherwise the five checks below mean nothing.
  const direct = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/probe`, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', () => resolve(0));
  });
  assert.strictEqual(direct, 200, 'the probe server answers, so a block must come from the app');

  ({ app, window } = await open());

  const routes = await window.evaluate(async (probePort) => {
    const target = `http://127.0.0.1:${probePort}/probe`;
    const results = {};

    results.fetch = await fetch(target).then(() => 'reached', () => 'blocked');

    results.xhr = await new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.onload = () => resolve('reached');
      request.onerror = () => resolve('blocked');
      request.open('GET', target);
      try { request.send(); } catch { resolve('blocked'); }
    });

    results.websocket = await new Promise((resolve) => {
      try {
          const socket = new WebSocket(`ws://127.0.0.1:${probePort}/probe`);
        socket.onopen = () => resolve('reached');
        socket.onerror = () => resolve('blocked');
      } catch { resolve('blocked'); }
    });

    results.image = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve('reached');
      image.onerror = () => resolve('blocked');
      image.src = target + '.png';
    });

    results.script = await new Promise((resolve) => {
      const tag = document.createElement('script');
      tag.onload = () => resolve('reached');
      tag.onerror = () => resolve('blocked');
      tag.src = target + '.js';
      document.head.appendChild(tag);
    });

    return results;
  }, port);

  server.close();

  for (const [route, outcome] of Object.entries(routes)) {
    assert.strictEqual(outcome, 'blocked', `the interface cannot reach the network by ${route}`);
  }
  assert.strictEqual(Object.keys(routes).length, 5, 'five different routes were tried');
  ok(`the window still cannot reach the network: ${Object.keys(routes).join(', ')} all blocked`);

  await app.close();

  // ----------------------------------------------------------- one file, always
  const files = fs.readdirSync(dataDir).filter((file) => file.endsWith('.json'));
  assert.deepStrictEqual(files, ['myvault.json'], `exactly one data file, found: ${files}`);
  ok('five launches later there is still exactly one data file');

  console.log(`\n${passed} checks passed.`);
  console.log(`Data folder: ${dataDir}`);
}

main().then(
  () => { fs.rmSync(dataDir, { recursive: true, force: true }); },
  (error) => {
    console.error(error);
    console.error(`\nThe data folder was left at ${dataDir} for inspection.`);
    process.exit(1);
  },
);
