'use strict';

/**
 * The rules that keep MyVault offline once installed.
 *
 * Kept in its own module — with no dependency on Electron — so the policy can be
 * tested directly rather than only observed through a running window.
 */

/** Chromium services that would otherwise reach the network on their own. */
const NETWORK_SWITCHES = [
  'disable-background-networking',
  'disable-component-update',
  'disable-domain-reliability',
  'disable-breakpad',
  'disable-sync',
  'no-pings',
  'disable-client-side-phishing-detection',
];

const DISABLED_FEATURES = [
  'MediaRouter',
  'OptimizationHints',
  'AutofillServerCommunication',
  'SafeBrowsing',
  'NetworkTimeServiceQuerying',
].join(',');

/** Schemes that only ever read what is already on this machine. */
const OFFLINE_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:']);

/**
 * The one and only exception, and it is worth being precise about.
 *
 * The interface never reaches the network — not with updates switched on, not
 * ever. What changes when a shop turns updates on is that the *background* part
 * of MyVault may ask GitHub whether a newer installer exists, and fetch it. That
 * traffic does not go through the window, so the rule below still cancels
 * everything the interface tries; these hosts are listed so that what the
 * program is allowed to contact is written down in one place rather than
 * scattered through a library's internals.
 *
 * Nothing is ever uploaded. The requests are ordinary downloads: a small file
 * listing the newest version, then the installer itself.
 */
const UPDATE_HOSTS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

/** True if a URL points at one of the hosts the updater is allowed to use. */
function isUpdateHost(url) {
  if (typeof url !== 'string' || url === '') return false;
  try {
    const parsed = new URL(url);
    // Plain http would let anyone on the café wifi hand the shop an installer.
    if (parsed.protocol !== 'https:') return false;
    return UPDATE_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const DEV_SERVER = /^(https?|wss?):\/\/localhost:5173(\/|$|\?)/;

/**
 * True only for requests that stay on this computer.
 *
 * @param {string} url
 * @param {{ isDev?: boolean }} [options] in development the local Vite server is
 *   allowed, because that is where the interface is being served from. It is
 *   never allowed in a packaged build.
 */
function isAllowedRequest(url, { isDev = false } = {}) {
  if (typeof url !== 'string' || url === '') return false;
  if (isDev && DEV_SERVER.test(url)) return true;
  try {
    return OFFLINE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Applies the policy to a session: cancels every request that would leave this
 * machine, and refuses every device permission.
 */
function enforceOffline(targetSession, { isDev = false } = {}) {
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, { isDev }) });
  });

  // Nothing in a stock list needs the camera, the microphone or your location.
  targetSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
}

module.exports = {
  NETWORK_SWITCHES,
  DISABLED_FEATURES,
  OFFLINE_SCHEMES,
  UPDATE_HOSTS,
  isAllowedRequest,
  isUpdateHost,
  enforceOffline,
};
