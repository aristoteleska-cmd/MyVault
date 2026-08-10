/**
 * The updater's judgement calls, tested without a network.
 *
 * MyVault is handed to shops as a program that does not use the internet, so
 * the rules that decide *whether* it may reach out — and to where — matter more
 * than the download itself. All of them are plain functions for exactly that
 * reason.
 */
const assert = require('assert');

const { UPDATE_HOSTS, isUpdateHost, isAllowedRequest } = require('../electron/offline');
const {
  FEED,
  updateSupport,
  compareVersions,
  isNewerVersion,
  assertDownloadAllowed,
  describeUpdateError,
} = require('../electron/update-policy');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

// ------------------------------------------------------------- where it looks
assert.strictEqual(FEED.provider, 'github');
assert.strictEqual(FEED.owner, 'aristoteleska-cmd');
// The repository is public, so a shop with no account and no token can read
// this. That is the whole reason the updater works; if it ever moved to a
// private repo, every "Check now" in every shop would answer 404.
assert.strictEqual(FEED.repo, 'MyVault', 'updates come from the public repo');

// electron-builder writes its own copy of this into the packaged app as
// app-update.yml, and that is the copy electron-updater actually reads. If the
// two ever disagree, the app looks in one place while the workflow publishes to
// another and no shop is ever offered an update.
const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
const publish = pkg.build.publish[0];
assert.strictEqual(publish.provider, FEED.provider);
assert.strictEqual(publish.owner, FEED.owner, 'package.json and the app agree on the owner');
assert.strictEqual(publish.repo, FEED.repo, 'package.json and the app agree on the repo');
ok('updates are fetched from the public repo the build publishes to');

// --------------------------------------------------------- the allowed hosts
for (const host of UPDATE_HOSTS) {
  assert.ok(isUpdateHost(`https://${host}/whatever`), `${host} is reachable`);
}
assert.ok(UPDATE_HOSTS.includes('api.github.com'), 'the release list is read from the API');
assert.ok(UPDATE_HOSTS.includes('objects.githubusercontent.com'), 'assets redirect to storage');
ok(`${UPDATE_HOSTS.length} GitHub hosts are reachable, and nothing else`);

// Plain http would let anyone on the same wifi serve a shop an installer.
assert.ok(!isUpdateHost('http://github.com/x'), 'http is refused');
assert.ok(!isUpdateHost('https://github.com.evil.test/x'), 'a lookalike domain is refused');
assert.ok(!isUpdateHost('https://raw.githubusercontent.com/x'), 'other GitHub hosts are refused');
assert.ok(!isUpdateHost('https://example.com/MyVault-setup.exe'), 'anywhere else is refused');
assert.ok(!isUpdateHost('file:///C:/evil.exe'), 'a local path is not an update source');
assert.ok(!isUpdateHost(''), 'an empty address is refused');
assert.ok(!isUpdateHost(null), 'a missing address is refused');
ok('lookalikes, plain http and every other host are refused');

assert.throws(() => assertDownloadAllowed('https://example.com/x.exe'), /Refusing to download/);
assert.strictEqual(assertDownloadAllowed('https://github.com/a/b/releases/x.exe'), true);
ok('a download from anywhere else throws rather than running');

// The window itself stays sealed whatever the update setting says — GitHub is
// reachable from the background, never from the interface.
for (const host of UPDATE_HOSTS) {
  assert.strictEqual(
    isAllowedRequest(`https://${host}/x`),
    false,
    `the interface still cannot reach ${host}`,
  );
}
ok('turning updates on does not open the interface to the network');

// ------------------------------------------------------- who can update itself
assert.deepStrictEqual(
  updateSupport({ platform: 'win32', packaged: true, portable: false }),
  { supported: true, reason: '' },
);
assert.strictEqual(
  updateSupport({ platform: 'win32', packaged: true, portable: true }).reason,
  'portable',
  'the portable exe may be on a USB stick and is not overwritten',
);
assert.strictEqual(
  updateSupport({ platform: 'win32', packaged: false, portable: false }).reason,
  'dev',
);
assert.strictEqual(
  updateSupport({ platform: 'linux', packaged: true, portable: false }).reason,
  'platform',
);
ok('only an installed Windows copy replaces itself');

// ------------------------------------------------------------------ versions
assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1);
assert.strictEqual(compareVersions('1.2.0', '1.10.0'), -1, '10 is after 2, not before');
assert.strictEqual(compareVersions('v2.0.0', '1.9.9'), 1, 'a leading v is ignored');
assert.strictEqual(compareVersions('1.2.0-test', '1.2.0'), 0, 'a suffix does not count');
assert.strictEqual(compareVersions('1.2', '1.2.0'), 0, 'a missing patch is zero');
ok('versions compare by number, not by text');

assert.ok(isNewerVersion('1.0.0', '1.0.1'));
assert.ok(isNewerVersion('1.9.9', '1.10.0'));
assert.ok(!isNewerVersion('1.0.1', '1.0.1'), 'the same version is not an update');
assert.ok(!isNewerVersion('2.0.0', '1.0.0'), 'a shop is never walked backwards');
assert.ok(!isNewerVersion('1.0.0', ''), 'a missing version is not an update');
assert.ok(!isNewerVersion('1.0.0', undefined));
ok('an older or equal release is never offered as an update');

// ------------------------------------------------------------ error wording
assert.match(describeUpdateError(new Error('getaddrinfo ENOTFOUND api.github.com')), /No internet/);
assert.match(describeUpdateError({ code: 'ETIMEDOUT' }), /did not answer in time/);
assert.match(describeUpdateError(new Error('socket hang up')), /dropped part-way/);
assert.match(describeUpdateError(new Error('sha512 mismatch')), /checksum/);
assert.match(describeUpdateError(new Error('HttpError: 404 Not Found')), /No published version/);
assert.match(describeUpdateError(new Error('ENOSPC: no space left')), /free space/);
// Anything unrecognised keeps its own words rather than being swallowed.
assert.strictEqual(describeUpdateError(new Error('something odd')), 'something odd');
ok('failures are explained in words a shopkeeper can act on');

// --------------------------------------------------------- the stored setting
const { DEFAULT_SETTINGS, UPDATE_MODES, normalizeSettings } = require('../electron/store');
assert.strictEqual(DEFAULT_SETTINGS.updates, 'off', 'updates are off until switched on');
assert.deepStrictEqual(UPDATE_MODES, ['off', 'check', 'auto']);
ok('a fresh install makes no network requests at all');

// 1.1.0 wrote this as a boolean. Those files must keep working, and — more
// importantly — an old "false" must not become anything that goes online.
assert.strictEqual(normalizeSettings({ updates: true }).updates, 'check');
assert.strictEqual(normalizeSettings({ updates: false }).updates, 'off');
// Anything unrecognised, including a hand-edited string, means off.
for (const junk of ['yes', 'AUTO', 1, 0, null, {}, 'on']) {
  assert.strictEqual(
    normalizeSettings({ updates: junk }).updates,
    'off',
    `${JSON.stringify(junk)} does not put a shop on the network`,
  );
}
assert.strictEqual(normalizeSettings({ updates: 'auto' }).updates, 'auto');
assert.strictEqual(normalizeSettings({ updates: 'check' }).updates, 'check');
ok('the old on/off setting migrates, and only known values are honoured');

console.log('\n' + passed + ' checks passed.');
