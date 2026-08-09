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
    adjust: (id, delta) => invoke('items:adjust', id, delta),
    remove: (ids) => invoke('items:delete', ids),
    restore: (items) => invoke('items:restore', items),
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
