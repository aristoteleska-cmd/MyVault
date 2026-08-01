'use strict';

/**
 * Local JSON store for MyVault.
 *
 * Everything lives in a single JSON file on the user's own machine. Writes are
 * atomic (temp file + rename) so a crash or power cut can never leave a shop
 * with a half-written inventory, and a rolling set of dated backups is kept
 * next to it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const MAX_BACKUPS = 10;
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // at most one backup per 12h

/**
 * Every item always has these four. Anything beyond them is the shop's own
 * choice, and there is a hard ceiling so the stock list stays readable.
 */
const STANDARD_FIELDS = ['Name', 'Price', 'Quantity', 'Barcode'];
const MAX_CUSTOM_FIELDS = 5;

const FIELD_TYPES = ['text', 'number', 'select', 'date', 'boolean'];

const ACCENTS = ['blue', 'teal', 'green', 'purple', 'orange', 'graphite'];
const DENSITIES = ['comfortable', 'compact'];
const THEMES = ['light', 'dark', 'system'];

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.4;

const DEFAULT_SETTINGS = {
  currency: '€',
  theme: 'system',
  accent: 'blue',
  density: 'comfortable',
  zoom: 1,
  defaultLowStockThreshold: 5,
  shopName: '',
  dateFormat: 'dd/MM/yyyy',
};

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // Accept both "1,50" and "1.50" — shop owners type both.
    const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampMoney(value) {
  const n = toNumber(value, 0);
  return Math.round(Math.max(0, n) * 100) / 100;
}

function clampQuantity(value) {
  const n = toNumber(value, 0);
  return Math.round(n);
}

function asString(value, max = 400) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max);
}

function pickFrom(allowed, value, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Keeps every appearance setting inside the range the UI can actually render. */
function normalizeSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input || {}) };
  settings.theme = pickFrom(THEMES, settings.theme, DEFAULT_SETTINGS.theme);
  settings.accent = pickFrom(ACCENTS, settings.accent, DEFAULT_SETTINGS.accent);
  settings.density = pickFrom(DENSITIES, settings.density, DEFAULT_SETTINGS.density);
  settings.currency = asString(settings.currency, 4) || DEFAULT_SETTINGS.currency;
  settings.shopName = asString(settings.shopName, 80);
  settings.defaultLowStockThreshold = Math.max(0, clampQuantity(settings.defaultLowStockThreshold));

  const zoom = toNumber(settings.zoom, 1);
  settings.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

  return settings;
}

function emptyDatabase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: '',
    createdAt: nowIso(),
    settings: { ...DEFAULT_SETTINGS },
    categories: [
      { id: newId(), name: 'General', color: '#4f7cff' },
    ],
    customFields: [],
    items: [],
  };
}

class Store {
  /**
   * @param {string} dataDir directory that holds myvault.json and backups/
   * @param {string} appVersion the running app version, recorded in the file so
   *   an update can be spotted and a safety copy taken before anything is rewritten
   */
  constructor(dataDir, appVersion = '') {
    this.dataDir = dataDir;
    this.backupDir = path.join(dataDir, 'backups');
    this.file = path.join(dataDir, 'myvault.json');
    this.appVersion = appVersion;
    this.db = emptyDatabase();
    this.lastBackupAt = 0;
  }

