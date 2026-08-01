'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');

const { Store, STANDARD_FIELDS, MAX_CUSTOM_FIELDS } = require('./store');
const { NETWORK_SWITCHES, DISABLED_FEATURES, enforceOffline } = require('./offline');
const { parseCsv, toCsv } = require('./csv');

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

// --------------------------------------------------------------------- IPC

/** Wraps a handler so the renderer always receives {ok, data} or {ok:false, error}. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    dataFile: store.file,
    dataDir: store.dataDir,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    standardFields: STANDARD_FIELDS,
    maxCustomFields: MAX_CUSTOM_FIELDS,
    offline: true,
  }));

  handle('state:get', () => store.getState());

  handle('items:add', (input) => store.addItem(input));
  handle('items:update', (id, patch) => store.updateItem(id, patch));
  handle('items:adjust', (id, delta) => store.adjustStock(id, delta));
  handle('items:delete', (ids) => store.deleteItems(ids));
  handle('items:restore', (items) => store.restoreItems(items));

  handle('categories:add', (input) => store.addCategory(input));
  handle('categories:update', (id, patch) => store.updateCategory(id, patch));
  handle('categories:delete', (id) => store.deleteCategory(id));

  handle('fields:add', (input) => store.addField(input));
  handle('fields:update', (id, patch) => store.updateField(id, patch));
  handle('fields:delete', (id) => store.deleteField(id));
  handle('fields:move', (id, direction) => store.moveField(id, direction));

  handle('settings:update', (patch) => {
    const settings = store.updateSettings(patch);
    if (patch.theme) {
      nativeTheme.themeSource = ['light', 'dark'].includes(patch.theme) ? patch.theme : 'system';
    }
    return settings;
  });

  handle('data:open-folder', () => shell.openPath(store.dataDir));

  // ------------------------------------------------------- import / export

  handle('data:export-csv', async () => {
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

  handle('data:import-csv', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import items from CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV file', extensions: ['csv', 'txt'] }],
    });
    if (canceled || !filePaths?.length) return { canceled: true };

    const rows = parseCsv(fs.readFileSync(filePaths[0], 'utf8'));
    if (!rows.length) throw new Error('No rows found. The file needs a header row with at least a "Name" column.');

    const result = store.importRows(rows);
    return { canceled: false, ...result, state: store.getState() };
  });

  handle('data:backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save a full backup',
      defaultPath: `myvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'MyVault backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(store.getState(), null, 2), 'utf8');
    return { canceled: false, filePath };
  });

  handle('data:restore', async () => {
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
    const state = store.replaceAll(parsed);
    return { canceled: false, state };
  });

  handle('dialog:confirm-delete', async (count) => {
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

  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
