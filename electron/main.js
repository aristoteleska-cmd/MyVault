'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');

const { Store, STANDARD_FIELDS, MAX_CUSTOM_FIELDS } = require('./store');
const { report, reorderList, clientHistory } = require('./statistics');
const { buildDocument } = require('./pdf');
const { NETWORK_SWITCHES, DISABLED_FEATURES, UPDATE_HOSTS, enforceOffline } = require('./offline');
const { parseCsv, toCsv } = require('./csv');
const { Updater } = require('./updater');
const {
  ROLES, CAPABILITIES, ROLE_CAPABILITIES,
  allows, effectiveRole, isLocked, isAppearanceOnly,
} = require('./roles');

const isDev = process.env.MYVAULT_DEV === '1';
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

/**
 * MyVault is an offline program and stays that way once installed.
 *
 * Two layers enforce it. First, the Chromium services that would otherwise chat
 * to the network on their own — component updates, safe-browsing lists, metrics,
 * autofill sync — are switched off before the engine starts. Second, every
 * request the app makes at runtime is cancelled unless it is loading MyVault's
 * own bundled files from disk. The rules themselves live in ./offline.js.
 */
for (const flag of NETWORK_SWITCHES) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('disable-features', DISABLED_FEATURES);

/**
 * Where the shop's data lives.
 *
 * When MyVault runs as the portable .exe (e.g. from a USB stick behind the
 * counter) the data folder sits next to the executable so the whole shop
 * inventory travels with it. Installed copies use the normal Windows
 * per-user app data folder.
 */
function resolveDataDir() {
  if (process.env.MYVAULT_DATA_DIR) return process.env.MYVAULT_DATA_DIR;
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'MyVault-Data');
  }
  return path.join(app.getPath('userData'), 'data');
}

let store;
let mainWindow = null;
let updater = null;

/**
 * Who is signed in, held here in the main process and nowhere else.
 *
 * Deliberately not in the data file: signing in is for this sitting at this
 * till, and closing MyVault should hand the next person a locked screen rather
 * than whatever the last person was allowed to do.
 */
let signedInId = null;

/**
 * A recovery code that has just been minted and not yet shown to anybody.
 *
 * Kept in memory only, and handed over exactly once: the code exists in a
 * readable form for the few seconds between being generated and being put on
 * screen, and nowhere else, ever.
 */
let pendingRecoveryCode = '';

/**
 * The manager the installer was told about.
 *
 * The installer writes the name and PIN into the registry and MyVault picks
 * them up the first time it runs, turns the PIN into a salted hash, and deletes
 * both values immediately. Reading them is the only moment they are needed and
 * the last moment they exist in the clear.
 */
