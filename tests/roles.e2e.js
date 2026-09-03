/**
 * Roles, tested by trying to break them.
 *
 * Hiding a button proves nothing: anybody can open the developer tools, and a
 * bug elsewhere in the interface can call anything. So this test does not click
 * — it reaches straight past the interface and calls the bridge itself, as a
 * junior, and requires every answer to be a refusal.
 *
 * If these pass, a junior signed in at the till genuinely cannot add a product,
 * delete one, book in a delivery or read the staff list, whatever the screen
 * happens to be showing.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { HEADLESS_FLAGS, assertWindowAnimates } = require('./headless');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myvault-roles-e2e-'));

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

async function open() {
  const app = await electron.launch({
    args: [root, '--no-sandbox', ...HEADLESS_FLAGS],
    cwd: root,
    env: { ...process.env, MYVAULT_DATA_DIR: dataDir },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('.view, .signin', { timeout: 30_000 });
  await assertWindowAnimates(window, 'the MyVault window');
  return { app, window };
}

/** Calls the bridge exactly as the interface would, and returns the envelope. */
const callBridge = (window, path, args = []) => window.evaluate(
  ([route, callArgs]) => {
    const [group, method] = route.split('.');
    const target = method ? window.myvault[group][method] : window.myvault[group];
    return target(...callArgs);
  },
  [path, args],
);

