'use strict';

/**
 * The decisions the updater makes, with no dependency on Electron or the
 * network, so they can be tested directly.
 *
 * The wiring that actually talks to GitHub lives in ./updater.js. Everything
 * here is a plain function over plain values: whether this copy of MyVault can
 * update itself at all, whether a version it was offered is genuinely newer,
 * and how to phrase a failure for a shopkeeper rather than a programmer.
 */

const { isUpdateHost } = require('./offline');

/**
 * Where the installers are published.
 *
 * The repository is public, so a shop reaches this with no token and no
 * account — which is the whole reason the updater can work at all. It was
 * briefly pointed at a separate downloads repo, for when the source was
 * private; that is no longer needed.
 */
const FEED = Object.freeze({
  provider: 'github',
  owner: 'aristoteleska-cmd',
  repo: 'MyVault',
});

/**
 * Whether this copy of MyVault is one that can replace itself.
 *
 * The portable .exe is deliberately excluded: it may be running from a USB
 * stick or a folder the shop copied by hand, and overwriting it would be
 * rewriting a file the user thinks of as theirs. They get told to download the
 * new one instead. A build running from source has no installer to swap either.
 */
function updateSupport({ platform, packaged, portable }) {
  if (!packaged) return { supported: false, reason: 'dev' };
  if (portable) return { supported: false, reason: 'portable' };
  if (platform !== 'win32') return { supported: false, reason: 'platform' };
  return { supported: true, reason: '' };
}

/**
 * Splits "1.10.2" into comparable numbers, ignoring anything after a dash so a
 * hand-tagged "1.2.0-test" still compares as 1.2.0.
 */
function parseVersion(value) {
  const core = String(value ?? '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
}

/** -1, 0 or 1, the way a comparator wants it. */
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Only ever move forward.
 *
 * A release published by mistake and then deleted, or a tag that sorts oddly,
 * must never talk a shop into "updating" to an older MyVault — their data would
 * be opened by a version that does not understand it.
 */
function isNewerVersion(current, candidate) {
  if (!String(candidate ?? '').trim()) return false;
  return compareVersions(candidate, current) > 0;
}

/**
 * Every URL the updater is about to fetch has to be a GitHub download over
 * HTTPS. This is belt and braces around the feed configuration: if a future
 * change, or a tampered app-update.yml, pointed the updater somewhere else,
 * the download stops here rather than running whatever it was handed.
 */
function assertDownloadAllowed(url) {
  if (!isUpdateHost(url)) {
    throw new Error(`Refusing to download an update from ${url || 'an unknown address'}.`);
  }
  return true;
}

/**
 * Checks the file list a release's latest.yml declared, before a byte is fetched.
 *
 * Nearly every entry is a bare filename — "MyVault-1.5.0-setup.exe" — which the
 * updater resolves against the GitHub release it just read, and those are safe
 * by construction. What matters is the other case: a latest.yml that names a
 * full URL somewhere else entirely. That is what a tampered or hijacked feed
 * would look like, and it is the one thing worth refusing outright.
 *
 * This replaces an earlier check that read a property electron-updater does not
 * have, and therefore never ran at all.
 */
function assertFilesAllowed(files) {
  for (const file of Array.isArray(files) ? files : []) {
    const url = String(file?.url ?? '').trim();
    if (!url) continue;
    // A bare name, or a path within the release — resolved against GitHub.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//')) continue;
    assertDownloadAllowed(url);
  }
  return true;
}

/**
 * Turns whatever the network threw into one short sentence.
 *
 * The shop cannot act on "ENOTFOUND api.github.com" but can act on "no
 * internet connection", so the common cases are named and everything else falls
 * back to the original text rather than being hidden.
 */
function describeUpdateError(error) {
  const raw = (error && (error.message || error.code)) || String(error || '');
  const text = String(raw);

  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|getaddrinfo/i.test(text)) {
    return 'No internet connection.';
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(text)) {
    return 'GitHub did not answer in time. Try again later.';
  }
  if (/ECONNRESET|ECONNREFUSED|socket hang up/i.test(text)) {
    return 'The connection dropped part-way. Try again.';
  }
  if (/certificate|self.signed|CERT_/i.test(text)) {
    return 'The connection could not be trusted, so nothing was downloaded.';
  }
  if (/404|Not Found|No published versions|Cannot find/i.test(text)) {
    return 'No published version was found to update to.';
  }
  if (/403|rate limit/i.test(text)) {
    return 'GitHub refused the request for now. Try again in a while.';
  }
  if (/sha512|checksum|integrity/i.test(text)) {
    return 'The download did not match its checksum, so it was thrown away.';
  }
  if (/ENOSPC|no space/i.test(text)) {
    return 'There is not enough free space to download the update.';
  }
  return text || 'The update could not be checked.';
}

module.exports = {
  FEED,
  updateSupport,
  parseVersion,
  compareVersions,
  isNewerVersion,
  assertDownloadAllowed,
  assertFilesAllowed,
  describeUpdateError,
};
