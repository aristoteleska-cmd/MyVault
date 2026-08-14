'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

/**
 * The only bridge between the UI and the file system. The renderer gets a small
 * fixed list of operations — it can never touch Node or the disk directly.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const menuChannels = [
  'menu:new-item',
  'menu:import-csv',
  'menu:export-csv',
  'menu:backup',
  'menu:restore',
  'menu:focus-search',
];

contextBridge.exposeInMainWorld('myvault', {
  getInfo: () => invoke('app:info'),
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

  /** What the shop owes the tax office, and for which calendar period. */
  vat: {
    report: (range) => invoke('vat:report', range),
    periods: () => invoke('vat:periods'),
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