async function main() {
  let { app, window } = await open();

  // ------------------------------------------------- before anyone sets up
  let auth = await callBridge(window, 'auth.state');
  assert.strictEqual(auth.data.locked, false, 'an untouched shop is not locked');
  assert.strictEqual(auth.data.role, 'admin', 'and behaves as it always did');
  const beforeRoles = await callBridge(window, 'items.add', [{ name: 'Before roles', quantity: 5 }]);
  assert.strictEqual(beforeRoles.ok, true, 'so the shop can still use its own program');
  ok('a shop that updates without setting up staff loses nothing');

  // -------------------------------------------------- setting roles up
  const created = await callBridge(window, 'auth.createFirstAdmin', [{ name: 'Owner', pin: '1111' }]);
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.data.role, 'admin');
  assert.strictEqual(created.data.locked, true, 'MyVault now asks for a PIN');

  // A second attempt must not be a back door once the shop is locked.
  const second = await callBridge(window, 'auth.createFirstAdmin', [{ name: 'Sneak', pin: '9999' }]);
  assert.strictEqual(second.ok, false, 'the first-manager channel closes behind itself');
  assert.match(second.error, /already set up/);
  ok('the first manager is created once, and that door then closes');

  const addedSenior = await callBridge(window, 'staff.add', [{ name: 'Maria', role: 'senior', pin: '2222' }]);
  const addedJunior = await callBridge(window, 'staff.add', [{ name: 'Saturday', role: 'junior', pin: '3333' }]);
  assert.ok(addedSenior.ok && addedJunior.ok, 'the manager can add the rest of the staff');
  ok('a manager creates the staff and their PINs');

  await app.close();

  // ------------------------------------------------- a locked shop, nobody in
  ({ app, window } = await open());

  await window.waitForSelector('.signin', { timeout: 15_000 });
  const body = await window.textContent('body');
  for (const name of ['Owner', 'Maria', 'Saturday']) {
    assert.ok(!body.includes(name), `the sign-in screen does not name ${name}`);
  }

  const peek = await callBridge(window, 'getState');
  assert.strictEqual(peek.ok, false, 'the stock cannot be read before signing in');
  const sneakAdd = await callBridge(window, 'items.add', [{ name: 'Ghost' }]);
  assert.strictEqual(sneakAdd.ok, false, 'nor written to');
  ok('with nobody signed in, the stock is closed and no staff names are shown');

  const wrongPin = await callBridge(window, 'auth.signIn', ['0000']);
  assert.strictEqual(wrongPin.ok, false);
  assert.match(wrongPin.error, /not recognised/);
  // The same message whichever way it is wrong, so guessing teaches nothing.
  const shortPin = await callBridge(window, 'auth.signIn', ['1']);
  assert.strictEqual(shortPin.error, wrongPin.error, 'a bad PIN and a short one read the same');
  ok('a wrong PIN is refused, and says nothing about who works here');

  // ------------------------------------------------------------ as a junior
  const junior = await callBridge(window, 'auth.signIn', ['3333']);
  assert.strictEqual(junior.ok, true);
  assert.strictEqual(junior.data.role, 'junior');
  assert.deepStrictEqual(
    junior.data.capabilities.sort(),
    // Seeing the customer list is the till's job — putting a sale against the
    // right regular is half of what the customer list is for. Everything else,
    // including the takings, is somebody else's.
    ['clients.view', 'items.sell', 'items.view'],
    'a junior holds exactly three capabilities',
  );
  ok('the Saturday assistant signs in and gets three capabilities, not more');

  const stock = await callBridge(window, 'getState');
  assert.strictEqual(stock.ok, true, 'a junior can see the stock, which is the job');
  const item = stock.data.items[0];
  assert.ok(item, 'there is something to sell');

  // The whole point: selling works, everything else is refused by the main
  // process — not by a hidden button.
  const sold = await callBridge(window, 'items.adjust', [item.id, -1]);
  assert.strictEqual(sold.ok, true, 'a junior can ring up a sale');
  assert.strictEqual(sold.data.quantity, item.quantity - 1, 'and the count really goes down');
  ok('a junior can search the stock and take one off when it sells');

  const refusals = {
    'items.add': [{ name: 'Not allowed', quantity: 1 }],
    'items.update': [item.id, { price: 0.01 }],
    'items.remove': [[item.id]],
    'categories.add': [{ name: 'Not allowed' }],
    'categories.remove': [stock.data.categories[0].id],
    'fields.add': [{ name: 'Not allowed', type: 'text' }],
    'staff.list': [],
    'staff.add': [{ name: 'Mate', role: 'admin', pin: '4444' }],
    'data.exportCsv': [],
    'data.importCsv': [],
    // The takings, the profit and the cost of everything on the shelves are
    // not a Saturday assistant's business, and hiding the sidebar entry is only
    // the polite half — the channel itself has to refuse.
    'stats.report': [{}],
    'stats.movements': [{}],
    // They may see who the regulars are; they may not edit the address book.
    'clients.add': [{ name: 'Not allowed' }],
    'clients.update': ['anything', { name: 'Not allowed' }],
    'clients.remove': ['anything'],
    // Entering an invoice books stock in wholesale — not a till job.
    'docs.drafts': [],
    'docs.start': [{}],
    'docs.list': [{}],
    // The shop's tax position is the owner's business, not the floor's.
    'vat.report': [{}],
    'vat.periods': [],
    // What the shop pays and what it makes on each line. A junior sees a shelf
    // price because they have to ring it up; the margin behind it is not theirs.
    'pricing.review': [{}],
    'pricing.advice': [item.id],
    'pricing.styles': [],
    // Counting the shelves rewrites the stock figures wholesale.
    'stocktake.start': [{}],
    'stocktake.progress': [],
    'stocktake.apply': [],
  };
  for (const [route, args] of Object.entries(refusals)) {
    const result = await callBridge(window, route, args);
    assert.strictEqual(result.ok, false, `a junior must not be able to ${route}`);
    assert.match(result.error, /more access|Sign in/, `${route} explains why`);
  }
  ok(`${Object.keys(refusals).length} manager and senior actions are refused to a junior by the main process`);

  // Booking in a delivery is a different job from selling, and the sign of the
  // number is the whole difference.
  const receive = await callBridge(window, 'items.adjust', [item.id, 1]);
  assert.strictEqual(receive.ok, false, 'a junior cannot put stock back up');
  const stillSold = await callBridge(window, 'getState');
  assert.strictEqual(
    stillSold.data.items.find((i) => i.id === item.id).quantity,
    item.quantity - 1,
    'and the refused attempt changed nothing',
  );
  ok('a junior sells but cannot invent stock — the refusal leaves no trace');

  // A refund hands money back over the counter. It arrives on the same channel
  // as a sale, so the gate has to read the reason, not just the sign.
  const refund = await callBridge(window, 'items.adjust', [item.id, 1, { reason: 'return' }]);
  assert.strictEqual(refund.ok, false, 'a junior cannot take a return');
  assert.match(refund.error, /more access/);
  const afterRefund = await callBridge(window, 'getState');
  assert.strictEqual(
    afterRefund.data.items.find((i) => i.id === item.id).quantity,
    item.quantity - 1,
    'and no stock came back',
  );
  ok('a junior cannot refund a customer, even through the channel that sells');

  // Appearance is theirs; the shop's own settings are not.
  const theme = await callBridge(window, 'settings.update', [{ theme: 'dark' }]);
  assert.strictEqual(theme.ok, true, 'a junior can turn the lights down');
  const shopName = await callBridge(window, 'settings.update', [{ shopName: 'Mine now' }]);
  assert.strictEqual(shopName.ok, false, 'but cannot rename the shop');
  ok('a junior can change the theme but not the shop settings');

  // ------------------------------------------------------------ as a senior
  await callBridge(window, 'auth.signOut');
  const senior = await callBridge(window, 'auth.signIn', ['2222']);
  assert.strictEqual(senior.data.role, 'senior');

  const seniorAdds = await callBridge(window, 'items.add', [{ name: 'Senior stock', quantity: 3 }]);
  assert.strictEqual(seniorAdds.ok, true, 'a senior adds products');
  const seniorReceives = await callBridge(window, 'items.adjust', [item.id, 1]);
  assert.strictEqual(seniorReceives.ok, true, 'and books in deliveries');
  ok('a senior adds products and takes deliveries in');

  // The line the shop drew: senior stops at the catalogue.
  const seniorCategory = await callBridge(window, 'categories.add', [{ name: 'Nope' }]);
  assert.strictEqual(seniorCategory.ok, false, 'a senior cannot add a category');
  const seniorField = await callBridge(window, 'fields.add', [{ name: 'Nope', type: 'text' }]);
  assert.strictEqual(seniorField.ok, false, 'nor an extra detail');
  const seniorStaff = await callBridge(window, 'staff.list');
  assert.strictEqual(seniorStaff.ok, false, 'nor see the staff list');
  const seniorDelete = await callBridge(window, 'items.remove', [[item.id]]);
  assert.strictEqual(seniorDelete.ok, false, 'nor delete a product');
  ok('a senior stops exactly where the shop said: categories, details, staff, deleting');

  // ------------------------------------------------------------- as a manager
  await callBridge(window, 'auth.signOut');
  const owner = await callBridge(window, 'auth.signIn', ['1111']);
  assert.strictEqual(owner.data.role, 'admin');

  for (const [route, args] of [
    ['categories.add', [{ name: 'Allowed' }]],
    ['fields.add', [{ name: 'Allowed', type: 'text' }]],
    ['staff.list', []],
    ['settings.update', [{ shopName: 'The shop' }]],
  ]) {
    const result = await callBridge(window, route, args);
    assert.strictEqual(result.ok, true, `a manager can ${route}`);
  }
  ok('a manager can do the things the other two cannot');

  // PIN material must never cross the bridge, whoever is asking.
  const list = await callBridge(window, 'staff.list');
  const asText = JSON.stringify(list.data);
  assert.ok(!asText.includes('hash') && !asText.includes('salt'), 'no PIN material in the staff list');
  const state = await callBridge(window, 'getState');
  assert.ok(
    !JSON.stringify(state.data).match(/"(hash|salt)"/),
    'nor anywhere in the state the window is given',
  );
  ok('not one salt or hash ever reaches the window');

  // Signing out has to actually close the door again.
  await callBridge(window, 'auth.signOut');
  const afterOut = await callBridge(window, 'getState');
  assert.strictEqual(afterOut.ok, false, 'signing out closes the stock again');
  ok('signing out leaves the next person a locked screen');

  await app.close();

  // Closing MyVault must not leave anyone signed in for the next person.
  ({ app, window } = await open());
  const fresh = await callBridge(window, 'auth.state');
  assert.strictEqual(fresh.data.signedIn, false, 'a new sitting starts signed out');
  /*
   * A locked screen is told nothing about who works here — not even how many.
   *
   * This used to assert the head count was 3, which is to say it pinned the
   * leak in place. A PIN signs in whoever it belongs to, so the number of staff
   * is the number that tells a stranger what a guess is worth: three people
   * make any four-digit guess three times likelier to open the till than one
   * person does. The staff list being remembered is still worth checking, so it
   * is checked below, from the other side of the PIN.
   */
  assert.strictEqual(fresh.data.staffCount, 0, 'and is told nothing about the staff');
  const back = await callBridge(window, 'auth.signIn', ['1111']);
  assert.strictEqual(back.ok, true, 'the manager PIN still works after a restart');
  assert.strictEqual(back.data.staffCount, 3, 'and the staff list was remembered');
  await callBridge(window, 'auth.signOut');
  ok('reopening MyVault asks for a PIN again, and says nothing until it is given');

  // ------------------------------------------- forgetting the manager PIN
  // MyVault holds a single-instance lock, so the previous window has to be shut
  // before another can start.
  await app.close();
  ({ app, window } = await open());

  // Creating the first manager mints a code, which the window is handed once.
  // By now it has already been collected, so mint a fresh one as a manager and
  // then forget every PIN there is.
  await callBridge(window, 'auth.signIn', ['1111']);
  await callBridge(window, 'staff.newRecoveryCode');
  const code = await callBridge(window, 'auth.pendingRecoveryCode');
  assert.ok(code.data && code.data.length >= 20, `a code was handed over: ${code.data}`);

  const again = await callBridge(window, 'auth.pendingRecoveryCode');
  assert.strictEqual(again.data, '', 'and only once — it is gone the second time');
  ok('a recovery code reaches the window exactly once');

  await callBridge(window, 'auth.signOut');
  const status = await callBridge(window, 'auth.recoveryStatus');
  assert.strictEqual(status.data.exists, true, 'the sign-in screen can tell a way back exists');
  assert.ok(!JSON.stringify(status.data).includes(code.data.slice(0, 5)),
    'without revealing any of it');
  ok('the locked screen knows a way back exists but not what it is');

  const wrongCode = await callBridge(window, 'auth.recover', [
    { code: 'ABCDE-FGHJK-MNPQR-STUVW', pin: '4242' },
  ]);
  assert.strictEqual(wrongCode.ok, false, 'a made-up code does not get in');
  const stillShut = await callBridge(window, 'getState');
  assert.strictEqual(stillShut.ok, false, 'and the shop stays shut');
  ok('a wrong recovery code changes nothing');

  // The real thing, typed the way somebody reads it off a piece of paper.
  const sloppy = code.data.toLowerCase().replace(/-/g, ' ');
  const recovered = await callBridge(window, 'auth.recover', [{ code: sloppy, pin: '4242' }]);
  assert.strictEqual(recovered.ok, true, 'the real code, typed sloppily, gets in');
  assert.strictEqual(recovered.data.user.role, 'admin');
  assert.strictEqual(recovered.data.auth.role, 'admin', 'and signs them straight in');

  const reopenedStock = await callBridge(window, 'getState');
  assert.strictEqual(reopenedStock.ok, true, 'the stock is theirs again');
  ok('the recovery code unlocks the shop and signs the manager in');

  const spent = await callBridge(window, 'auth.recover', [{ code: code.data, pin: '5252' }]);
  assert.strictEqual(spent.ok, false, 'the used code is spent');
  const replacement = await callBridge(window, 'auth.pendingRecoveryCode');
  assert.ok(replacement.data && replacement.data !== code.data, 'and a new one is waiting');
  ok('a used code stops working, and its replacement is ready to write down');

  await callBridge(window, 'auth.signOut');
  const newPin = await callBridge(window, 'auth.signIn', ['4242']);
  assert.strictEqual(newPin.ok, true, 'the new PIN works from the keypad');
  const oldPin = await callBridge(window, 'auth.signIn', ['1111']);
  assert.strictEqual(oldPin.ok, false, 'and the forgotten one does not');
  ok('the manager signs in with the PIN they chose during recovery');

  // ------------------------------------------- a one-person shop opting out
  await callBridge(window, 'auth.signIn', ['4242']);
  const off = await callBridge(window, 'staff.disable');
  assert.strictEqual(off.ok, true);
  assert.strictEqual(off.data.locked, false, 'MyVault stops asking for a PIN');
  const openAgain = await callBridge(window, 'getState');
  assert.strictEqual(openAgain.ok, true, 'and opens straight into the stock');
  assert.ok(openAgain.data.items.length > 0, 'with the stock still there');
  ok('turning roles off gives a one-person shop its old MyVault back');

  await app.close();
  console.log(`\n${passed} checks passed.`);
}

main().then(
  () => { fs.rmSync(dataDir, { recursive: true, force: true }); },
  (error) => {
    console.error(error);
    console.error(`\nThe data folder was left at ${dataDir} for inspection.`);
    process.exit(1);
  },
);