  // ---------------------------------------------------------------- lifecycle

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });

    if (!fs.existsSync(this.file)) {
      this.db = emptyDatabase();
      this.db.appVersion = this.appVersion;
      this.persist({ backup: false });
      return this.db;
    }

    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const previousSchema = Number(parsed?.schemaVersion) || 1;
      const previousApp = asString(parsed?.appVersion, 32);

      // An installer replaces the program, never the data. Whenever the file was
      // last written by a different build, keep an untouched copy of it before
      // this version writes anything — that copy is the way back if an update
      // ever goes wrong.
      if (previousSchema !== SCHEMA_VERSION || previousApp !== this.appVersion) {
        this.snapshot(`before-${previousApp || `schema${previousSchema}`}`);
      }

      this.db = this.migrate(parsed);
      this.db.appVersion = this.appVersion;

      if (previousSchema > SCHEMA_VERSION) {
        // Older app, newer file: load it, but make very sure the original survives.
        this.db.downgradedFrom = previousSchema;
      }

      if (previousSchema !== SCHEMA_VERSION || previousApp !== this.appVersion) {
        this.persist({ backup: false });
      }
      return this.db;
    } catch (err) {
      // Never destroy data we failed to understand — park it and start clean.
      const rescue = path.join(
        this.backupDir,
        `unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      );
      try {
        fs.copyFileSync(this.file, rescue);
      } catch { /* best effort */ }
      this.db = emptyDatabase();
      this.db.recoveredFrom = rescue;
      this.persist({ backup: false });
    }
    return this.db;
  }

  migrate(parsed) {
    const db = emptyDatabase();
    if (!parsed || typeof parsed !== 'object') return db;

    db.createdAt = asString(parsed.createdAt) || db.createdAt;
    db.settings = normalizeSettings(parsed.settings);

    db.categories = Array.isArray(parsed.categories)
      ? parsed.categories
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: asString(c.id, 64) || newId(),
            name: asString(c.name, 80) || 'Untitled',
            color: asString(c.color, 20) || '#4f7cff',
          }))
      : db.categories;

    db.customFields = Array.isArray(parsed.customFields)
      ? parsed.customFields
          .filter((f) => f && typeof f === 'object')
          .map((f, index) => ({
            id: asString(f.id, 64) || newId(),
            name: asString(f.name, 60) || 'Field',
            type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
            options: Array.isArray(f.options)
              ? f.options.map((o) => asString(o, 80)).filter(Boolean)
              : [],
            required: Boolean(f.required),
            showInTable: f.showInTable !== false,
            order: Number.isFinite(f.order) ? f.order : index,
          }))
          .sort((a, b) => a.order - b.order)
          // A file written before the ceiling existed (or hand-edited) keeps its
          // first five details rather than being rejected outright.
          .slice(0, MAX_CUSTOM_FIELDS)
          .map((f, index) => ({ ...f, order: index }))
      : [];

    db.items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((i) => i && typeof i === 'object')
          .map((i) => this.normalizeItem(i, db))
      : [];

    return db;
  }

  normalizeItem(input, db = this.db) {
    const categoryIds = new Set(db.categories.map((c) => c.id));
    const fieldIds = new Set(db.customFields.map((f) => f.id));
    const custom = {};
    if (input.custom && typeof input.custom === 'object') {
      for (const [key, value] of Object.entries(input.custom)) {
        if (!fieldIds.has(key)) continue;
        if (typeof value === 'boolean' || typeof value === 'number') {
          custom[key] = value;
        } else {
          custom[key] = asString(value, 200);
        }
      }
    }

    const categoryId = asString(input.categoryId, 64);

    return {
      id: asString(input.id, 64) || newId(),
      name: asString(input.name, 160).trim() || 'Untitled item',
      barcode: asString(input.barcode, 64).trim(),
      sku: asString(input.sku, 64).trim(),
      categoryId: categoryIds.has(categoryId) ? categoryId : '',
      quantity: clampQuantity(input.quantity),
      price: clampMoney(input.price),
      cost: clampMoney(input.cost),
      lowStockThreshold:
        input.lowStockThreshold === null || input.lowStockThreshold === undefined || input.lowStockThreshold === ''
          ? null
          : Math.max(0, clampQuantity(input.lowStockThreshold)),
      supplier: asString(input.supplier, 120).trim(),
      notes: asString(input.notes, 2000),
      custom,
      createdAt: asString(input.createdAt) || nowIso(),
      updatedAt: asString(input.updatedAt) || nowIso(),
    };
  }

  // ------------------------------------------------------------ persistence

  persist({ backup = true } = {}) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const payload = JSON.stringify(this.db, null, 2);
    const tmp = `${this.file}.tmp`;

    if (backup) this.maybeBackup();

    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, this.file);
    return this.db;
  }

  /**
   * An immediate, labelled copy of the current file — used before an update
   * rewrites anything, and before a restore replaces everything.
   */
  snapshot(label) {
    if (!fs.existsSync(this.file)) return null;
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]/g, '');
      const target = path.join(this.backupDir, `myvault-${safeLabel}-${stamp}.json`);
      fs.copyFileSync(this.file, target);
      return target;
    } catch {
      return null;
    }
  }

  maybeBackup() {
    if (!fs.existsSync(this.file)) return;
    const elapsed = Date.now() - this.lastBackupAt;
    if (this.lastBackupAt && elapsed < BACKUP_INTERVAL_MS) return;

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(this.file, path.join(this.backupDir, `myvault-auto-${stamp}.json`));
      this.lastBackupAt = Date.now();
      this.pruneBackups();
    } catch { /* backups are best effort, never block a save */ }
  }

  /**
   * Only the routine timed backups rotate. Labelled snapshots — the copies taken
   * before an app update or a restore — are never rotated away.
   */
  pruneBackups() {
    const entries = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith('myvault-auto-') && f.endsWith('.json'))
      .sort();
    while (entries.length > MAX_BACKUPS) {
      const oldest = entries.shift();
      try {
        fs.unlinkSync(path.join(this.backupDir, oldest));
      } catch { /* ignore */ }
    }
  }

  getState() {
    return this.db;
  }

  // ------------------------------------------------------------------- items

  addItem(input) {
    const item = this.normalizeItem({
      ...input,
      id: newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.db.items.push(item);
    this.persist();
    return item;
  }

  updateItem(id, patch) {
    const index = this.db.items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Item not found');
    const merged = this.normalizeItem({
      ...this.db.items[index],
      ...patch,
      custom: { ...this.db.items[index].custom, ...(patch.custom || {}) },
      id,
      createdAt: this.db.items[index].createdAt,
      updatedAt: nowIso(),
    });
    this.db.items[index] = merged;
    this.persist();
    return merged;
  }

  adjustStock(id, delta) {
    const item = this.db.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    item.quantity = Math.max(0, item.quantity + clampQuantity(delta));
    item.updatedAt = nowIso();
    this.persist();
    return item;
  }

  deleteItems(ids) {
    const set = new Set(ids);
    const removed = this.db.items.filter((i) => set.has(i.id));
    this.db.items = this.db.items.filter((i) => !set.has(i.id));
    this.persist();
    return removed;
  }

  /** Used by the undo action after a delete. */
  restoreItems(items) {
    const existing = new Set(this.db.items.map((i) => i.id));
    const restored = items
      .filter((i) => !existing.has(i.id))
      .map((i) => this.normalizeItem(i));
    this.db.items.push(...restored);
    this.persist();
    return restored;
  }

  // -------------------------------------------------------------- categories

  addCategory({ name, color }) {
    const clean = asString(name, 80).trim();
    if (!clean) throw new Error('Category name is required');
    const duplicate = this.db.categories.find(
      (c) => c.name.toLowerCase() === clean.toLowerCase(),
    );
    if (duplicate) return duplicate;
    const category = { id: newId(), name: clean, color: asString(color, 20) || '#4f7cff' };
    this.db.categories.push(category);
    this.persist();
    return category;
  }

  updateCategory(id, patch) {
    const category = this.db.categories.find((c) => c.id === id);
    if (!category) throw new Error('Category not found');
    if (patch.name !== undefined) {
      const clean = asString(patch.name, 80).trim();
      if (!clean) throw new Error('Category name is required');
      category.name = clean;
    }
    if (patch.color !== undefined) category.color = asString(patch.color, 20);
    this.persist();
    return category;
  }

  deleteCategory(id) {
    this.db.categories = this.db.categories.filter((c) => c.id !== id);
    for (const item of this.db.items) {
      if (item.categoryId === id) item.categoryId = '';
    }
    this.persist();
    return this.db;
  }

  // ------------------------------------------------------------ custom fields

  addField({ name, type, options, required, showInTable }) {
    const clean = asString(name, 60).trim();
    if (!clean) throw new Error('Field name is required');

    // Name clashes are reported before the ceiling: telling someone the detail
    // already exists is more use than telling them they are out of room.
    if (STANDARD_FIELDS.some((standard) => standard.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`"${clean}" is already a standard detail on every item.`);
    }
    if (this.db.customFields.some((f) => f.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`You already have a detail called "${clean}".`);
    }
    if (this.db.customFields.length >= MAX_CUSTOM_FIELDS) {
      throw new Error(
        `You can add up to ${MAX_CUSTOM_FIELDS} extra details. Delete one first to make room.`,
      );
    }

    const field = {
      id: newId(),
      name: clean,
      type: FIELD_TYPES.includes(type) ? type : 'text',
      options: Array.isArray(options) ? options.map((o) => asString(o, 80)).filter(Boolean) : [],
      required: Boolean(required),
      showInTable: showInTable !== false,
      order: this.db.customFields.length,
    };
    this.db.customFields.push(field);
    this.persist();
    return this.db;
  }

  updateField(id, patch) {
    const field = this.db.customFields.find((f) => f.id === id);
    if (!field) throw new Error('Field not found');
    if (patch.name !== undefined) {
      const clean = asString(patch.name, 60).trim();
      if (!clean) throw new Error('Field name is required');
      field.name = clean;
    }
    if (patch.type !== undefined && FIELD_TYPES.includes(patch.type)) field.type = patch.type;
    if (patch.options !== undefined) {
      field.options = Array.isArray(patch.options)
        ? patch.options.map((o) => asString(o, 80)).filter(Boolean)
        : [];
    }
    if (patch.required !== undefined) field.required = Boolean(patch.required);
    if (patch.showInTable !== undefined) field.showInTable = Boolean(patch.showInTable);
    this.persist();
    return this.db;
  }

  deleteField(id) {
    this.db.customFields = this.db.customFields.filter((f) => f.id !== id);
    this.db.customFields.forEach((f, index) => { f.order = index; });
    for (const item of this.db.items) {
      if (item.custom && id in item.custom) delete item.custom[id];
    }
    this.persist();
    return this.db;
  }

  moveField(id, direction) {
    const fields = this.db.customFields;
    const index = fields.findIndex((f) => f.id === id);
    if (index === -1) return this.db;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= fields.length) return this.db;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    fields.forEach((f, i) => { f.order = i; });
    this.persist();
    return this.db;
  }

  // ----------------------------------------------------------------- settings

  updateSettings(patch) {
    this.db.settings = normalizeSettings({ ...this.db.settings, ...patch });
    this.persist();
    return this.db.settings;
  }

  // ------------------------------------------------------------ bulk transfer

  replaceAll(parsed) {
    this.db = this.migrate(parsed);
    this.persist();
    return this.db;
  }

  /**
   * Import rows coming from a CSV. Unknown columns become custom fields so a
   * shop can bring a spreadsheet across without losing its own columns.
   */
  importRows(rows, { createMissing = true } = {}) {
    const result = {
      added: 0, updated: 0, skipped: 0, newCategories: 0, newFields: 0,
      /** Columns that could not become details because the ceiling was reached. */
      droppedColumns: [],
    };
    const core = new Set([
      'name', 'barcode', 'sku', 'category', 'quantity', 'price', 'cost',
      'low stock', 'lowstock', 'low stock threshold', 'supplier', 'notes',
    ]);

    const categoryByName = new Map(
      this.db.categories.map((c) => [c.name.toLowerCase(), c]),
    );
    const fieldByName = new Map(
      this.db.customFields.map((f) => [f.name.toLowerCase(), f]),
    );
    const itemByBarcode = new Map(
      this.db.items.filter((i) => i.barcode).map((i) => [i.barcode, i]),
    );

    for (const row of rows) {
      const lower = {};
      for (const [key, value] of Object.entries(row)) {
        lower[String(key).trim().toLowerCase()] = value;
      }

      const name = asString(lower.name, 160).trim();
      if (!name) { result.skipped += 1; continue; }

      // Category
      let categoryId = '';
      const categoryName = asString(lower.category, 80).trim();
      if (categoryName) {
        let category = categoryByName.get(categoryName.toLowerCase());
        if (!category && createMissing) {
          category = { id: newId(), name: categoryName, color: '#4f7cff' };
          this.db.categories.push(category);
          categoryByName.set(categoryName.toLowerCase(), category);
          result.newCategories += 1;
        }
        if (category) categoryId = category.id;
      }

      // Custom columns
      const custom = {};
      for (const [key, value] of Object.entries(lower)) {
        if (core.has(key) || !key) continue;
        if (value === '' || value === null || value === undefined) continue;
        let field = fieldByName.get(key);
        if (!field && createMissing && this.db.customFields.length >= MAX_CUSTOM_FIELDS) {
          // Out of detail slots — import the row, just without this column.
          if (!result.droppedColumns.includes(key)) result.droppedColumns.push(key);
          continue;
        }
        if (!field && createMissing) {
          field = {
            id: newId(),
            name: key.replace(/\b\w/g, (m) => m.toUpperCase()),
            type: 'text',
            options: [],
            required: false,
            showInTable: true,
            order: this.db.customFields.length,
          };
          this.db.customFields.push(field);
          fieldByName.set(key, field);
          result.newFields += 1;
        }
        if (field) custom[field.id] = asString(value, 200);
      }

      const lowStockRaw = lower['low stock threshold'] ?? lower['low stock'] ?? lower.lowstock;
      const payload = {
        name,
        barcode: asString(lower.barcode, 64).trim(),
        sku: asString(lower.sku, 64).trim(),
        categoryId,
        quantity: clampQuantity(lower.quantity),
        price: clampMoney(lower.price),
        cost: clampMoney(lower.cost),
        lowStockThreshold:
          lowStockRaw === '' || lowStockRaw === undefined || lowStockRaw === null
            ? null
            : Math.max(0, clampQuantity(lowStockRaw)),
        supplier: asString(lower.supplier, 120).trim(),
        notes: asString(lower.notes, 2000),
        custom,
      };

      const existing = payload.barcode ? itemByBarcode.get(payload.barcode) : null;
      if (existing) {
        const index = this.db.items.findIndex((i) => i.id === existing.id);
        this.db.items[index] = this.normalizeItem({
          ...existing,
          ...payload,
          custom: { ...existing.custom, ...custom },
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nowIso(),
        });
        result.updated += 1;
      } else {
        const item = this.normalizeItem({
          ...payload,
          id: newId(),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        this.db.items.push(item);
        if (item.barcode) itemByBarcode.set(item.barcode, item);
        result.added += 1;
      }
    }

    this.persist();
    return result;
  }
}

module.exports = {
  Store,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  FIELD_TYPES,
  STANDARD_FIELDS,
  MAX_CUSTOM_FIELDS,
  ACCENTS,
  DENSITIES,
  emptyDatabase,
};
