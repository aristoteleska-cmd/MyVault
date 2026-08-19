/**
 * The updater driven end to end, without Windows and without a network.
 *
 * The existing updates test covers the decisions — which host, which version,
 * how to word a failure. What it never covered is the thing that actually
 * broke: the sequence. Press check, get an answer; press download, get a file;
 * turn "auto" on, have it happen by itself.
 *
 * electron-updater is stubbed here, because what is being tested is MyVault's
 * side of the conversation: which of its methods get called, in what order, and
 * what the shop is shown while it happens.
 */
const assert = require('assert');
const { EventEmitter } = require('events');

const { Updater } = require('../electron/updater');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

/** Stands in for electron-updater's autoUpdater. */
class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;          // electron-updater's own default
    this.autoInstallOnAppQuit = true;
    this.feed = null;
    this.calls = [];
    /** What checkForUpdates should do. Overridden per scenario. */
    this.onCheck = () => ({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } });
    this.onDownload = () => [];
  }

  setFeedURL(feed) { this.feed = feed; this.calls.push('setFeedURL'); }

  async checkForUpdates() {
    this.calls.push('checkForUpdates');
    return this.onCheck();
  }

  async downloadUpdate() {
    this.calls.push('downloadUpdate');
    return this.onDownload();
  }

  quitAndInstall() { this.calls.push('quitAndInstall'); }
}

/**
 * A ready-to-drive updater: installed on Windows, packaged, with a mode the
 * test can change under its feet the way the settings screen does.
 */
function harness(mode = 'check') {
  const fake = new FakeUpdater();
  const seen = [];
  const state = { mode };
  const updater = new Updater({
    app: { getVersion: () => '1.4.1', isPackaged: true },
    getMode: () => state.mode,
    onStatus: (status) => seen.push(status),
    platform: 'win32',
    loadUpdater: () => fake,
  });
  return { updater, fake, seen, state, last: () => seen[seen.length - 1] };
}

const AVAILABLE = {
  isUpdateAvailable: true,
  updateInfo: { version: '1.5.0', files: [{ url: 'MyVault-1.5.0-setup.exe', size: 96390328 }] },
};

// ------------------------------------------------------- it can update itself
{
  const { updater } = harness();
  assert.strictEqual(updater.getStatus().supported, true);
  assert.strictEqual(updater.getStatus().state, 'idle');

  const portable = new Updater({
    app: { getVersion: () => '1.4.1', isPackaged: true },
    getMode: () => 'check',
    onStatus: () => {},
    platform: 'win32',
    loadUpdater: () => new FakeUpdater(),
  });
  assert.ok(portable.getStatus().supported, 'an installed Windows copy is supported');
  ok('an installed Windows copy reports that it can update itself');
}

