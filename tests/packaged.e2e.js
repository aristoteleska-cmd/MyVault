/**
 * Does the file we are about to hand somebody actually run?
 *
 * Every other test in this repository runs against the source tree. This one
 * runs against the built Linux AppImage — the exact bytes that get attached to a
 * release — launched the way a person double-clicking it would, and driven
 * through the real window and the real bridge.
 *
 * It exists because "the build succeeded" and "the program works" are different
 * claims, and only one of them is worth making to a shop. A packaging mistake —
 * a file left out of the bundle, a path that only resolves in development, a
 * native module that did not come along — produces a perfectly good-looking
 * artifact that does nothing when opened.
 *
 * Run it after `npm run dist:linux`:  npm run test:packaged
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright-core');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');

/**
 * The build to test, which is the newest one there.
 *
 * `release/` accumulates: a machine that has cut two releases has two AppImages
 * in it, and this used to take whichever sorted first — the oldest. That is a
 * test that passes loudly while proving nothing about the build in front of it,
 * which is worse than no test. Newest by the time it was written, and the name
 * is printed so what was checked is never in doubt.
 */
function findAppImage() {
  const found = (fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [])
    .filter((name) => name.endsWith('.AppImage'))
    .map((name) => ({ name, at: fs.statSync(path.join(releaseDir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  if (found.length === 0) {
    console.error('No .AppImage in release/. Run "npm run dist:linux" first.');
    process.exit(1);
  }
  return path.join(releaseDir, found[0].name);
}

/**
 * Unpacks the AppImage rather than executing it directly.
 *
 * An AppImage mounts itself with FUSE, which a container usually does not have.
 * Extracting uses the same bytes and the same bundled Electron, and is what
 * `--appimage-extract-and-run` does anyway on machines without FUSE.
 */
function extract(appImage) {
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-packaged-'));
  execFileSync(appImage, ['--appimage-extract'], { cwd: where, stdio: 'ignore' });
  const binary = path.join(where, 'squashfs-root', 'myvault');
  assert.ok(fs.existsSync(binary), 'the unpacked AppImage has no myvault binary in it');
  return { where, binary };
}

(async () => {
  const appImage = findAppImage();
  const size = fs.statSync(appImage).size;
  console.log(`  Testing ${path.basename(appImage)} (${(size / 1024 / 1024).toFixed(0)} MB)`);

  const { where, binary } = extract(appImage);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-packaged-data-'));
  let passed = 0;
  const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

  // --no-sandbox because a container has no user namespaces to sandbox into.
  // On a real desktop the sandbox is on; this is a limitation of the test rig,
  // not of the build.
  const launch = () => electron.launch({
    executablePath: binary,
    args: ['--no-sandbox'],
    env: { ...process.env, MYVAULT_DATA_DIR: dataDir },
  });

  let app = await launch();
  let window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  assert.strictEqual(await window.title(), 'MyVault');
  ok('the packaged app starts and opens its window');

  await window.waitForSelector('.app, #root', { timeout: 30000 });
  const rendered = await window.textContent('body');
  assert.ok(rendered.trim().length > 20, 'the window is not blank');
  ok('the interface is bundled and renders');

  // Greek text through the real bridge: the encoding of the packaged files is
  // exactly the kind of thing that survives development and breaks in a bundle.
  const added = await window.evaluate(async () => {
    const result = await window.myvault.items.add({
      name: 'Ούζο 700ml', quantity: 7, price: 12.40, cost: 6.00,
    });
    return result.ok ? result.data : { error: result.error };
  });
  assert.strictEqual(added.name, 'Ούζο 700ml');
  assert.strictEqual(added.quantity, 7);
  ok('a product with Greek text saves through the real bridge');

  const service = await window.evaluate(async () => {
    const result = await window.myvault.items.add({
      name: 'Τοποθέτηση', service: true, quantity: 40, price: 62.00,
    });
    return result.ok ? result.data : { error: result.error };
  });
  assert.strictEqual(service.service, true);
  assert.strictEqual(service.quantity, 0, 'a service carries no count, in the bundle too');
  ok('a service line behaves the same in the packaged build');

  // ------------------------------------------------------------ containment
  //
  // The policy is only worth having if it actually stops something, and the only
  // way to know is to try. This injects into the real running window the two
  // things an XSS would rely on and checks that neither one runs.
  //
  // Nothing in MyVault builds HTML from strings — React escapes everything and
  // there is no dangerouslySetInnerHTML in the codebase — so this is testing the
  // second lock, the one that matters on the day the first one is broken by a
  // dependency or a careless line.
  const blocked = await window.evaluate(() => new Promise((resolve) => {
    const results = { inlineScript: 'ran', imgOnerror: 'ran', policy: '' };
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    results.policy = meta ? meta.getAttribute('content') : '';

    window.__xssCanary = 'untouched';

    // An inline <script> is what an injected payload usually is.
    const script = document.createElement('script');
    script.textContent = 'window.__xssCanary = "executed by inline script";';
    document.body.appendChild(script);

    // And an event handler on a broken image is what it is when tags are
    // filtered but attributes are not.
    const img = document.createElement('img');
    img.setAttribute('src', 'x-does-not-exist');
    img.setAttribute('onerror', 'window.__xssCanary = "executed by onerror";');
    document.body.appendChild(img);

    window.setTimeout(() => {
      results.inlineScript = window.__xssCanary;
      results.imgOnerror = window.__xssCanary;
      script.remove();
      img.remove();
      resolve(results);
    }, 300);
  }));

  assert.strictEqual(
    blocked.inlineScript, 'untouched',
    `an inline script ran inside the packaged app: ${blocked.inlineScript}`,
  );
  assert.ok(blocked.policy.includes("default-src 'none'"), 'the page carries the policy');
  assert.ok(blocked.policy.includes("script-src 'self'"), 'and only allows its own bundle');
  ok('injected script does not run in the packaged window — the policy holds');

  // ------------------------------------------------------------ the PDF reader
  //
  // pdfjs is a dependency loaded on demand from inside the packed archive, which
  // is exactly the arrangement that works in development and fails in a bundle.
  // Nothing else in this file would notice: reading a PDF is the one feature
  // whose parser is neither bundled by Vite nor loaded at startup.
  // The dialog cannot be driven from here, so this proves the half that
  // packaging breaks: that the parser loads at all inside the asar and reads a
  // real file. The channel above it is covered by tests/invoice-pdf.test.js.
  const parsed = await app.evaluate(async (_electron, fixturePath) => {
    // The bundled main module's own require, so the modules resolve inside the
    // asar exactly as they do when a shop presses the button.
    const load = process.mainModule.require.bind(process.mainModule);
    const { readPdfFile } = load('./files.js');
    const { extractPdfText } = load('./pdf-text.js');
    const { readInvoice } = load('./invoice-read.js');
    const read = readInvoice(await extractPdfText(readPdfFile(fixturePath)));
    return { supplier: read.supplier, lines: read.lines.length, net: read.totals.net };
  }, path.join(root, 'tests', 'fixtures', 'supplier-greek.pdf'));

  assert.strictEqual(parsed.supplier, 'ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ Α.Ε.');
  assert.strictEqual(parsed.lines, 4);
  assert.strictEqual(parsed.net, 161.19);
  ok('the PDF reader loads inside the packed bundle and reads a real invoice');

  await app.close();

  // The whole point of the program.
  app = await launch();
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const back = await window.evaluate(async () => {
    const result = await window.myvault.getState();
    return result.ok ? result.data.items.map((i) => [i.name, i.quantity, i.service]) : null;
  });
  assert.deepStrictEqual(back, [['Ούζο 700ml', 7, false], ['Τοποθέτηση', 0, true]]);
  ok('closing it and opening it again gives the stock back');

  await app.close();

  const file = path.join(dataDir, 'myvault.json');
  assert.ok(fs.existsSync(file), 'the data is a plain file on this machine');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(saved.items.length, 2);
  ok('and the data file is readable JSON, not a database nobody can open');

  fs.rmSync(where, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${passed} checks passed against the packaged Linux build.`);
})().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(1);
});
