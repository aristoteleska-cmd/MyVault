'use strict';

const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

/**
 * The only bridge between the UI and the file system. The renderer gets a small
 * fixed list of operations — it can never touch Node or the disk directly.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const menuChannels = [
  'menu:new-item',
  'menu:read-pdf',
  'menu:import-csv',
  'menu:export-csv',
  'menu:backup',
  'menu:restore',
  'menu:focus-search',
];

contextBridge.exposeInMainWorld('myvault', {
  getInfo: () => invoke('app:info'),

  /**
   * Where a file the shop dragged onto the window actually is.
   *
   * A dropped File in a browser is deliberately anonymous — the page is not
   * told where it came from. Electron can answer, and this is the only way the
   * window learns a path: it cannot invent one, and what it hands back still
   * goes through the same checks as a file chosen from the dialog.
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  getState: () => invoke('state:get'),

  items: {
    add: (input) => invoke('items:add', input),
    update: (id, patch) => invoke('items:update', id, patch),
    /** `options` carries why the stock moved, and who it was sold to. */
    adjust: (id, delta, options) => invoke('items:adjust', id, delta, options),
    remove: (ids) => invoke('items:delete', ids),
    restore: (items) => invoke('items:restore', items),
  },

  /** The shop's regulars. What they bought is worked out from the history. */
  clients: {
    add: (input) => invoke('clients:add', input),
    update: (id, patch) => invoke('clients:update', id, patch),
    remove: (id) => invoke('clients:delete', id),
    history: (id, options) => invoke('clients:history', id, options),
  },

  /**
   * The takings, and what is selling.
   *
   * Both of these are already summed up on the other side. The window never
   * receives the movements themselves, which is what keeps this screen the same
   * speed in a shop's fifth year as in its first.
   */
  stats: {
    report: (range) => invoke('stats:report', range),
    movements: (range) => invoke('stats:movements', range),
    reorder: (options) => invoke('stats:reorder', options),
  },

  /** Invoices and delivery notes: a whole piece of paper, posted at once. */
  docs: {
    drafts: () => invoke('docs:drafts'),
    start: (options) => invoke('docs:start', options),
    update: (id, patch) => invoke('docs:update', id, patch),
    setLine: (id, line) => invoke('docs:set-line', id, line),
    removeLine: (id, index) => invoke('docs:remove-line', id, index),
    discard: (id) => invoke('docs:discard', id),
    post: (id) => invoke('docs:post', id),
    void: (id) => invoke('docs:void', id),
    list: (options) => invoke('docs:list', options),
    importCsv: (id) => invoke('docs:import-csv', id),
    /** Reads a supplier's PDF invoice onto the draft, and says what it read. */
    importPdf: (id) => invoke('docs:import-pdf', id),
    /** The same, for a file dragged onto the window rather than chosen. */
    importPdfFile: (id, filePath) => invoke('docs:import-pdf-file', id, filePath),
    /** Create a product for a line the shop does not stock, and add it. */
    addMissing: (id, line) => invoke('docs:add-missing', id, line),
  },

  /** What the shop owes the tax office, and for which calendar period. */
  vat: {
    report: (range) => invoke('vat:report', range),
    periods: () => invoke('vat:periods'),
  },

  /**
   * Margins, and what a product usually costs.
   *
   * Read-only on purpose. Nothing here changes a price — a suggestion is worked
   * out here and written on the screen, and it becomes a price only when the shop
   * presses the button that saves the product like any other edit.
   */
  pricing: {
    review: (options) => invoke('pricing:review', options),
    advice: (id) => invoke('pricing:advice', id),
    styles: () => invoke('pricing:styles'),
  },

  /** Counting the shelves. The count is saved as it is typed. */
  stocktake: {
    start: (options) => invoke('stocktake:start', options),
    progress: () => invoke('stocktake:progress'),
    count: (itemId, counted) => invoke('stocktake:count', itemId, counted),
    cancel: () => invoke('stocktake:cancel'),
    apply: () => invoke('stocktake:apply'),
  },

  /**
   * Printing. The window names a document and supplies values; the page itself
   * is built on the other side, so no markup crosses the bridge.
   */
  print: {
    pdf: (request) => invoke('print:pdf', request),
  },

  /** The second copy, on a stick or another drive. */
  backup: {
    status: () => invoke('backup:status'),
    /**
     * Whether any movement failed to reach the history, and putting that notice
     * away once somebody has read it. A sale that could not be written down is
     * still a sale that happened.
     */
    historyStatus: () => invoke('backup:history-status'),
    acknowledgeHistory: () => invoke('backup:history-acknowledge'),
    chooseFolder: () => invoke('backup:choose-folder'),
    forgetFolder: () => invoke('backup:forget-folder'),
    now: () => invoke('backup:now'),
  },

  categories: {
    add: (input) => invoke('categories:add', input),
    update: (id, patch) => invoke('categories:update', id, patch),
    remove: (id) => invoke('categories:delete', id),
  },

  fields: {
    add: (input) => invoke('fields:add', input),
    update: (id, patch) => invoke('fields:update', id, patch),
    remove: (id) => invoke('fields:delete', id),
    move: (id, direction) => invoke('fields:move', id, direction),
  },

  settings: {
    update: (patch) => invoke('settings:update', patch),
  },

  /**
   * Signing in, and who may do what.
   *
   * The window is never given a PIN, a salt or a hash — only the answer to
   * "was that right", and the list of capabilities the signed-in role holds.
   */
  auth: {
    state: () => invoke('auth:state'),
    signIn: (pin) => invoke('auth:sign-in', pin),
    signOut: () => invoke('auth:sign-out'),
    createFirstAdmin: (input) => invoke('staff:create-first-admin', input),
    /** Reads the just-minted recovery code once; empty every time after. */
    pendingRecoveryCode: () => invoke('auth:pending-recovery-code'),
    recoveryStatus: () => invoke('auth:recovery-status'),
    recover: (input) => invoke('auth:recover', input),
  },

  staff: {
    list: () => invoke('staff:list'),
    add: (input) => invoke('staff:add', input),
    update: (id, patch) => invoke('staff:update', id, patch),
    remove: (id) => invoke('staff:delete', id),
    newRecoveryCode: () => invoke('staff:new-recovery-code'),
    disable: () => invoke('staff:disable'),
  },

  /**
   * Checking GitHub for a newer MyVault. Three separate steps on purpose —
   * nothing downloads until asked, and nothing installs until asked again.
   */
  updates: {
    status: () => invoke('updates:status'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    install: () => invoke('updates:install'),
    /** Progress arrives on its own; returns an unsubscribe function. */
    onStatus: (handler) => {
      const listener = (_event, status) => handler(status);
      ipcRenderer.on('updates:status', listener);
      return () => ipcRenderer.removeListener('updates:status', listener);
    },
  },

  /**
   * Scales the whole interface, the way Windows' own display scaling does, so
   * the text-size choice stays crisp instead of blurring a zoomed bitmap.
   */
  setZoom: (factor) => {
    const safe = Math.min(1.4, Math.max(0.8, Number(factor) || 1));
    webFrame.setZoomFactor(safe);
    return safe;
  },

  data: {
    exportCsv: () => invoke('data:export-csv'),
    importCsv: () => invoke('data:import-csv'),
    backup: () => invoke('data:backup'),
    restore: () => invoke('data:restore'),
    /** Take over a MyVault data folder that lives somewhere else on this PC. */
    adoptFolder: () => invoke('data:adopt-folder'),
    openFolder: () => invoke('data:open-folder'),
    /** Picks a picture and hands back its bytes; reading it is the UI's job. */
    pickImage: () => invoke('data:pick-image'),
  },

  confirmDelete: (count) => invoke('dialog:confirm-delete', count),

  /** Subscribe to menu actions. Returns an unsubscribe function. */
  onMenu: (handler) => {
    const listeners = menuChannels.map((channel) => {
      const listener = () => handler(channel);
      ipcRenderer.on(channel, listener);
      return { channel, listener };
    });
    return () => listeners.forEach(({ channel, listener }) => {
      ipcRenderer.removeListener(channel, listener);
    });
  },
});