// ---------------------------------------------------------------- the check
(async () => {
  const { updater, fake, last } = harness('check');
  fake.onCheck = () => { fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };

  const status = await updater.check();
  assert.strictEqual(status.state, 'available');
  assert.strictEqual(status.newVersion, '1.5.0');
  assert.ok(status.checkedAt, 'and records when it looked');
  assert.strictEqual(last().state, 'available', 'the screen was told');
  // On "check" the shop decides: nothing is fetched until they press download.
  assert.ok(!fake.calls.includes('downloadUpdate'), 'nothing was downloaded behind their back');
  ok('a check that finds a newer version offers it, and waits');

  // ------------------------------------------------- nothing newer out there
  const same = harness('check');
  same.fake.onCheck = () => {
    same.fake.emit('update-not-available', { version: '1.4.1' });
    return { isUpdateAvailable: false, updateInfo: { version: '1.4.1' } };
  };
  const current = await same.updater.check();
  assert.strictEqual(current.state, 'current');
  assert.ok(current.checkedAt);
  ok('a shop already on the newest version is told so');

  // ------------------------------------------------------- THE STUCK SPINNER
  //
  // electron-updater answers null — no event, no error — when it decides the
  // build cannot update itself. MyVault used to await that, see nothing, and
  // leave "Checking…" on screen forever. This is the bug that made the whole
  // feature look broken.
  const silent = harness('check');
  silent.fake.onCheck = () => null;
  const settled = await silent.updater.check();
  assert.notStrictEqual(settled.state, 'checking', 'the spinner does not run forever');
  assert.strictEqual(settled.state, 'error');
  assert.match(settled.error, /cannot check for updates/i, 'and it says something a shop can act on');
  ok('a check that answers nothing at all ends in a message, not an endless spinner');

  // The same guarantee if the library answers but fires no event.
  const mute = harness('check');
  mute.fake.onCheck = () => ({ isUpdateAvailable: false, updateInfo: { version: '1.4.1' } });
  const quiet = await mute.updater.check();
  assert.notStrictEqual(quiet.state, 'checking', 'never left mid-check');
  assert.strictEqual(quiet.state, 'current');
  ok('a silent answer still settles the screen');

  // ------------------------------------------------------------- a failure
  const broken = harness('check');
  broken.fake.onCheck = () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };
  await assert.rejects(() => broken.updater.check(), /No internet/);
  assert.strictEqual(broken.last().state, 'error');
  assert.match(broken.last().error, /No internet/, 'worded for a shopkeeper');
  ok('a check with no internet says "no internet", not an error code');

  // --------------------------------------------------------------- download
  const manual = harness('check');
  manual.fake.onCheck = () => { manual.fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };
  manual.fake.onDownload = () => {
    manual.fake.emit('download-progress', { percent: 42, transferred: 40, total: 96 });
    manual.fake.emit('update-downloaded', { version: '1.5.0' });
    return ['MyVault-1.5.0-setup.exe'];
  };
  await manual.updater.check();
  const done = await manual.updater.download();
  assert.strictEqual(done.state, 'ready');
  assert.strictEqual(done.percent, 100);
  assert.ok(manual.fake.calls.includes('downloadUpdate'));
  assert.ok(manual.seen.some((s) => s.state === 'downloading' && s.percent === 42), 'progress was shown');
  ok('pressing download fetches the installer and reports progress');

  // Downloading before checking is refused rather than silently doing nothing.
  const early = harness('check');
  await assert.rejects(() => early.updater.download(), /Check for updates first/);
  ok('download before check is refused with a reason');

  // ------------------------------------------------------------- auto mode
  //
  // The other half of the complaint: on "auto" the shop should not have to
  // press anything.
  const auto = harness('auto');
  auto.fake.onCheck = () => { auto.fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };
  auto.fake.onDownload = () => {
    auto.fake.emit('update-downloaded', { version: '1.5.0' });
    return ['MyVault-1.5.0-setup.exe'];
  };
  await auto.updater.check();
  // The download is kicked off from the update-available handler; let it run.
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(auto.fake.calls.includes('downloadUpdate'), 'auto mode downloads without being asked');
  assert.strictEqual(auto.updater.getStatus().state, 'ready');
  // …but it does not restart the shop's till in the middle of the afternoon.
  assert.strictEqual(auto.fake.autoInstallOnAppQuit, true, 'it swaps itself in on the next close');
  ok('auto mode fetches the update by itself and waits for closing time');

  // electron-updater must never be the one starting the download: its own
  // autoDownload begins fetching inside checkForUpdates, before anything has
  // looked at where the file points.
  assert.strictEqual(auto.fake.autoDownload, false, 'the library never starts the fetch itself');
  ok('the release is vetted before a byte is fetched, in both modes');

  // ------------------------------------------------ a feed pointing elsewhere
  const evil = harness('auto');
  evil.fake.onCheck = () => {
    evil.fake.emit('update-available', {
      version: '1.5.0',
      files: [{ url: 'https://evil.test/MyVault-setup.exe' }],
    });
    return AVAILABLE;
  };
  await evil.updater.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(evil.updater.getStatus().state, 'error');
  assert.match(evil.updater.getStatus().error, /Refusing to download/);
  assert.ok(!evil.fake.calls.includes('downloadUpdate'), 'and nothing was fetched');
  ok('an installer hosted anywhere but GitHub is refused before it is fetched');

  // The same refusal again at the moment of downloading, which is the second of
  // the two places it is checked. Tested on its own because the first check
  // would otherwise hide it: a guard nothing exercises is how the previous one
  // came to read a property that did not exist and pass silently for months.
  const swapped = harness('check');
  swapped.fake.onCheck = () => { swapped.fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };
  await swapped.updater.check();
  assert.strictEqual(swapped.updater.getStatus().state, 'available');
  swapped.updater.pendingFiles = [{ url: 'https://evil.test/MyVault-setup.exe' }];
  await assert.rejects(() => swapped.updater.download(), /Refusing to download/);
  assert.ok(!swapped.fake.calls.includes('downloadUpdate'), 'the fetch never started');
  ok('the download refuses a non-GitHub installer even if the check let it through');

  // A release naming plain filenames is the normal case and must still work —
  // those are resolved against the GitHub release itself.
  const plain = harness('check');
  plain.fake.onCheck = () => { plain.fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };
  const fine = await plain.updater.check();
  assert.strictEqual(fine.state, 'available', 'an ordinary release is not mistaken for a hijacked one');
  ok('an ordinary release, whose files are bare filenames, still passes');

  // -------------------------------------------------------------- switched off
  const off = harness('off');
  await assert.rejects(() => off.updater.check(), /switched off/);
  assert.ok(!off.fake.calls.includes('checkForUpdates'), 'not one request while updates are off');
  ok('with updates off, no request is made at all');

  // ---------------------------------------------------------------- install
  const ready = harness('check');
  ready.fake.onCheck = () => { ready.fake.emit('update-available', AVAILABLE.updateInfo); return AVAILABLE; };
  ready.fake.onDownload = () => { ready.fake.emit('update-downloaded', { version: '1.5.0' }); return []; };
  await ready.updater.check();
  await ready.updater.download();
  assert.strictEqual(ready.updater.install(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ready.fake.calls.includes('quitAndInstall'));
  ok('install hands over to the installer once the download has finished');

  const notYet = harness('check');
  assert.throws(() => notYet.updater.install(), /has not finished downloading/);
  ok('install before the download has finished is refused');

  console.log('\n' + passed + ' checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
