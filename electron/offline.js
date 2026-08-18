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

/**
 * What the window is allowed to load, and from where.
 *
 * A second lock on the same door as the request blocker below, aimed at a
 * different failure. The blocker stops MyVault reaching the network; this stops
 * markup that somehow got into the page from doing anything with what it can
 * reach. Nothing in the interface is built by pasting strings into HTML — React
 * escapes every value it renders and there is not one dangerouslySetInnerHTML in
 * the codebase — but a policy is what makes that a property of the program
 * rather than a property of nobody having written the wrong line yet.
 *
 *   default-src 'none'   nothing loads unless a rule below says it may
 *   script-src 'self'    only MyVault's own bundle. No inline, no eval,
 *                        and therefore no <img onerror=…> either
 *   style-src            'unsafe-inline' is needed because React sets style
 *                        attributes; styles cannot execute
 *   img-src data:        the picture chosen for a barcode arrives as a data URL
 *   connect-src 'self'   the window has nowhere to connect to
 *
 * The last four do not inherit from default-src and so have to be written out:
 * a page with no frames still has to say it will not be framed, and a form with
 * nowhere to go still has to say so.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The same policy for the printed page.
 *
 * A document built for printing is loaded into an offscreen window as a data:
 * URL. It already runs with javascript disabled and every value escaped on the
 * way in, so this is the third lock on that particular door — but it is one line
 * and it costs nothing, and the page is the only HTML in MyVault that is
 * assembled from the shop's own text.
 */
const PRINT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

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

  // The policy also travels as a header, not only as the <meta> tag in the
  // built index.html. Three reasons it is worth having both: a header applies
  // from the first byte rather than from wherever the parser meets the tag,
  // frame-ancestors is ignored in a meta tag altogether, and a header covers
  // every document the session loads rather than the one file that carries the
  // tag. The dev server is left alone — hot reload needs inline scripts and a
  // websocket, and the packaged app is what ships.
  if (!isDev) {
    targetSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }

  // Nothing in a stock list needs the camera, the microphone or your location.
  targetSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  PRINT_CONTENT_SECURITY_POLICY,
  NETWORK_SWITCHES,
  DISABLED_FEATURES,
  OFFLINE_SCHEMES,
  UPDATE_HOSTS,
  isAllowedRequest,
  isUpdateHost,
  enforceOffline,
};
