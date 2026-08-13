/**
 * The movement log: what was sold, what came in, and when.
 *
 * Two things are being proved here. The first is ordinary correctness — a
 * movement goes in, comes back out, survives a power cut mid-line, and lands in
 * the right year's file.
 *
 * The second is the reason this file exists at all. A shop's history only grows,
 * and MyVault's inventory file is rewritten in full on every save. If history
 * lived in there, a busy shop's two-hundredth sale of the day would cost two
 * hundred times the first. So the last section below actually writes a large
 * history and measures it, rather than asserting the design is fine because it
 * looks fine.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MovementLog, REASONS } = require('../electron/movements');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-movements-'));
const fresh = (name) => new MovementLog(fs.mkdtempSync(path.join(scratch, `${name}-`)));

// --------------------------------------------------------- writing and reading
{
  const log = fresh('basic');
  assert.deepStrictEqual(log.years(), [], 'a shop that has sold nothing has no history');
  assert.deepStrictEqual(log.list(), [], 'and reading it is not an error');

  const written = log.record({
    itemId: 'i1',
    itemName: 'Blue notebook',
    delta: -2,
    quantityAfter: 8,
    reason: 'sale',
    price: 3.5,
    cost: 1.2,
    by: 'Maria',
  });

  assert.ok(written.id, 'every movement is identifiable');
  assert.strictEqual(written.delta, -2);
  assert.strictEqual(written.after, 8);
  assert.strictEqual(written.price, 3.5);

  const [read] = log.list();
  assert.deepStrictEqual(read, written, 'what comes back is what went in');
  ok('a sale is written and read back whole');
}

// The name is copied into the movement rather than looked up later, so a product
// deleted in the spring is still readable in the spring's takings.
{
  const log = fresh('names');
  log.record({ itemId: 'gone', itemName: 'Discontinued mug', delta: -1, quantityAfter: 0, reason: 'sale' });
  assert.strictEqual(log.list()[0].itemName, 'Discontinued mug');
  ok('a deleted product is still named in last month\'s history');
}

// A movement of nothing is not a movement, and neither is one with no product.
{
  const log = fresh('empty');
  assert.strictEqual(log.record({ itemId: 'i1', delta: 0, quantityAfter: 5, reason: 'sale' }), null);
  assert.strictEqual(log.record({ itemId: '', delta: -1, quantityAfter: 5, reason: 'sale' }), null);
  assert.strictEqual(log.record({ itemId: 'i1', delta: 'abc', quantityAfter: 5 }), null);
  assert.deepStrictEqual(log.list(), [], 'nothing was written');
  ok('a zero adjustment is not recorded');
}

// An unknown reason is not a reason to lose the movement — the quantity change
// is the part that matters, and it is kept.
{
  const log = fresh('reasons');
  const entry = log.record({ itemId: 'i1', delta: 1, quantityAfter: 1, reason: 'stolen-by-cat' });
  assert.strictEqual(entry.reason, 'correction');
  assert.ok(REASONS.includes('sale') && REASONS.includes('delivery'));
  ok('an unrecognised reason becomes a correction rather than being dropped');
}

// ------------------------------------------------------------ one file per year
{
  const log = fresh('years');
  log.record({ itemId: 'i1', delta: -1, quantityAfter: 4, reason: 'sale' }, new Date('2023-06-01T10:00:00Z'));
  log.record({ itemId: 'i1', delta: -1, quantityAfter: 3, reason: 'sale' }, new Date('2024-06-01T10:00:00Z'));
  log.record({ itemId: 'i1', delta: -1, quantityAfter: 2, reason: 'sale' }, new Date('2025-06-01T10:00:00Z'));

  assert.deepStrictEqual(log.years(), [2023, 2024, 2025]);
  assert.ok(fs.existsSync(log.fileFor(2024)), 'each year is its own file');
  assert.strictEqual(log.list().length, 3, 'reading with no range reads them all');

  const middle = log.list({ from: '2024-01-01T00:00:00Z', to: '2024-12-31T23:59:59Z' });
  assert.strictEqual(middle.length, 1, 'a range returns only what falls inside it');
  assert.strictEqual(middle[0].at.slice(0, 4), '2024');
  ok('history is split by year, and only the years asked for are opened');
}

// Opening a year that does not exist is a normal thing for a shop to do — the
// statistics screen offers "last year" whether or not there was one.
{
  const log = fresh('missing-year');
  log.record({ itemId: 'i1', delta: -1, quantityAfter: 0, reason: 'sale' }, new Date('2025-03-01T09:00:00Z'));
  assert.deepStrictEqual(log.list({ from: '2019-01-01', to: '2019-12-31' }), []);
  ok('asking about a year the shop did not trade is empty, not an error');
}

// ------------------------------------------------------------------- ordering
{
  const log = fresh('order');
  for (let day = 1; day <= 5; day += 1) {
    log.record(
      { itemId: `i${day}`, itemName: `Item ${day}`, delta: -1, quantityAfter: 0, reason: 'sale' },
      new Date(`2025-01-0${day}T12:00:00Z`),
    );
  }
  const listed = log.list();
  assert.strictEqual(listed.length, 5);
  assert.strictEqual(listed[0].itemName, 'Item 5', 'the newest is first — that is what a shop wants to see');
  assert.strictEqual(listed[4].itemName, 'Item 1');

  const seen = [];
  log.forEach({}, (entry) => seen.push(entry.itemName));
  assert.deepStrictEqual(seen, ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'], 'walking is oldest first');
  ok('the list reads newest first, the walk reads oldest first');
}

{
  const log = fresh('limit');
  for (let i = 0; i < 50; i += 1) {
    log.record({ itemId: `i${i}`, itemName: `Item ${i}`, delta: -1, quantityAfter: 0, reason: 'sale' },
      new Date(Date.UTC(2025, 0, 1, 0, i)));
  }
  const listed = log.list({ limit: 10 });
  assert.strictEqual(listed.length, 10);
  assert.strictEqual(listed[0].itemName, 'Item 49', 'a limit keeps the newest, not the oldest');
  ok('a limit returns the most recent movements');
}

// ------------------------------------------------------------------- a client
{
  const log = fresh('client');
  log.record({ itemId: 'i1', itemName: 'Coffee', delta: -2, quantityAfter: 8, reason: 'sale', clientId: 'c1' });
  log.record({ itemId: 'i2', itemName: 'Tea', delta: -1, quantityAfter: 4, reason: 'sale', clientId: 'c2' });
  log.record({ itemId: 'i3', itemName: 'Sugar', delta: -3, quantityAfter: 1, reason: 'sale', clientId: 'c1' });
  log.record({ itemId: 'i4', itemName: 'Milk', delta: 12, quantityAfter: 20, reason: 'delivery' });

  const bought = log.forClient('c1');
  assert.strictEqual(bought.length, 2);
  assert.deepStrictEqual(bought.map((e) => e.itemName), ['Sugar', 'Coffee']);
  assert.strictEqual(log.forClient('nobody').length, 0);
  // A sale with no client attached belongs to no client, not to everyone.
  assert.strictEqual(log.forClient('').length, 0, 'an anonymous sale is not filed under a blank client');
  ok('a client\'s purchases can be listed without reading anyone else\'s');
}

// -------------------------------------------------------------- a lost power
//
// The shop's PC is switched off at the wall mid-append. The last line is half
// written. One lost sale is a far better outcome than a statistics screen that
// refuses to open, so the half line is skipped and everything before it stands.
{
  const log = fresh('halfline');
  for (let i = 0; i < 4; i += 1) {
    log.record({ itemId: `i${i}`, itemName: `Item ${i}`, delta: -1, quantityAfter: 0, reason: 'sale' },
      new Date(Date.UTC(2025, 0, 1, 0, i)));
  }
  fs.appendFileSync(log.fileFor(2025), '{"id":"torn","at":"2025-01-01T00:0', 'utf8');

  const seen = log.list();
  assert.strictEqual(seen.length, 4, 'the four complete sales are still there');
  const stats = log.forEach({}, () => {});
  assert.strictEqual(stats.skipped, 1, 'and the torn line is counted, not silently ignored');
  ok('a half-written last line costs one sale, not the whole history');
}

// The same for a line mangled in the middle of the file — a bad sector, an
// editor that saved something odd. Everything around it still reads.
{
  const log = fresh('corrupt');
  log.record({ itemId: 'a', itemName: 'A', delta: -1, quantityAfter: 0, reason: 'sale' }, new Date('2025-01-01T00:00:00Z'));
  fs.appendFileSync(log.fileFor(2025), 'not json at all\n', 'utf8');
  log.record({ itemId: 'b', itemName: 'B', delta: -1, quantityAfter: 0, reason: 'sale' }, new Date('2025-01-02T00:00:00Z'));

  const names = log.list().map((e) => e.itemName);
  assert.deepStrictEqual(names, ['B', 'A'], 'both good lines survive the bad one between them');
  ok('a corrupt line in the middle does not take the rest of the year with it');
}

// A blank line, which is what an interrupted append can also leave behind.
{
  const log = fresh('blank');
  log.record({ itemId: 'a', itemName: 'A', delta: -1, quantityAfter: 0, reason: 'sale' });
  fs.appendFileSync(log.fileFor(new Date().getUTCFullYear()), '\n\n', 'utf8');
  assert.strictEqual(log.list().length, 1);
  ok('blank lines are not mistaken for movements');
}

// ------------------------------------------------------- reading in chunks
//
// The reader takes a megabyte at a time and carries the partial line across the
// boundary. If that carry were wrong, a shop with more than a megabyte of
// history would lose one movement per megabyte — quietly, and only in the years
// big enough to matter. So the boundary is crossed deliberately here.
{
  const log = fresh('chunks');
  const padding = 'x'.repeat(400);
  const count = 4000; // comfortably over the 1 MiB chunk
  for (let i = 0; i < count; i += 1) {
    log.record(
      { itemId: `i${i}`, itemName: `Item ${i} ${padding}`, delta: -1, quantityAfter: 0, reason: 'sale' },
      new Date(Date.UTC(2025, 0, 1, 0, 0, 0, i)),
    );
  }
  const bytes = fs.statSync(log.fileFor(2025)).size;
  assert.ok(bytes > 1024 * 1024, `the file is ${(bytes / 1024 / 1024).toFixed(1)} MB, past the chunk size`);

  let counted = 0;
  const ids = new Set();
  log.forEach({}, (entry) => { counted += 1; ids.add(entry.id); });
  assert.strictEqual(counted, count, 'not one movement is lost at a chunk boundary');
  assert.strictEqual(ids.size, count, 'and none is read twice');
  ok(`${count} movements across ${(bytes / 1024 / 1024).toFixed(1)} MB read back exactly`);
}

// ------------------------------------------------------------ does it scale
//
// This is the claim being tested: appending a movement costs the same whether
// the shop opened yesterday or has ten years behind it. The whole point of
// keeping history out of myvault.json.
{
  const log = fresh('volume');
  const total = 60000;
  const sample = 2000;

  const stamp = (i) => new Date(Date.UTC(2025, 0, 1) + i * 60000);
  const appendRange = (start, end) => {
    const began = process.hrtime.bigint();
    for (let i = start; i < end; i += 1) {
      log.record(
        { itemId: `i${i % 500}`, itemName: `Item ${i % 500}`, delta: -1, quantityAfter: 0, reason: 'sale', price: 2.5 },
        stamp(i),
      );
    }
    return Number(process.hrtime.bigint() - began) / 1e6;
  };

  const firstMs = appendRange(0, sample);
  appendRange(sample, total - sample);
  const lastMs = appendRange(total - sample, total);

  const bytes = fs.statSync(log.fileFor(2025)).size;
  console.log(
    `      ${total.toLocaleString()} movements, ${(bytes / 1024 / 1024).toFixed(1)} MB — `
    + `first ${sample} took ${firstMs.toFixed(0)}ms, last ${sample} took ${lastMs.toFixed(0)}ms`,
  );

  // The test of "append-only" is that the cost does not depend on what is
  // already in the file. Generous headroom, because a CI runner is a noisy
  // machine — but rewriting the file each time would be sixty times worse than
  // this, not four times.
  assert.ok(
    lastMs < Math.max(firstMs * 4, 250),
    `appending stayed flat as the file grew (first ${firstMs.toFixed(0)}ms, last ${lastMs.toFixed(0)}ms)`,
  );

  // And reading a year of a busy shop is something a person waits for, so it
  // has to be quick enough to put on screen.
  const readBegan = process.hrtime.bigint();
  let counted = 0;
  log.forEach({}, () => { counted += 1; });
  const readMs = Number(process.hrtime.bigint() - readBegan) / 1e6;
  console.log(`      reading all ${counted.toLocaleString()} back took ${readMs.toFixed(0)}ms`);
  assert.strictEqual(counted, total);
  assert.ok(readMs < 10000, `a year of history reads in ${readMs.toFixed(0)}ms`);
  ok(`${total.toLocaleString()} movements: appending does not slow down as history grows`);
}

// A year the statistics screen is not asking about is never opened at all, which
// is what keeps "this week" instant in a shop with a decade behind it.
{
  const log = fresh('untouched');
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    for (let i = 0; i < 2000; i += 1) {
      log.record({ itemId: `i${i}`, itemName: `Item ${i}`, delta: -1, quantityAfter: 0, reason: 'sale' },
        new Date(Date.UTC(year, 5, 1, 0, i)));
    }
  }
  const began = process.hrtime.bigint();
  const thisYear = log.forEach({ from: '2025-01-01T00:00:00Z', to: '2025-12-31T23:59:59Z' }, () => {});
  const ms = Number(process.hrtime.bigint() - began) / 1e6;

  assert.strictEqual(thisYear.scanned, 2000, 'only 2025 was read, not the other six years');
  console.log(`      one year out of seven: ${thisYear.scanned} lines scanned in ${ms.toFixed(0)}ms`);
  ok('asking about this year does not read the six years before it');
}

fs.rmSync(scratch, { recursive: true, force: true });

console.log('\n' + passed + ' checks passed.');