function consumeInstallerSetup() {
  if (process.platform !== 'win32') return null;
  const read = (name) => {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\MyVault', '/v', name],
        { encoding: 'utf8', timeout: 2000, windowsHide: true },
      );
      const match = out.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)`, 'i'));
      return match ? match[1].trim() : '';
    } catch {
      return '';
    }
  };
  const forget = (name) => {
    try {
      const { execFileSync } = require('child_process');
      execFileSync(
        'reg',
        ['delete', 'HKCU\\Software\\MyVault', '/v', name, '/f'],
        { encoding: 'utf8', timeout: 2000, windowsHide: true },
      );
    } catch { /* already gone, which is the state we wanted */ }
  };

  const name = read('SetupName');
  const pin = read('SetupPin');
  // Whether or not they are usable, they do not stay in the registry.
  if (name || pin) {
    forget('SetupName');
    forget('SetupPin');
  }
  return name && pin ? { name, pin } : null;
}

/**
 * Turns what the installer collected into a real manager account.
 *
 * Only ever on a shop with no staff list — an update reinstalled over an
 * existing shop must not quietly add a second manager, and the installer values
 * are deleted either way.
 */
function applyInstallerSetup() {
  const setup = consumeInstallerSetup();
  if (!setup) return;
  if (store.getState().users.length > 0) return;
  try {
    store.addUser({ name: setup.name, role: 'admin', pin: setup.pin });
    pendingRecoveryCode = store.issueRecoveryCode();
  } catch (error) {
    // A PIN the installer let through but the store will not is not worth
    // failing to start over: the shop is asked to set up a manager instead.
    console.error('Could not create the manager from the installer:', error.message);
  }
}

/** What the window is allowed to know about the current sitting. */
function authState() {
  const { users } = store.getState();
  const role = effectiveRole(users, signedInId);
  const user = users.find((candidate) => candidate.id === signedInId) || null;
  return {
    locked: isLocked(users),
    hasRecoveryCode: store.recoveryStatus().exists,
    signedIn: role !== null,
    role,
    user: user ? { id: user.id, name: user.name, role: user.role } : null,
    capabilities: role ? [...ROLE_CAPABILITIES[role]] : [],
    roles: ROLES,
    staffCount: users.length,
  };
}

/**
 * Whose name goes in the history against this action.
 *
 * Empty on a shop that has never set up staff, which is honest: with no staff
 * list there is nobody to name, and inventing "Owner" would put a person in the
 * record who does not exist.
 */
function whoAmI() {
  const user = store.getState().users.find((candidate) => candidate.id === signedInId);
  return user ? user.name : '';
}

/**
 * The real gate.
 *
 * Hiding a button is a courtesy to the person using the app; this is what
 * actually stops the action, on the far side of the bridge where a renderer
 * cannot reach. Every mutating channel goes through it.
 */
function requireCapability(capability) {
  const { users } = store.getState();
  if (allows(users, signedInId, capability)) return;
  const role = effectiveRole(users, signedInId);
  throw new Error(
    role === null
      ? 'Sign in to do that.'
      : `Somebody with more access has to do that — you are signed in as ${role}.`,
  );
}

/**
 * The language chosen on the installer's first screen, which it records in the
 * registry. Read once, on Windows only, and only as a hint — anything unexpected
 * just falls back to the Windows display language.
 */
function installerLanguage() {
  if (process.platform !== 'win32') return '';
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\MyVault', '/v', 'InstallerLanguage'],
      { encoding: 'utf8', timeout: 2000, windowsHide: true },
    );
    const match = out.match(/InstallerLanguage\s+REG_SZ\s+(\S+)/i);
    return match ? LCID_TO_LANGUAGE[Number(match[1])] || '' : '';
  } catch {
    return '';
  }
}

/** NSIS reports the chosen language as a Windows LCID. */
const LCID_TO_LANGUAGE = {
  1033: 'en', 2057: 'en', 3081: 'en', 4105: 'en',
  2052: 'zh-Hans', 4100: 'zh-Hans',
  1028: 'zh-Hant', 3076: 'zh-Hant', 5124: 'zh-Hant',
  1081: 'hi', 1034: 'es', 3082: 'es', 2058: 'es',
  1036: 'fr', 1025: 'ar', 1093: 'bn',
  1046: 'pt', 2070: 'pt', 1049: 'ru', 1056: 'ur',
  1057: 'id', 1031: 'de', 1041: 'ja', 1102: 'mr',
  1098: 'te', 1055: 'tr', 1097: 'ta', 1066: 'vi',
  1042: 'ko', 1032: 'el',
};

// A single instance only — two windows writing the same JSON file would fight.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151c' : '#f4f6fb',
    title: 'MyVault',
    // Only present when running from source; the installed .exe carries its own
    // icon, and build/ is not shipped inside the package.
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // No second windows, and no handing a URL off to a browser either — the app
  // has no reason to send anyone anywhere.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? 'http://localhost:5173' : 'file://';
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const send = (channel, payload) => mainWindow?.webContents.send(channel, payload);

  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New item', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-item') },
        { type: 'separator' },
        { label: 'Import from CSV…', click: () => send('menu:import-csv') },
        { label: 'Export to CSV…', click: () => send('menu:export-csv') },
        { type: 'separator' },
        { label: 'Backup all data…', click: () => send('menu:backup') },
        { label: 'Restore from backup…', click: () => send('menu:restore') },
        { type: 'separator' },
        { label: 'Open data folder', click: () => shell.openPath(store.dataDir) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find item', accelerator: 'CmdOrCtrl+F', click: () => send('menu:focus-search') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About MyVault',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About MyVault',
              message: `MyVault ${app.getVersion()}`,
              detail:
                'Offline stock manager for small shops.\n\n' +
                'Your inventory never leaves this computer — it is stored in:\n' +
                `${store.file}`,
              buttons: ['Close'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Photographs, not scans of documents: a 25 MB file is a mistake rather than a
 * barcode, and turning one into a data: URL would cost a third again in memory
 * on both sides of the bridge.
 */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
};

function readImageFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME[extension];
  if (!mime) throw new Error('That file is not a picture MyVault can read.');

  const { size } = fs.statSync(filePath);
  if (size > MAX_IMAGE_BYTES) {
    throw new Error('That picture is too large. Anything up to 25 MB is fine.');
  }
  if (size === 0) throw new Error('That file is empty.');

  const base64 = fs.readFileSync(filePath).toString('base64');
  return { dataUrl: `data:${mime};base64,${base64}`, name: path.basename(filePath) };
}

// --------------------------------------------------------------------- IPC

/**
 * Wraps a handler so the renderer always receives {ok, data} or {ok:false, error}.
 *
 * The middle argument is the capability the caller must hold. Passing null is
 * how a channel says "anyone, even before signing in" — only the few that the
 * sign-in screen itself needs.
 */
function handle(channel, capability, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      if (capability) requireCapability(capability);
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

function registerIpc() {
  handle('app:info', null, () => ({
    version: app.getVersion(),
    dataFile: store.file,
    dataDir: store.dataDir,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    standardFields: STANDARD_FIELDS,
    maxCustomFields: MAX_CUSTOM_FIELDS,
    // The interface never reaches the network, whatever the update setting says.
    offline: true,
    // …and this is the complete list of what the rest of the program may
    // contact, and only while a check the shop asked for is running.
    updateHosts: UPDATE_HOSTS,
    roles: ROLES,
    capabilities: CAPABILITIES,
    // Used the first time the app runs, before the shop has picked a language.
    systemLocale: installerLanguage() || app.getLocale(),
  }));

  handle('state:get', 'items.view', () => store.publicState());

  // ------------------------------------------------------------------- staff

  // Open to anyone, because the sign-in screen has to be able to draw itself
  // and to try a PIN. Neither tells the window anything a stranger could use:
  // no names are returned until somebody is actually signed in.
  handle('auth:state', null, () => authState());

  handle('auth:sign-in', null, (pin) => {
    const found = store.findByPin(pin);
    // One message for a wrong PIN and for a PIN belonging to nobody, so trying
    // numbers tells you nothing about who works here.
    if (!found) throw new Error('That PIN was not recognised.');
    signedInId = found.id;
    return authState();
  });

  handle('auth:sign-out', null, () => {
    signedInId = null;
    return authState();
  });

  handle('staff:list', 'staff.manage', () => store.listUsers());
  handle('staff:add', 'staff.manage', (input) => store.addUser(input));
  handle('staff:update', 'staff.manage', (id, patch) => store.updateUser(id, patch));

  /**
   * The recovery code, shown once and never again.
   *
   * Deliberately open to anyone: it is only ever non-empty in the seconds after
   * a manager is created, and the window it is handed to is the one that has
   * just created them.
   */
  handle('auth:pending-recovery-code', null, () => {
    const code = pendingRecoveryCode;
    pendingRecoveryCode = '';
    return code;
  });

  handle('auth:recovery-status', null, () => store.recoveryStatus());

  /**
   * Getting back in when the PIN has been forgotten.
   *
   * Open to anyone, because the person using it cannot sign in — that is the
   * whole situation. The code is the credential: twenty characters from a
   * 31-character alphabet, checked against a scrypt hash, so guessing is not a
   * route in and there is nothing here to rate-limit.
   */
  handle('auth:recover', null, ({ code, pin }) => {
    const { user, nextCode } = store.useRecoveryCode(code, pin);
    // Straight in as that manager: they have proved who they are, and making
    // them type the PIN they just chose adds nothing.
    signedInId = user.id;
    pendingRecoveryCode = nextCode;
    return { auth: authState(), user };
  });

  handle('staff:new-recovery-code', 'staff.manage', () => {
    pendingRecoveryCode = store.issueRecoveryCode();
    return store.recoveryStatus();
  });

  handle('staff:disable', 'staff.manage', () => {
    store.disableStaff();
    signedInId = null;
    return authState();
  });

  handle('staff:delete', 'staff.manage', (id) => {
    const remaining = store.deleteUser(id);
    // Removing yourself ends your own sitting rather than leaving a signed-in
    // ghost with a role nobody holds any more.
    if (id === signedInId) signedInId = null;
    return remaining;
  });

  /**
   * Setting up roles for the first time.
   *
   * Until this is done MyVault is unlocked and everyone is a manager, so this
   * one channel cannot require staff.manage — there would be no way in. It
   * refuses the moment a staff list exists, after which staff:add is the way.
   */
  handle('staff:create-first-admin', null, ({ name, pin }) => {
    if (isLocked(store.getState().users)) {
      throw new Error('Staff roles are already set up.');
    }
    const admin = store.addUser({ name, role: 'admin', pin });
    signedInId = admin.id;
    pendingRecoveryCode = store.issueRecoveryCode();
    return authState();
  });

  handle('items:add', 'items.create', (input) => store.addItem(input, { by: whoAmI() }));
  handle('items:update', 'items.edit', (id, patch) => store.updateItem(id, patch, { by: whoAmI() }));
  // Selling and receiving are different jobs: a junior on the till takes stock
  // down when something sells, but correcting a count upwards is not theirs.
  handle('items:adjust', null, (id, delta, options = {}) => {
    const selling = Number(delta) < 0;
    // A return puts stock back like a delivery does, but it hands money over
    // the counter, so it is its own permission rather than "receiving".
    if (options.reason === 'return') requireCapability('items.return');
    else requireCapability(selling ? 'items.sell' : 'items.receive');
    const knowsClients = allows(store.getState().users, signedInId, 'clients.view');
    return store.adjustStock(id, delta, {
      reason: options.reason,
      // A sale and a return both belong to a customer — a refund against the
      // right regular is the whole reason their history is worth keeping — and
      // only if whoever is at the screen may know the customer list at all.
      clientId: (selling || options.reason === 'return') && knowsClients ? options.clientId : '',
      by: whoAmI(),
    });
  });
  handle('items:delete', 'items.delete', (ids) => store.deleteItems(ids, { by: whoAmI() }));
  handle('items:restore', 'items.delete', (items) => store.restoreItems(items, { by: whoAmI() }));

  // ----------------------------------------------------------------- clients

  handle('clients:add', 'clients.manage', (input) => store.addClient(input));
  handle('clients:update', 'clients.manage', (id, patch) => store.updateClient(id, patch));
  handle('clients:delete', 'clients.manage', (id) => store.deleteClient(id));

  /**
   * What one customer has bought.
   *
   * Read from the movement log rather than kept beside the contact, so adding a
   * customer costs nothing and selling something does not rewrite the address
   * book. Only the recent lines cross the bridge; the totals cover everything.
   */
  handle('clients:history', 'clients.view', (id, options = {}) =>
    clientHistory(store.movements, id, { limit: Math.min(500, Number(options.limit) || 100) }));

  // -------------------------------------------------------------- statistics

  /**
   * The whole statistics screen in one answer.
   *
   * The summing happens here, on this side of the bridge, and what crosses is a
   * few dozen numbers. A shop with three years behind it has hundreds of
   * thousands of movements, and handing those to the window to add up is the one
   * thing that would make this screen unusable.
   */
  handle('stats:report', 'stats.view', (range = {}) =>
    report(store.getState(), store.movements, { from: range.from, to: range.to }));

  /** The recent movements themselves, for the "what happened" list. */
  handle('stats:movements', 'stats.view', (range = {}) => store.movements.list({
    from: range.from,
    to: range.to,
    limit: Math.min(500, Number(range.limit) || 100),
  }));

  /** What to order this morning, grouped by who to order it from. */
  handle('stats:reorder', 'stats.view', (options = {}) => reorderList(
    store.getState(),
    store.movements,
    {
      days: Math.min(365, Math.max(7, Number(options.days) || 30)),
      cover: Math.min(180, Math.max(7, Number(options.cover) || 30)),
    },
  ));

  // -------------------------------------------------------------- stock take

  handle('stocktake:start', 'stocktake.run', (options = {}) =>
    store.startStockTake({ categoryId: options.categoryId, by: whoAmI() }));
  handle('stocktake:progress', 'stocktake.run', () => store.stockTakeProgress());
  handle('stocktake:count', 'stocktake.run', (itemId, counted) => {
    store.countStockTake(itemId, counted);
    return store.stockTakeProgress();
  });
  handle('stocktake:cancel', 'stocktake.run', () => store.cancelStockTake());
  handle('stocktake:apply', 'stocktake.run', () => ({
    ...store.applyStockTake({ by: whoAmI() }),
    state: store.publicState(),
  }));

  // ---------------------------------------------------------------- printing

  /**
   * Prints one of MyVault's own documents to a PDF the shop chooses a home for.
   *
   * The window supplies values and a document name, never markup — the page is
   * assembled in ./pdf.js with everything escaped, and rendered in an offscreen
   * window that is thrown away immediately. Nothing here touches the network:
   * the page is loaded from a data: URL, which is one of the few schemes the
   * offline rules allow at all.
   */
  handle('print:pdf', 'items.view', async ({ kind, payload, fileName } = {}) => {
    const html = buildDocument(kind, payload);

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save as PDF',
      defaultPath: `${fileName || 'myvault'}-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const sheet = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true },
    });
    try {
      await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await sheet.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: false,
        margins: { marginType: 'default' },
      });
      fs.writeFileSync(filePath, pdf);
    } finally {
      sheet.destroy();
    }
    return { canceled: false, filePath };
  });

  // ------------------------------------------------------- the second backup

  handle('backup:status', 'settings.manage', () => store.mirrorStatus());

  handle('backup:choose-folder', 'settings.manage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the second copy',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.length) return { canceled: true };
    store.updateSettings({ backupFolder: filePaths[0] });
    // Prove it works now rather than discovering at the worst moment that the
    // folder was read-only.
    store.mirrorBackup();
    return { canceled: false, status: store.mirrorStatus(), settings: store.getState().settings };
  });

  handle('backup:forget-folder', 'settings.manage', () => {
    store.updateSettings({ backupFolder: '' });
    store.lastMirror = null;
    return { status: store.mirrorStatus(), settings: store.getState().settings };
  });

  handle('backup:now', 'data.export', () => {
    const folder = (store.getState().settings.backupFolder || '').trim();
    if (!folder) throw new Error('No second folder has been chosen yet.');
    store.mirrorBackup({ force: true });
    return store.mirrorStatus();
  });

  handle('categories:add', 'categories.manage', (input) => store.addCategory(input));
  handle('categories:update', 'categories.manage', (id, patch) => store.updateCategory(id, patch));
  handle('categories:delete', 'categories.manage', (id) => store.deleteCategory(id));

  handle('fields:add', 'fields.manage', (input) => store.addField(input));
  handle('fields:update', 'fields.manage', (id, patch) => store.updateField(id, patch));
  handle('fields:delete', 'fields.manage', (id) => store.deleteField(id));
  handle('fields:move', 'fields.manage', (id, direction) => store.moveField(id, direction));

  handle('settings:update', null, (patch) => {
    // Theme, text size and language are the looker's own business; everything
    // else on that screen belongs to whoever runs the shop.
    if (!isAppearanceOnly(patch)) requireCapability('settings.manage');
    const settings = store.updateSettings(patch);
    if (patch.theme) {
      nativeTheme.themeSource = ['light', 'dark'].includes(patch.theme) ? patch.theme : 'system';
    }
    // Changing the update setting takes effect at once — a shop that switches
    // it off should not have a check fire ten minutes later.
    if ('updates' in patch) updater?.schedule();
    return settings;
  });

  // ----------------------------------------------------------------- updates

  handle('updates:status', null, () => updater.getStatus());
  handle('updates:check', 'settings.manage', () => updater.check());
  handle('updates:download', 'settings.manage', () => updater.download());
  handle('updates:install', 'settings.manage', () => updater.install());

  handle('data:open-folder', 'settings.manage', () => shell.openPath(store.dataDir));

  /**
   * Hands a picture to the renderer so it can be read for a barcode.
   *
   * The file is turned into a data: URL rather than a path, because the window
   * has no filesystem access and must not be given any. Nothing leaves this
   * machine — the decoding happens inside the app.
   */
  handle('data:pick-image', 'items.view', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a photo of the barcode',
      properties: ['openFile'],
      filters: [{ name: 'Picture', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    });
    if (canceled || !filePaths?.length) return { canceled: true };
    return { canceled: false, ...readImageFile(filePaths[0]) };
  });

  // ------------------------------------------------------- import / export

  handle('data:export-csv', 'data.export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export inventory to CSV',
      defaultPath: `myvault-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const db = store.getState();
    const categoryName = new Map(db.categories.map((c) => [c.id, c.name]));
    const headers = [
      'Name', 'Barcode', 'SKU', 'Category', 'Quantity', 'Price', 'Cost',
      'Low stock threshold', 'Supplier', 'Notes',
      ...db.customFields.map((f) => f.name),
    ];

    const rows = db.items.map((item) => {
      const row = {
        Name: item.name,
        Barcode: item.barcode,
        SKU: item.sku,
        Category: categoryName.get(item.categoryId) || '',
        Quantity: item.quantity,
        Price: item.price,
        Cost: item.cost,
        'Low stock threshold': item.lowStockThreshold ?? '',
        Supplier: item.supplier,
        Notes: item.notes,
      };
      for (const field of db.customFields) {
        row[field.name] = item.custom?.[field.id] ?? '';
      }
      return row;
    });

    fs.writeFileSync(filePath, toCsv(headers, rows), 'utf8');
    return { canceled: false, filePath, count: rows.length };
  });

  handle('data:import-csv', 'data.import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import items from CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV file', extensions: ['csv', 'txt'] }],
    });
    if (canceled || !filePaths?.length) return { canceled: true };

    const rows = parseCsv(fs.readFileSync(filePaths[0], 'utf8'));
    if (!rows.length) throw new Error('No rows found. The file needs a header row with at least a "Name" column.');

    const result = store.importRows(rows);
    return { canceled: false, ...result, state: store.publicState() };
  });

  handle('data:backup', 'data.export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save a full backup',
      defaultPath: `myvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'MyVault backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(store.getState(), null, 2), 'utf8');
    return { canceled: false, filePath };
  });

  handle('data:restore', 'settings.manage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore from a backup file',
      properties: ['openFile'],
      filters: [{ name: 'MyVault backup', extensions: ['json'] }],
    });
    if (canceled || !filePaths?.length) return { canceled: true };

    const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('That file is not a MyVault backup.');
    }

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Replace current inventory?',
      message: `Restore ${parsed.items.length} items from this backup?`,
      detail: 'Everything currently in MyVault will be replaced. A safety copy of your current data is kept in the backups folder.',
      buttons: ['Cancel', 'Replace my data'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response !== 1) return { canceled: true };

    // Keep the inventory being replaced, in case the backup was the wrong file.
    store.snapshot('before-restore');
    store.replaceAll(parsed);
    // A restored file may bring a different staff list with it, so whoever is
    // signed in now may not exist any more. Start the sitting again.
    signedInId = null;
    return { canceled: false, state: store.publicState() };
  });

  handle('dialog:confirm-delete', 'items.delete', async (count) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: count === 1 ? 'Delete item' : 'Delete items',
      message: count === 1 ? 'Delete this item?' : `Delete ${count} items?`,
      detail: 'You can undo this straight away from the message that appears.',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1;
  });
}

app.whenReady().then(() => {
  enforceOffline(session.defaultSession, { isDev });

  store = new Store(resolveDataDir(), app.getVersion());
  store.init();

  const theme = store.getState().settings.theme;
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';

  // Idle unless the shop has chosen otherwise. On "off", the default, nothing
  // below ever opens a connection.
  updater = new Updater({
    app,
    isDev,
    getMode: () => store.getState().settings.updates,
    onStatus: (status) => mainWindow?.webContents.send('updates:status', status),
  });
  // Arms the daily check if — and only if — the shop has asked for one.
  updater.schedule();

  // Whatever the installer was told about the manager, turned into an account
  // and wiped from the registry. Does nothing on an existing shop.
  applyInstallerSetup();

  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
