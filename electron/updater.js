'use strict';

/**
 * Fetching new versions of MyVault from GitHub.
 *
 * Three rules shape this file:
 *
 *   • Nothing happens unless the shop switched it on. MyVault is sold as a
 *     program that does not use the internet, and that stays true by default —
 *     with updates off, not one request is made, ever.
 *
 *   • The shop chooses how much happens by itself. On "check" a check is a
 *     check — downloading is a second press and installing a third. On "auto"
 *     the download happens quietly in the background, but the swap still waits
 *     until MyVault is next closed: a stock list must never restart itself in
 *     the middle of a Saturday.
 *
 *   • Only GitHub, only over HTTPS, and only downwards. See ./update-policy.js.
 *
 * The heavy lifting — resuming interrupted downloads, verifying the sha512 in
 * the release's latest.yml, and handing the installer to Windows correctly — is
 * electron-updater's, which ships alongside the electron-builder that produced
 * the installer in the first place.
 */

const {
  FEED,
  updateSupport,
  isNewerVersion,
  assertDownloadAllowed,
  describeUpdateError,
} = require('./update-policy');

/** Anything longer than this and the shop is staring at a spinner for nothing. */
const CHECK_TIMEOUT_MS = 30_000;

/**
 * A shop opening for the day wants its stock list, not a network request. The
 * automatic check waits until the window is up and being used.
 */
const STARTUP_DELAY_MS = 20_000;

/** Once a day is plenty for a program that changes a few times a year. */
const DAILY_MS = 24 * 60 * 60 * 1000;

class Updater {
  /**
   * @param {object} options
   * @param {() => 'off'|'check'|'auto'} options.getMode reads the shop's own
   *   setting, live, so changing it takes effect without restarting.
   * @param {(status: object) => void} options.onStatus
   */
  constructor({ app, getMode, onStatus, isDev = false }) {
    this.app = app;
    this.getMode = getMode;
    this.onStatus = onStatus;
    this.autoUpdater = null;
    this.timer = null;

    const { supported, reason } = updateSupport({
      platform: process.platform,
      packaged: app.isPackaged && !isDev,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    });

    this.supported = supported;
    this.unsupportedReason = reason;

    this.status = {
      state: supported ? 'idle' : 'unsupported',
      automatic: false,
      reason,
      currentVersion: app.getVersion(),
      newVersion: '',
      notes: '',
      percent: 0,
      transferred: 0,
      total: 0,
      checkedAt: '',
      error: '',
    };
  }

  /** Sends the current status to whoever is listening, without leaking the object. */
  emit(patch = {}) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
  }

  getStatus() {
    const mode = this.getMode();
    return {
      ...this.status,
      supported: this.supported,
      mode,
      enabled: mode !== 'off',
      automatic: mode === 'auto',
    };
  }

  /**
   * electron-updater is only loaded when it is first needed, so a shop that
   * never turns updates on never even pulls the library into memory.
   */
  connect() {
    if (this.autoUpdater) return this.autoUpdater;

    // eslint-disable-next-line global-require
    const { autoUpdater } = require('electron-updater');

    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ ...FEED });
    this.autoUpdater = autoUpdater;
    this.applyMode();

    // electron-updater logs to the console by default; keep it quiet but keep
    // the failures, which are the only part worth reading.
    autoUpdater.logger = { info() {}, warn() {}, debug() {}, error: console.error };

    autoUpdater.on('error', (error) => {
      this.emit({ state: 'error', error: describeUpdateError(error), percent: 0 });
    });

    autoUpdater.on('update-available', (info) => {
      // electron-updater has already compared the versions, but it is comparing
      // against whatever the feed said. Check it ourselves before telling the
      // shop there is something newer.
      if (!isNewerVersion(this.status.currentVersion, info?.version)) {
        this.emit({ state: 'current', checkedAt: new Date().toISOString(), error: '' });
        return;
      }
      this.emit({
        state: 'available',
        newVersion: String(info?.version || ''),
        notes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : '',
        checkedAt: new Date().toISOString(),
        error: '',
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.emit({ state: 'current', checkedAt: new Date().toISOString(), error: '' });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.emit({
        state: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))),
        transferred: progress?.transferred || 0,
        total: progress?.total || 0,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.emit({
        state: 'ready',
        newVersion: String(info?.version || this.status.newVersion),
        percent: 100,
        error: '',
      });
    });

    return autoUpdater;
  }

  /**
   * "Automatic" means fetch it quietly and swap it in when MyVault is next
   * closed — never mid-afternoon with a queue at the till. The shop can still
   * press Install to do it there and then.
   */
  applyMode() {
    if (!this.autoUpdater) return;
    const automatic = this.getMode() === 'auto';
    this.autoUpdater.autoDownload = automatic;
    this.autoUpdater.autoInstallOnAppQuit = automatic;
  }

  /**
   * Starts, or stops, the unattended checking. Called once at launch and again
   * whenever the setting changes, so turning updates off silences it at once
   * rather than at the next restart.
   */
  schedule() {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
    this.applyMode();
    if (!this.supported || this.getMode() === 'off') return;

    const tick = () => {
      // The setting may have been switched off since this was scheduled.
      if (this.getMode() === 'off') return;
      this.check().catch(() => { /* already reported through the status */ });
    };

    this.timer = setTimeout(() => {
      tick();
      this.timer = setInterval(tick, DAILY_MS);
    }, STARTUP_DELAY_MS);
    // Never hold the app open just to run a check.
    this.timer.unref?.();
  }

  /** Throws the reason rather than failing quietly, so the UI can say it out loud. */
  requireReady() {
    if (!this.supported) {
      throw new Error(
        this.unsupportedReason === 'portable'
          ? 'The portable MyVault cannot replace itself. Download the newer one instead.'
          : 'This copy of MyVault cannot update itself.',
      );
    }
    if (this.getMode() === 'off') {
      throw new Error('Updates are switched off.');
    }
  }

  async check() {
    this.requireReady();
    this.emit({ state: 'checking', error: '', percent: 0 });

    const updater = this.connect();
    try {
      // checkForUpdates can hang on a captive-portal wifi that accepts the
      // connection and then says nothing at all.
      await withTimeout(updater.checkForUpdates(), CHECK_TIMEOUT_MS, 'The check timed out.');
    } catch (error) {
      this.emit({ state: 'error', error: describeUpdateError(error) });
      throw new Error(describeUpdateError(error));
    }
    return this.getStatus();
  }

  async download() {
    this.requireReady();
    if (this.status.state !== 'available') {
      throw new Error('There is nothing to download. Check for updates first.');
    }

    const updater = this.connect();
    // The URL is settled by now; make sure it is one we are willing to fetch.
    const files = updater.currentVersionInfo || {};
    if (files.url) assertDownloadAllowed(String(files.url));

    this.emit({ state: 'downloading', percent: 0, transferred: 0, total: 0, error: '' });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      this.emit({ state: 'error', error: describeUpdateError(error), percent: 0 });
      throw new Error(describeUpdateError(error));
    }
    return this.getStatus();
  }

  /**
   * Closes MyVault and hands over to the installer. Everything is already on
   * disk and written out — the store saves on every change — so there is nothing
   * to lose here, but the shop pressed a button that says so either way.
   */
  install() {
    this.requireReady();
    if (this.status.state !== 'ready') {
      throw new Error('The update has not finished downloading yet.');
    }
    const updater = this.connect();
    setImmediate(() => updater.quitAndInstall(false, true));
    return true;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

module.exports = { Updater, CHECK_TIMEOUT_MS };
