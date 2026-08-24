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

const {
  ROLES, hashPin, verifyPin, isValidPin,
  generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode,
} = require('./roles');
const { MovementLog } = require('./movements');
const { writeFileDurably } = require('./durable');
const { normalizeRate, rateFor } = require('./vat');
const {
  KINDS, DocumentLog, normalizeLine, unitAfterDiscount, totalsFor, emptyDraft,
} = require('./documents');
const { ROUNDING_STYLES } = require('./pricing');

const SCHEMA_VERSION = 3;
const MAX_BACKUPS = 10;

/** How many suppliers' codes one product may carry. A shop has a few, not fifty. */
const MAX_SUPPLIER_CODES = 12;

/**
 * How far a price has to move before a delivery is worth mentioning it, in
 * per cent. Matches the threshold the pricing advice uses, so a shop is not told
 * one thing while reading an invoice and another thing after posting it.
 */
const COST_CHANGE_THRESHOLD = 5;

/**
 * How many read files one draft remembers, so the same paper is not read twice.
 *
 * An invoice occasionally arrives as one PDF per page, and a shop reading four
 * of them onto one delivery is doing the right thing. Twelve is far past that
 * and far short of a list worth worrying about the size of.
 */
const MAX_DRAFT_SOURCES = 12;

/**
 * Where the second drive keeps the list of copies MyVault wrote there.
 *
 * The rolling window prunes from this list and from nothing else, so a shop's
 * own backups can sit in the same folder and be perfectly safe.
 */
const MIRROR_LEDGER = '.myvault-mirror.json';

/**
 * One supplier's name, reduced to something two spellings of it agree on.
 *
 * "ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ Α.Ε." and "ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ ΑΕ" are the same wholesaler
 * and would otherwise remember their codes twice over.
 */
const supplierKey = (name) => String(name || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .slice(0, 60);

/**
 * Up to this many products the data file is written indented, so a shop can
 * open it and read it. Beyond it the indentation is roughly half the bytes, and
 * every sale rewrites the file, so readability gives way to speed.
 */
const READABLE_UP_TO = 2000;
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // at most one backup per 12h

/**
 * Every item always has these four. Anything beyond them is the shop's own
 * choice, and there is a hard ceiling so the stock list stays readable.
 *
 * Only the name is ever mandatory — every other box, standard or custom, can be
 * left empty so a half-known product can be saved now and finished later.
 */
const STANDARD_FIELDS = ['Name', 'Price', 'Quantity', 'Barcode'];
const MAX_CUSTOM_FIELDS = 5;

const FIELD_TYPES = ['text', 'number', 'select', 'date', 'boolean'];

const ACCENTS = ['blue', 'teal', 'green', 'purple', 'orange', 'graphite'];
const DENSITIES = ['comfortable', 'compact'];
const THEMES = ['light', 'dark', 'system'];
const UPDATE_MODES = ['off', 'check', 'auto'];

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.4;

const DEFAULT_SETTINGS = {
  currency: '€',
  /** Empty means "follow the language chosen at install / used by Windows". */
  language: '',
  theme: 'system',
  accent: 'blue',
  density: 'comfortable',
  zoom: 1,
  defaultLowStockThreshold: 5,
  shopName: '',
  dateFormat: 'dd/MM/yyyy',
  /**
   * A second place to keep backups — ideally a USB stick or another drive.
   *
   * Empty by default, because MyVault must not write to somewhere the shop did
   * not choose. Every backup taken is mirrored here as well, so the copy that
   * matters is not on the same disk as the thing it is protecting.
   */
  backupFolder: '',

  /**
   * VAT, off until a shop turns it on.
   *
   * Most one-person shops using this instead of a notebook do not want a tax
   * column in the way, and a VAT feature that cannot be switched off would be
   * clutter for them. A shop that does need it turns it on once.
   */
  vatEnabled: false,
  /** The rate most of the shop sells at. Individual products can differ. */
  vatRate: 24,
  /**
   * Whether the price on the shelf already contains VAT. In a retail shop it
   * does — that is what the customer hands over — so this is the default.
   */
  pricesIncludeVat: true,
  /**
   * Whether the cost price entered is what the supplier invoiced before VAT.
   * Invoices are usually net, so this is off by default.
   */
  costsIncludeVat: false,

  /**
   * The margin the shop wants to make, as a percentage of the price it charges.
   *
   * Zero means "not set", and that is the default on purpose. A number invented
   * here would flag half a shop's catalogue as underpriced on the first morning,
   * which teaches the shop to ignore the screen. Until they say what they are
   * aiming for, MyVault only reports what changed and what it used to be.
   */
  targetMargin: 0,
  /**
   * How a suggested price should be rounded off — 2,3871 is arithmetic, not a
   * price. Which ending suits depends on what the shop sells, so it is theirs
   * to choose. Five cents is the least surprising default.
   */
  priceRounding: 'nearest05',

  /**
   * Off unless the shop turns it on. MyVault is handed over as a program that
   * does not use the internet, so the setting that would change that has to be
   * a deliberate choice, not something inherited from a default.
   *
   *   off    nothing, ever. Not one request.
   *   check  look on opening and once a day, then say so and wait to be told.
   *   auto   look, fetch quietly, and install when MyVault is next closed.
   */
  updates: 'off',
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
  settings.language = asString(settings.language, 12);
  settings.shopName = asString(settings.shopName, 80);
  settings.backupFolder = asString(settings.backupFolder, 400).trim();

  settings.vatEnabled = Boolean(settings.vatEnabled);
  settings.vatRate = normalizeRate(settings.vatRate) ?? DEFAULT_SETTINGS.vatRate;
  settings.pricesIncludeVat = settings.pricesIncludeVat !== false;
  settings.costsIncludeVat = Boolean(settings.costsIncludeVat);
  settings.defaultLowStockThreshold = Math.max(0, clampQuantity(settings.defaultLowStockThreshold));

  // A target of 100% or more is not reachable at any price, so it is clamped to
  // something a price can actually be worked out from.
  const margin = toNumber(settings.targetMargin, 0);
  settings.targetMargin = Math.min(95, Math.max(0, Math.round(margin * 10) / 10));
  settings.priceRounding = pickFrom(ROUNDING_STYLES, settings.priceRounding, 'nearest05');

  // 1.1.0 stored this as a plain on/off. An old file saying true meant "look for
  // updates and tell me", which is what "check" is now; anything unrecognised,
  // including a truthy string in a hand-edited file, falls back to off. Nothing
  // but a stored, known value puts a shop on the network.
  if (settings.updates === true) settings.updates = 'check';
  else if (settings.updates === false) settings.updates = 'off';
  settings.updates = pickFrom(UPDATE_MODES, settings.updates, 'off');

  const zoom = toNumber(settings.zoom, 1);
  settings.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

  return settings;
}

/**
 * The time in a backup's filename, down to the millisecond.
 *
 * Seconds were not enough. Two copies taken in the same second — a snapshot
 * before a restore and the routine one the same save triggers — produced the
 * same name, and the second silently overwrote the first. Rare, and precisely
 * the kind of rare that happens on the one day the older copy was the one worth
 * keeping.
 */
let lastStamp = '';
let stampRun = 0;

function backupStamp() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  // Two copies in the same millisecond are unlikely and not impossible — a save
  // that snapshots and then backs up does both in one breath. A name that is
  // already taken is nudged rather than written over.
  if (stamp === lastStamp) {
    stampRun += 1;
    return `${stamp}-${stampRun}`;
  }
  lastStamp = stamp;
  stampRun = 0;
  return stamp;
}

function emptyDatabase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: '',
    createdAt: nowIso(),
    // When the last routine backup was taken. Kept in the file so the rolling
    // window is twelve hours of wall clock rather than twelve hours of the
    // program happening to be open.
    lastBackupAt: 0,
    settings: { ...DEFAULT_SETTINGS },
    // Empty means nobody has set up staff roles, and MyVault behaves as it
    // always did: one person, full access. See ./roles.js.
    users: [],
    // The way back in when every PIN has been forgotten. Only ever the hash of
    // the code — the code itself is shown once, on paper, and never kept.
    recovery: null,
    categories: [
      { id: newId(), name: 'General', color: '#4f7cff' },
    ],
    customFields: [],
    // Regulars the shop wants to keep track of. What each one bought is not
    // stored here — it is worked out from the movement log, so the contact list
    // stays a contact list however many years of sales pile up behind it.
    clients: [],
    /**
     * The people the shop buys from.
     *
     * Only who they are — a name, a phone number, their tax number. What they
     * have sent is not copied in here: it is already written, once and for
     * good, in the invoice files, and a second copy would be a second version
     * of the truth that could disagree with the first. A supplier appears in
     * this list the moment a delivery is posted in their name, so a shop that
     * never opens the screen still ends up with a complete book of who supplies
     * it.
     */
    suppliers: [],
    // A count in progress, or null. Counting a shop takes hours and gets
    // interrupted by customers; this is saved so closing MyVault half way
    // through does not throw the morning away.
    stockTake: null,
    // Invoices being typed right now. Normally none or one; a posted invoice
    // is history and lives in its own file rather than here.
    drafts: [],
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
    /** How the last copy to the shop's second location went. */
    this.lastMirror = null;

    /**
     * The history of what moved, kept in its own append-only files.
     *
     * Deliberately not part of `this.db`: everything in there is rewritten on
     * every save, and a record that only ever grows would make each sale cost
     * more than the one before it. See ./movements.js.
     */
    this.movements = new MovementLog(dataDir);

    /**
     * Posted invoices and delivery notes, kept the same way and for the same
     * reason: they only ever accumulate. See ./documents.js.
     */
    this.documents = new DocumentLog(dataDir);

    /**
     * Which invoices a reversal names, once it has been asked for. Null means
     * nobody has asked yet, or that something was written to the log since the
     * last answer. See reversedDocuments.
     */
    this.reversedIds = null;
  }

  /**
   * Writes a movement, and never lets a failure to do so lose a sale.
   *
   * The stock count is the thing the shop cannot afford to get wrong; the
   * history is how they look back on it. If the history file cannot be written —
   * a full disk, a folder someone has locked — the stock change still stands.
   *
   * But it is written down that it happened. Swallowing it meant a shop could
   * trade all day onto a full disk and see nothing wrong: stock counts moving
   * normally, takings at zero, an empty VAT return at the end of the quarter and
   * no way left to reconstruct the day. The sale still goes through — refusing
   * it would be worse — and the shop is told, on this launch and on every launch
   * after it, until the history can be written again.
   */
  logMovement(entry) {
    try {
      const written = this.movements.record(entry);
      if (this.historyTrouble) {
        // It works again. Say so, but keep the count: a shop that lost an hour
        // of history this morning needs to know that, not to have the notice
        // disappear the moment the disk was emptied.
        this.historyTrouble = { ...this.historyTrouble, writing: true, recoveredAt: nowIso() };
      }
      return written;
    } catch (error) {
      const trouble = this.historyTrouble && !this.historyTrouble.writing
        ? this.historyTrouble
        : { lost: 0, since: nowIso(), message: '' };
      this.historyTrouble = {
        lost: trouble.lost + 1,
        since: trouble.since,
        message: error?.message || String(error),
        writing: false,
        recoveredAt: '',
      };
      // Remembered across launches as well, because the shop may well close the
      // program before anybody looks at the screen.
      this.db.historyTrouble = this.historyTrouble;
      try { this.persist({ backup: false }); } catch { /* the disk is the problem */ }
      console.error('MyVault could not write to the sales history:', this.historyTrouble.message);
      return null;
    }
  }

  /** What the shop is told about the health of its own history. */
  historyStatus() {
    const trouble = this.historyTrouble || this.db.historyTrouble || null;
    if (!trouble || !trouble.lost) return null;
    return { ...trouble };
  }

  /**
   * Whether the history on this disk can still be read from end to end.
   *
   * The mechanism above reports movements that could not be WRITTEN. This is
   * the other half, and until now there was no other half: both logs already
   * counted the lines they had to skip and the years they could not open, and
   * threw the count away. So a shop whose 2024 invoice file was truncated by a
   * power cut — or left behind by a half-copied backup — had a VAT return that
   * was quietly short by a year, on a screen that looked perfectly healthy.
   *
   * Reading everything is the only way to know, which is why this is not run at
   * startup: it is asked for from Settings, next to the other thing that tells
   * a shop the truth about its own records.
   */
  historyIntegrity() {
    const look = (log) => {
      const seen = log.forEach({}, () => {});
      return {
        scanned: seen.scanned || 0,
        skipped: seen.skipped || 0,
        unreadable: seen.unreadable || [],
      };
    };

    const movements = look(this.movements);
    const invoices = look(this.documents);

    return {
      movements,
      invoices,
      /** True when everything on the disk was read without a gap. */
      whole: movements.skipped === 0 && invoices.skipped === 0
        && movements.unreadable.length === 0 && invoices.unreadable.length === 0,
      lines: movements.skipped + invoices.skipped,
      years: [...new Set([...movements.unreadable, ...invoices.unreadable])].sort(),
    };
  }

  /**
   * Marks the trouble as seen, once the shop has been told.
   *
   * Clearing it is a decision the person makes, not something the program does
   * for them the moment writing works again — the movements that were lost are
   * still lost, and the notice is how anybody finds out.
   */
  clearHistoryTrouble() {
    this.historyTrouble = null;
    delete this.db.historyTrouble;
    this.persist({ backup: false });
    return null;
  }

  /**
   * The VAT rate that applies to a product right now.
   *
   * Written into every movement, so a shop that changes a rate — or switches
   * VAT on for the first time — never has last year's return rewritten
   * underneath it. Exactly the same principle as copying in the price.
   */
  vatRateFor(item) {
    return rateFor(item, this.db.settings);
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
      this.lastBackupAt = this.db.lastBackupAt || 0;
      // A history that could not be written stays reported across launches, so
      // the count picks up where the last sitting left it rather than at nought.
      this.historyTrouble = this.db.historyTrouble || null;

      if (previousSchema > SCHEMA_VERSION) {
        // Older app, newer file: load it, but make very sure the original survives.
        this.db.downgradedFrom = previousSchema;
      }

      if (previousSchema !== SCHEMA_VERSION || previousApp !== this.appVersion) {
        this.persist({ backup: false });
      }
      return this.db;
    } catch (err) {
      // Never destroy data we failed to understand — park it, then put back the
      // most recent copy that can be read.
      //
      // Starting clean was the old behaviour and it was the wrong one. A shop
      // whose file is truncated by a power cut at the till opened MyVault to an
      // empty catalogue, and the backups sitting in the folder next to it — one
      // of them from that morning — were never looked at. The unreadable file
      // was kept, so nothing was destroyed, but "your data is in a folder, find
      // somebody who can read JSON" is not an answer a shop can use.
      const rescue = path.join(
        this.backupDir,
        `unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      );
      try {
        fs.copyFileSync(this.file, rescue);
      } catch { /* best effort */ }

      const recovered = this.newestReadableBackup();
      this.db = recovered ? this.migrate(recovered.parsed) : emptyDatabase();
      this.db.appVersion = this.appVersion;
      this.db.recoveredFrom = rescue;
      if (recovered) {
        // What the shop is told: which copy they are looking at, when it was
        // taken, and that anything after it has to be entered again. Silence
        // here would be worse than the fault — a shop must never be handed
        // yesterday's stock without being told that is what it is.
        this.db.recoveredBackup = {
          path: recovered.path,
          at: recovered.at,
          items: Array.isArray(this.db.items) ? this.db.items.length : 0,
        };
      }
      this.persist({ backup: false });
    }
    return this.db;
  }

  /**
   * The newest backup in the folder that actually parses.
   *
   * Newest first, and each one is tried in turn: whatever corrupted the live
   * file may well have caught the copy taken closest to it, and the second
   * newest is still far better than nothing. A backup with no items array is
   * not a MyVault file and is passed over rather than loaded as an empty shop.
   *
   * The sales history is not in these files and does not need to be — it lives
   * in its own append-only folders, which this never touches. A rescue restores
   * the catalogue; the takings were never lost.
   */
  newestReadableBackup() {
    let candidates;
    try {
      // By the time on the file rather than the name. The names carry two
      // different stamps — the timed copies and the ones labelled before an
      // update — and sorting those as text puts "before-1.9.0" after
      // "auto-2026-08-18" for no better reason than the alphabet.
      candidates = fs.readdirSync(this.backupDir)
        .filter((name) => name.startsWith('myvault-') && name.endsWith('.json'))
        .map((name) => {
          const full = path.join(this.backupDir, name);
          try { return { full, at: fs.statSync(full).mtimeMs }; } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.at - a.at);
    } catch {
      return null;
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate.full, 'utf8'));
        if (!parsed || !Array.isArray(parsed.items)) continue;
        return { path: candidate.full, parsed, at: new Date(candidate.at).toISOString() };
      } catch { /* try the one before it */ }
    }
    return null;
  }

  migrate(parsed) {
    const db = emptyDatabase();
    if (!parsed || typeof parsed !== 'object') return db;

    db.createdAt = asString(parsed.createdAt) || db.createdAt;
    db.settings = normalizeSettings(parsed.settings);

    db.users = Array.isArray(parsed.users)
      ? parsed.users
          .filter((u) => u && typeof u === 'object')
          .map((u) => ({
            id: asString(u.id, 64) || newId(),
            name: asString(u.name, 60) || 'Staff',
            role: ROLES.includes(u.role) ? u.role : 'junior',
            salt: asString(u.salt, 64),
            hash: asString(u.hash, 128),
            createdAt: asString(u.createdAt) || nowIso(),
          }))
          // A staff member with no usable PIN could never sign in, and would
          // sit there looking like a way in. A file hand-edited down to that
          // state is treated as not having them.
          .filter((u) => u.salt && u.hash)
      : [];

    // An admin is the only role that can put things right, so a list that has
    // somehow lost its last one is not a list worth honouring — better to fall
    // back to the unlocked state than to leave the shop shut out of its stock.
    if (db.users.length && !db.users.some((u) => u.role === 'admin')) {
      db.users = [];
    }

    db.recovery = parsed.recovery && typeof parsed.recovery === 'object'
      && asString(parsed.recovery.salt, 64) && asString(parsed.recovery.hash, 128)
      ? {
        salt: asString(parsed.recovery.salt, 64),
        hash: asString(parsed.recovery.hash, 128),
        createdAt: asString(parsed.recovery.createdAt) || nowIso(),
      }
      : null;

    db.categories = Array.isArray(parsed.categories)
      ? parsed.categories
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: asString(c.id, 64) || newId(),
            name: asString(c.name, 80) || 'Untitled',
            color: asString(c.color, 20) || '#4f7cff',
          }))
      : db.categories;

    db.clients = Array.isArray(parsed.clients)
      ? parsed.clients
          .filter((c) => c && typeof c === 'object')
          .map((c) => this.normalizeClient(c))
      : [];

    db.suppliers = Array.isArray(parsed.suppliers)
      ? parsed.suppliers
          .filter((s) => s && typeof s === 'object')
          .map((s) => this.normalizeSupplier(s))
          .filter((s) => s.name)
      : [];

    // A count in progress survives a restart. Anything malformed is dropped
    // rather than half-restored: a stock take is worth redoing, and a
    // half-understood one would silently correct the wrong products.
    db.stockTake = parsed.stockTake && typeof parsed.stockTake === 'object'
      && parsed.stockTake.counts && typeof parsed.stockTake.counts === 'object'
      ? {
        startedAt: asString(parsed.stockTake.startedAt) || nowIso(),
        by: asString(parsed.stockTake.by, 60),
        categoryId: asString(parsed.stockTake.categoryId, 64),
        counts: Object.fromEntries(
          Object.entries(parsed.stockTake.counts)
            .filter(([, value]) => Number.isFinite(Number(value)))
            .map(([key, value]) => [asString(key, 64), Math.max(0, clampQuantity(value))]),
        ),
      }
      : null;

    db.drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts
          .filter((d) => d && typeof d === 'object' && Array.isArray(d.lines))
          .map((d) => ({
            ...emptyDraft({ kind: d.kind }),
            id: asString(d.id, 64) || newId(),
            kind: KINDS.includes(d.kind) ? d.kind : 'in',
            number: asString(d.number, 60),
            supplier: asString(d.supplier, 120),
            clientId: asString(d.clientId, 64),
            date: asString(d.date, 10),
            note: asString(d.note, 2000),
            startedAt: asString(d.startedAt) || nowIso(),
            by: asString(d.by, 60),
            lines: d.lines
              .map((line) => normalizeLine(line, { kind: d.kind }))
              .filter(Boolean),
          }))
      : [];

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

    // When the last routine backup was taken, in wall-clock time.
    //
    // This used to live only in memory, which made the twelve-hour window mean
    // "twelve hours of MyVault being open". A shop that opens the program at
    // eight and closes it at seven took a backup every single morning and never
    // knew the window existed; one that reopens it a dozen times a day took a
    // dozen, and the ten kept copies covered a day and a half instead of the
    // weeks a rolling window is for.
    db.lastBackupAt = Number.isFinite(parsed.lastBackupAt) && parsed.lastBackupAt > 0
      ? parsed.lastBackupAt
      : 0;

    // A history that could not be written stays reported until somebody clears
    // it, which means surviving the restart that follows the disk being emptied.
    if (parsed.historyTrouble && typeof parsed.historyTrouble === 'object') {
      const lost = Number(parsed.historyTrouble.lost);
      if (Number.isFinite(lost) && lost > 0) {
        db.historyTrouble = {
          lost: Math.min(lost, Number.MAX_SAFE_INTEGER),
          since: asString(parsed.historyTrouble.since, 40),
          message: asString(parsed.historyTrouble.message, 300),
          writing: Boolean(parsed.historyTrouble.writing),
          recoveredAt: asString(parsed.historyTrouble.recoveredAt, 40),
        };
      }
    }

    return db;
  }

  /**
   * A customer the shop wants to be able to look up.
   *
   * Only the name is asked for. A shop that writes down "Maria, the one with the
   * green van" and nothing else should not be stopped, and a phone number is not
   * validated because half of them will be written as "call the shop".
   */
  normalizeClient(input) {
    return {
      id: asString(input.id, 64) || newId(),
      name: asString(input.name, 120).trim() || 'Unnamed customer',
      phone: asString(input.phone, 40).trim(),
      email: asString(input.email, 120).trim(),
      address: asString(input.address, 300).trim(),
      notes: asString(input.notes, 2000),
      createdAt: asString(input.createdAt) || nowIso(),
      updatedAt: asString(input.updatedAt) || nowIso(),
    };
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
      /**
       * A thing the shop does rather than a thing it has: fitting, delivery, an
       * hour's labour, a repair.
       *
       * Half the lines on a real Greek invoice are often these, and billing one
       * used to take stock off a shelf that was never there — so the count went
       * to zero, the product looked out of stock, and the order list asked the
       * shop to buy more of its own labour. A service carries a price and a VAT
       * rate like anything else, and carries no quantity at all.
       */
      service: Boolean(input.service),
      // Nothing is ever on the shelf, so the count is not the shop's to set.
      quantity: input.service ? 0 : clampQuantity(input.quantity),
      price: clampMoney(input.price),
      cost: clampMoney(input.cost),
      lowStockThreshold:
        input.lowStockThreshold === null || input.lowStockThreshold === undefined || input.lowStockThreshold === ''
          ? null
          : Math.max(0, clampQuantity(input.lowStockThreshold)),
      supplier: asString(input.supplier, 120).trim(),
      /**
       * What this shop's suppliers call this product on their own invoices.
       *
       * A wholesaler's invoice names a product by their code — 558, NG-4410 —
       * which is nothing like a barcode and rarely matches the name on the
       * shelf. Remembered the first time a person resolves it, so the next
       * invoice from that supplier matches on sight instead of arriving as a
       * list of things the shop apparently does not stock.
       *
       * Kept on the product rather than in a table of its own: deleting the
       * product should take its aliases with it, and a backup should carry them
       * without anything extra being thought about.
       */
      supplierCodes: Array.isArray(input.supplierCodes)
        ? input.supplierCodes
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              supplier: asString(entry.supplier, 120).trim(),
              code: asString(entry.code, 64).trim(),
            }))
            .filter((entry) => entry.code)
            .slice(0, MAX_SUPPLIER_CODES)
        : [],
      // Null means "whatever the shop's default is", exactly like the low
      // stock limit above it. A shop selling mostly books at 6% sets the
      // default once and overrides the few things that differ.
      vatRate: normalizeRate(input.vatRate),
      notes: asString(input.notes, 2000),
      custom,
      createdAt: asString(input.createdAt) || nowIso(),
      updatedAt: asString(input.updatedAt) || nowIso(),
    };
  }

  // ------------------------------------------------------------ persistence

  /**
   * Writes the whole inventory out, atomically.
   *
   * The cost of this grows with the size of the shop, which is why the movement
   * history is deliberately somewhere else — see ./movements.js. What is left
   * here is the catalogue, and a catalogue is bounded by how much a shop
   * actually sells.
   *
   * Small shops get an indented file they could open in Notepad and read, which
   * is part of the promise that the data is theirs. Past a few thousand
   * products the indentation is most of the file and nobody is reading it by
   * eye anyway, so it is dropped — which halves what has to be written on every
   * single sale.
   */
  persist({ backup = true } = {}) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;

    // Before the payload is built, not after: taking a backup records when it
    // was taken, and that has to be in the file this save is about to write or
    // the window would restart at nought on the next launch.
    if (backup) this.maybeBackup();

    const readable = this.db.items.length <= READABLE_UP_TO;
    const payload = JSON.stringify(this.db, null, readable ? 2 : 0);

    // Written, flushed, renamed, and the rename flushed too. See ./durable.js:
    // the rename was always atomic, but a rename can reach the disk before the
    // bytes it points at, which is how a power cut leaves a file of the right
    // name and the wrong length.
    writeFileDurably(this.file, payload);
    void tmp;
    return this.db;
  }

  /**
   * Everything the shop has, in one object.
   *
   * The catalogue lives in myvault.json; the sales history and the posted
   * invoices deliberately do not — they are append-only files per year, which is
   * what makes a tenth year cost nothing to carry. That split was invisible
   * until you tried to move a shop to another PC, because "Backup all data"
   * copied one file and quietly left the other two behind. The catalogue came
   * back perfectly and every sale, every takings figure and every VAT input was
   * gone, which is worse than an obvious failure: the restore looked like it
   * worked.
   *
   * So a backup is the whole data directory. The logs travel as their own text
   * rather than parsed rows, so a torn line survives the round trip exactly as
   * it is on disk and is skipped on reading the same way it always was.
   */
  exportAll() {
    const logs = { movements: {}, invoices: {} };
    const collect = (log, into) => {
      for (const year of log.years()) {
        try {
          into[String(year)] = fs.readFileSync(log.fileFor(year), 'utf8');
        } catch { /* a year that cannot be read is reported by being absent */ }
      }
    };
    collect(this.movements, logs.movements);
    collect(this.documents, logs.invoices);

    return {
      ...this.db,
      /** Present only in a backup file. Never written into myvault.json. */
      logs,
      backupOf: this.appVersion || '',
      backupAt: nowIso(),
    };
  }

  /**
   * Puts a whole shop back, history included.
   *
   * The catalogue goes through replaceAll — the same validation any loaded file
   * gets — and the logs are written as whole years. Whole years is the right
   * unit: they are append-only, so a year is either the one being written now or
   * finished and unchanging, and replacing one wholesale cannot interleave a
   * restored line with a live one.
   *
   * A backup written before this existed has no logs at all. That restores the
   * catalogue and says how many years of history it could not bring, rather than
   * pretending the shop has none.
   */
  importAll(parsed) {
    const logs = parsed?.logs && typeof parsed.logs === 'object' ? parsed.logs : null;
    const database = { ...parsed };
    delete database.logs;
    delete database.backupOf;
    delete database.backupAt;

    this.replaceAll(database);

    const restore = (log, years) => {
      let written = 0;
      if (!years || typeof years !== 'object') return written;
      fs.mkdirSync(log.dir, { recursive: true });
      for (const [year, text] of Object.entries(years)) {
        // The year is used to build a path, so it may only ever be four digits.
        if (!/^\d{4}$/.test(year) || typeof text !== 'string') continue;
        fs.writeFileSync(log.fileFor(Number(year)), text, 'utf8');
        written += 1;
      }
      return written;
    };

    const movementYears = restore(this.movements, logs?.movements);
    const invoiceYears = restore(this.documents, logs?.invoices);
    // Whole years of invoices have just been written underneath it, reversals
    // and all, so whatever the cache last worked out describes a shop that no
    // longer exists.
    this.reversedIds = null;

    return {
      movementYears,
      invoiceYears,
      /** True for a backup taken before backups carried the history. */
      withoutHistory: logs === null,
    };
  }

  /**
   * Takes over a MyVault data folder that is sitting somewhere else.
   *
   * This exists because of a real morning. A shop runs the portable copy off a
   * stick for a while, then installs MyVault properly — and the installed copy
   * keeps its data in the Windows app-data folder while a year of stock sits in
   * MyVault-Data beside the old .exe. Nothing is lost and nothing is broken, but
   * the shop opens the program and sees an empty catalogue, which is
   * indistinguishable from having lost everything.
   *
   * Rather than explaining app-data folders to a shopkeeper, this points MyVault
   * at the folder they still have: their myvault.json, and the history and
   * invoices folders beside it, become this copy's own. A safety copy of
   * whatever is here now is taken first, so pointing it at the wrong folder is
   * undoable.
   *
   * The same route recovers a folder off a backup drive, or one copied from an
   * old PC, without needing a backup file to have been made at all.
   */
  adoptFolder(folder) {
    const file = path.join(folder, 'myvault.json');
    if (!fs.existsSync(file)) {
      throw new Error(
        'There is no myvault.json in that folder, so it is not a MyVault data '
        + 'folder. Look for a folder called MyVault-Data next to the program, or '
        + 'the "data" folder inside MyVault in your app data.',
      );
    }
    if (path.resolve(folder) === path.resolve(this.dataDir)) {
      throw new Error('That is the folder MyVault is already using.');
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error('That folder has a myvault.json, but it could not be read.');
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('That myvault.json does not look like a MyVault shop.');
    }

    // The history and the invoices are whole years of text, read the same way a
    // backup carries them — so one path puts a shop back, however it arrived.
    const logs = { movements: {}, invoices: {} };
    const collect = (dirName, pattern, into) => {
      let names;
      try {
        names = fs.readdirSync(path.join(folder, dirName));
      } catch {
        return;
      }
      for (const name of names) {
        const match = pattern.exec(name);
        if (!match) continue;
        try {
          into[match[1]] = fs.readFileSync(path.join(folder, dirName, name), 'utf8');
        } catch { /* a year that cannot be read is reported by being absent */ }
      }
    };
    collect('history', /^movements-(\d{4})\.ndjson$/, logs.movements);
    collect('invoices', /^invoices-(\d{4})\.ndjson$/, logs.invoices);

    const safety = this.snapshot('before-adopting');
    const outcome = this.importAll({ ...parsed, logs });
    return {
      ...outcome,
      from: folder,
      safety: safety || '',
      items: this.db.items.length,
    };
  }

  /**
   * An immediate, labelled copy of the current file — used before an update
   * rewrites anything, and before a restore replaces everything.
   */
  snapshot(label) {
    if (!fs.existsSync(this.file)) return null;
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = backupStamp();
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
    // Wall-clock, and remembered in the file. A clock that has been put back —
    // or a file copied from a machine set to next year — would otherwise wedge
    // the window shut for as long as the difference, so a stamp in the future is
    // treated as no stamp at all.
    const now = Date.now();
    const elapsed = now - this.lastBackupAt;
    if (this.lastBackupAt && elapsed >= 0 && elapsed < BACKUP_INTERVAL_MS) return;

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = backupStamp();
      fs.copyFileSync(this.file, path.join(this.backupDir, `myvault-auto-${stamp}.json`));
      this.lastBackupAt = now;
      this.db.lastBackupAt = now;
      this.pruneBackups();
    } catch { /* backups are best effort, never block a save */ }

    // …and again somewhere else, if the shop has named a second place. A backup
    // on the same disk as the data survives a mistake; it does not survive the
    // disk.
    this.mirrorBackup();
  }

  /**
   * Copies the current data file to the shop's second location.
   *
   * Every failure here is swallowed on purpose. The USB stick is unplugged more
   * often than it is plugged in, and a shop must never find that it cannot sell
   * anything because a backup drive is missing. The outcome is recorded so the
   * settings screen can say so plainly instead of failing silently forever.
   */
  mirrorBackup({ force = false } = {}) {
    const folder = (this.db.settings?.backupFolder || '').trim();
    if (!folder) return null;
    if (!fs.existsSync(this.file)) return null;

    try {
      fs.mkdirSync(folder, { recursive: true });
      const stamp = backupStamp();
      const name = `myvault-backup-${stamp}.json`;
      const target = path.join(folder, name);
      fs.copyFileSync(this.file, target);
      this.rememberMirrored(folder, name);
      this.pruneMirror(folder);
      this.mirrorLogs(folder);
      this.lastMirror = { at: nowIso(), path: target, error: '' };
    } catch (error) {
      this.lastMirror = {
        at: this.lastMirror?.at || '',
        path: this.lastMirror?.path || '',
        error: error?.message || String(error),
      };
      if (force) throw error;
    }
    return this.lastMirror;
  }

  /**
   * Carries the sales history and the invoices to the second drive as well.
   *
   * The dated .json beside them holds the catalogue; on its own it would give a
   * shop back its shelves and none of its takings. The logs live next to it in
   * folders of the same name they have at home, so a person looking at the stick
   * sees the same shape as their data folder rather than something only the
   * program understands.
   *
   * These files are append-only and this runs on every routine backup, so a
   * year that has not grown since the last copy is skipped. That makes the
   * usual case a stat of each file instead of a copy of every year the shop has
   * ever traded — the difference between a mirror that costs nothing and one a
   * busy counter would want switched off.
   *
   * The current year is copied whole each time it changes. A partial copy is not
   * possible: the write goes to a temporary name and is renamed into place, so
   * the stick holds either the previous complete year or the new one.
   */
  mirrorLogs(folder) {
    let copied = 0;
    for (const [log, name] of [[this.movements, 'history'], [this.documents, 'invoices']]) {
      const years = log.years();
      if (years.length === 0) continue;
      const into = path.join(folder, name);
      fs.mkdirSync(into, { recursive: true });
      for (const year of years) {
        const from = log.fileFor(year);
        const to = path.join(into, path.basename(from));
        try {
          const source = fs.statSync(from);
          let existing = null;
          try { existing = fs.statSync(to); } catch { /* not there yet */ }
          if (existing && existing.size === source.size) continue;
          const temporary = `${to}.part`;
          fs.copyFileSync(from, temporary);
          fs.renameSync(temporary, to);
          copied += 1;
        } catch { /* one unreadable year must not stop the rest */ }
      }
    }
    return copied;
  }

  /**
   * The same rolling window as the local backups, so a stick never fills up —
   * and it deletes only what it put there itself.
   *
   * It used to delete every myvault-backup-*.json in the folder. "Backup all
   * data" writes files by that very name, so a shop that pointed the second
   * copy at the folder where it keeps its own backups had them quietly deleted
   * by the eleventh automatic copy. The files a shop makes deliberately are the
   * ones they will reach for on the worst day.
   *
   * So MyVault keeps a list of its own copies beside them, and prunes from the
   * list. Anything not on it — a manual backup, a file somebody dragged there,
   * a copy of last year's — is left alone for ever. If the list is missing or
   * unreadable, nothing is deleted at all: forgetting which files are ours is a
   * reason to stop, not a reason to guess.
   */
  pruneMirror(folder) {
    const ledgerPath = path.join(folder, MIRROR_LEDGER);
    let mine = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      mine = Array.isArray(parsed?.wrote) ? parsed.wrote.filter((n) => typeof n === 'string') : [];
    } catch {
      return;
    }

    // Anything on the list that is no longer there has been dealt with already.
    const present = mine.filter((name) => {
      try { return fs.existsSync(path.join(folder, name)); } catch { return false; }
    });

    while (present.length > MAX_BACKUPS) {
      const oldest = present.shift();
      try {
        fs.unlinkSync(path.join(folder, oldest));
      } catch { /* ignore */ }
    }

    try {
      fs.writeFileSync(ledgerPath, JSON.stringify({ wrote: present }, null, 2), 'utf8');
    } catch { /* the folder may have gone away between writing and tidying */ }
  }

  /** Adds a copy to the list of what MyVault itself wrote to the second drive. */
  rememberMirrored(folder, name) {
    const ledgerPath = path.join(folder, MIRROR_LEDGER);
    let wrote = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      if (Array.isArray(parsed?.wrote)) wrote = parsed.wrote.filter((n) => typeof n === 'string');
    } catch { /* a folder used for the first time has no list yet */ }
    if (!wrote.includes(name)) wrote.push(name);
    try {
      fs.writeFileSync(ledgerPath, JSON.stringify({ wrote }, null, 2), 'utf8');
    } catch { /* best effort: without the list, nothing gets pruned, which is safe */ }
  }

  /** What the settings screen shows about the second copy. */
  mirrorStatus() {
    const folder = (this.db.settings?.backupFolder || '').trim();
    return {
      folder,
      configured: Boolean(folder),
      // Whether it is genuinely a different disk. On Windows that is the drive
      // letter; the whole point of the setting is defeated if it is not.
      sameDrive: folder ? path.parse(path.resolve(folder)).root
        === path.parse(path.resolve(this.dataDir)).root : false,
      lastAt: this.lastMirror?.at || '',
      lastPath: this.lastMirror?.path || '',
      error: this.lastMirror?.error || '',
    };
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

  /**
   * The same state, minus anything the interface has no business holding.
   *
   * Salts and hashes never cross the bridge — not the staff's PINs and not the
   * recovery code. They stay in the main process and in the file, and are
   * compared here; the window is told who is on the staff list, what their role
   * is, and whether a recovery code exists. Nothing that could be tried offline.
   */
  publicState({ capabilities = null } = {}) {
    const state = {
      ...this.db,
      users: this.listUsers(),
      recovery: this.recoveryStatus(),
    };

    // With no staff list there is one person and nothing to withhold.
    if (!capabilities) return state;

    const may = (capability) => capabilities.includes(capability);

    // What a shop pays for its stock is the owner's business, and a till does
    // not need it to sell anything. It used to cross the bridge for every
    // product on every refresh, which put the shop's entire cost base — and
    // therefore its margins — in the hands of whoever was standing at the
    // counter with the developer tools open.
    if (!may('pricing.view')) {
      state.items = state.items.map((item) => ({ ...item, cost: 0 }));
    }

    // A half-typed invoice belongs to whoever is typing it, and the totals on
    // it are the shop's trade with a supplier. Who the shop buys from goes the
    // same way: a wholesaler's name and terms are what a competitor would most
    // like to know, and nobody selling at the till needs either.
    if (!may('documents.manage')) { state.drafts = []; state.suppliers = []; }

    // The customer list crosses only for someone who may see customers at all.
    if (!may('clients.view')) state.clients = [];

    return state;
  }

  // ------------------------------------------------------------------- items

  addItem(input, { by = '' } = {}) {
    const item = this.normalizeItem({
      ...input,
      id: newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.db.items.push(item);
    this.persist();
    // An opening count is stock arriving, and the takings screen would look
    // wrong later if the shelf had filled itself.
    if (item.quantity > 0) {
      this.logMovement({
        itemId: item.id,
        itemName: item.name,
        delta: item.quantity,
        quantityAfter: item.quantity,
        reason: 'new',
        price: item.price,
        cost: item.cost,
        vatRate: this.vatRateFor(item),
        by,
      });
    }
    return item;
  }

  updateItem(id, patch, { by = '' } = {}) {
    const index = this.db.items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Item not found');
    const before = this.db.items[index].quantity;
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

    // Typing a new count straight into the edit box moves stock just as surely
    // as pressing the minus button does. Without this, a shop that corrects its
    // counts that way would find the statistics screen quietly disagreeing with
    // its own shelves.
    if (merged.quantity !== before) {
      this.logMovement({
        itemId: merged.id,
        itemName: merged.name,
        delta: merged.quantity - before,
        quantityAfter: merged.quantity,
        reason: 'correction',
        price: merged.price,
        cost: merged.cost,
        vatRate: this.vatRateFor(merged),
        by,
      });
    }
    return merged;
  }

  /**
   * The one that happens all day long: something sold, or a delivery arrived.
   *
   * `reason` and `clientId` are what turn a count into a history worth reading.
   * A shop that never names a customer still gets its takings; one that picks a
   * regular at the counter gets that too, at no extra cost per sale.
   */
  adjustStock(id, delta, { reason = '', clientId = '', by = '' } = {}) {
    const item = this.db.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    // A service has no count to put up or down. Billing one is a line on an
    // invoice, which is where the money and the VAT are recorded.
    if (item.service) {
      throw new Error(`"${item.name}" is a service — put it on an invoice rather than counting it.`);
    }

    const before = item.quantity;
    item.quantity = Math.max(0, item.quantity + clampQuantity(delta));
    item.updatedAt = nowIso();
    this.persist();

    // The floor at zero means asking for −5 when three are left is a change of
    // three, and the history says three. Otherwise the takings would count
    // stock the shop never had.
    const actual = item.quantity - before;
    if (actual !== 0) {
      const why = reason || (actual < 0 ? 'sale' : 'delivery');
      this.logMovement({
        itemId: item.id,
        itemName: item.name,
        delta: actual,
        quantityAfter: item.quantity,
        reason: why,
        price: item.price,
        cost: item.cost,
        vatRate: this.vatRateFor(item),
        // A sale and a refund both belong to whoever was at the counter.
        clientId: actual < 0 || why === 'return' ? clientId : '',
        by,
      });
    }
    return item;
  }

  deleteItems(ids, { by = '' } = {}) {
    const set = new Set(ids);
    const removed = this.db.items.filter((i) => set.has(i.id));
    this.db.items = this.db.items.filter((i) => !set.has(i.id));
    this.persist();
    // Stock that leaves the shelf by being deleted still left the shelf; without
    // this the numbers on the statistics screen would not add up.
    for (const item of removed) {
      this.logMovement({
        itemId: item.id,
        itemName: item.name,
        delta: -item.quantity,
        quantityAfter: 0,
        reason: 'delete',
        price: item.price,
        cost: item.cost,
        vatRate: this.vatRateFor(item),
        by,
      });
    }
    return removed;
  }

  /** Used by the undo action after a delete. */
  restoreItems(items, { by = '' } = {}) {
    const existing = new Set(this.db.items.map((i) => i.id));
    const restored = items
      .filter((i) => !existing.has(i.id))
      .map((i) => this.normalizeItem(i));
    this.db.items.push(...restored);
    this.persist();
    for (const item of restored) {
      this.logMovement({
        itemId: item.id,
        itemName: item.name,
        delta: item.quantity,
        quantityAfter: item.quantity,
        reason: 'restore',
        price: item.price,
        cost: item.cost,
        vatRate: this.vatRateFor(item),
        by,
      });
    }
    return restored;
  }

  // --------------------------------------------------------------- invoices
  //
  // A whole piece of paper at a time. See ./documents.js for why posted
  // documents live in their own file rather than in here.

  /** Whether prices on this kind of document already contain VAT. */
  inclusiveFor(kind) {
    const settings = this.db.settings;
    return kind === 'in' ? Boolean(settings.costsIncludeVat) : settings.pricesIncludeVat !== false;
  }

  draftTotals(draft) {
    return totalsFor(draft.lines, { inclusive: this.inclusiveFor(draft.kind) });
  }

  /** A draft, with its totals worked out — what the screen actually needs. */
  describeDraft(draft) {
    return { ...draft, totals: this.draftTotals(draft) };
  }

  listDrafts() {
    return this.db.drafts.map((draft) => this.describeDraft(draft));
  }

  startDraft({ kind = 'in', by = '' } = {}) {
    const draft = emptyDraft({ kind, by });
    this.db.drafts.push(draft);
    this.persist();
    return this.describeDraft(draft);
  }

  getDraft(id) {
    const draft = this.db.drafts.find((candidate) => candidate.id === id);
    if (!draft) throw new Error('That invoice is no longer open.');
    return draft;
  }

  /**
   * Remembers that this exact file has been read onto this draft.
   *
   * Reading the same PDF twice is an easy thing to do — the screen tells you
   * what was missing, you add it, and reading again is the obvious next move —
   * and it used to append the invoice's lines a second time. The draft then
   * said two of everything, at twice the money, and the only sign was a total
   * that no longer matched the paper. Since a shop reads the printed total off
   * the top of the invoice and the screen's total off the bottom of the screen,
   * that is exactly the kind of disagreement nobody notices until stock-take.
   *
   * The file is remembered by the fingerprint of its own bytes rather than by
   * its name or its invoice number: the same invoice split into one PDF per
   * page is a different file each time and must still be allowed, while the
   * same file chosen twice is the same bytes however it was named.
   *
   * @returns {boolean} true if this is the first time, false if already read
   */
  noteDraftSource(id, fingerprint) {
    const draft = this.getDraft(id);
    const stamp = asString(fingerprint, 64);
    if (!stamp) return true;
    if (!Array.isArray(draft.sources)) draft.sources = [];
    if (draft.sources.includes(stamp)) return false;
    draft.sources = [...draft.sources, stamp].slice(-MAX_DRAFT_SOURCES);
    this.persist();
    return true;
  }

  updateDraft(id, patch = {}) {
    const draft = this.getDraft(id);
    if (patch.number !== undefined) draft.number = asString(patch.number, 60);
    if (patch.supplier !== undefined) draft.supplier = asString(patch.supplier, 120);
    if (patch.clientId !== undefined) draft.clientId = asString(patch.clientId, 64);
    if (patch.date !== undefined) draft.date = asString(patch.date, 10);
    if (patch.note !== undefined) draft.note = asString(patch.note, 2000);
    this.persist();
    return this.describeDraft(draft);
  }

  /**
   * Adds or replaces a line.
   *
   * The same product twice on one invoice is a real thing — two boxes at two
   * prices — so lines are not merged automatically. A shop that wanted them
   * merged would have typed one line.
   */
  setDraftLine(id, line) {
    const draft = this.getDraft(id);
    const item = this.db.items.find((candidate) => candidate.id === line?.itemId);
    if (!item) throw new Error('That product is not in your stock list.');

    const clean = normalizeLine({
      ...line,
      name: item.name,
      barcode: item.barcode,
      // Default to what MyVault already knows, so scanning a barcode fills the
      // line in and the shop only corrects what the invoice disagrees with.
      unitPrice: line.unitPrice === undefined || line.unitPrice === ''
        ? (draft.kind === 'in' ? item.cost : item.price)
        : line.unitPrice,
      vatRate: line.vatRate === undefined || line.vatRate === ''
        ? this.vatRateFor(item)
        : line.vatRate,
    }, { kind: draft.kind });

    if (!clean) throw new Error('A line needs a product and a quantity.');

    const index = line.lineId !== undefined
      ? Number(line.lineId)
      : draft.lines.findIndex((existing) => existing.itemId === clean.itemId);

    if (Number.isInteger(index) && index >= 0 && index < draft.lines.length) {
      draft.lines[index] = clean;
    } else {
      draft.lines.push(clean);
    }
    this.persist();
    return this.describeDraft(draft);
  }

  removeDraftLine(id, index) {
    const draft = this.getDraft(id);
    const at = Number(index);
    if (Number.isInteger(at) && at >= 0 && at < draft.lines.length) {
      draft.lines.splice(at, 1);
      this.persist();
    }
    return this.describeDraft(draft);
  }

  discardDraft(id) {
    this.db.drafts = this.db.drafts.filter((draft) => draft.id !== id);
    this.persist();
    return this.listDrafts();
  }

  /**
   * Turns the paper into stock.
   *
   * Everything happens here in one go: the stock moves, the movements are
   * written with the document they came from, and the document is appended to
   * this year's file. An incoming invoice also updates each product's cost
   * price, because what the supplier charged this time is the best answer to
   * "what does this cost me" that the shop has.
   */
  postDraft(id, { by = '' } = {}) {
    const draft = this.getDraft(id);
    if (draft.lines.length === 0) throw new Error('This invoice has no lines on it yet.');

    const incoming = draft.kind === 'in';

    // The document that gets filed has to be the document that actually posted.
    //
    // Two things can make that untrue, and both used to pass silently: a product
    // deleted while the invoice was still being typed, and an outgoing invoice
    // for more than is on the shelf. In either case the line kept its money on
    // the paper while the stock either did not move or moved only as far as zero
    // — so the invoice said one figure and the VAT return built from the
    // movements said another. Refusing here, before a single number moves, is
    // the only answer that keeps them equal: the shop either corrects the stock
    // or corrects the line, and both are one press away.
    const problems = [];
    for (const line of draft.lines) {
      const item = this.db.items.find((candidate) => candidate.id === line.itemId);
      if (!item) {
        problems.push(`${line.name || 'A product on this invoice'} is no longer in your stock list.`);
      } else if (item.service) {
        // Nothing to run short of. An hour of labour is not on a shelf, and a
        // shortage check would refuse every service line the shop ever billed.
        continue;
      } else if (!incoming && item.quantity < line.quantity) {
        problems.push(`${item.name}: the invoice says ${line.quantity}, but you have ${item.quantity}.`);
      }
    }
    if (problems.length > 0) {
      const shown = problems.slice(0, 6);
      if (problems.length > shown.length) {
        shown.push(`…and ${problems.length - shown.length} more.`);
      }
      throw new Error(`This invoice cannot be posted as it stands.\n\n${shown.join('\n')}`);
    }

    const totals = this.draftTotals(draft);
    const postedAt = nowIso();

    const posted = {
      ...draft,
      totals,
      postedAt,
      by: by || draft.by,
      voided: false,
    };

    const moved = [];
    for (const line of draft.lines) {
      const item = this.db.items.find((candidate) => candidate.id === line.itemId);
      if (!item) continue;

      // A service bills money and moves nothing. It still writes a movement,
      // because the money and the VAT on it are as real as any other line — the
      // movement simply says what was done rather than what left a shelf, and
      // the count on it stays where it was.
      if (item.service) {
        item.updatedAt = postedAt;
        if (incoming && line.unitPrice > 0) item.cost = clampMoney(unitAfterDiscount(line));
        moved.push({
          itemId: item.id,
          itemName: item.name,
          delta: incoming ? line.quantity : -line.quantity,
          quantityAfter: item.quantity,
          reason: incoming ? 'delivery' : 'sale',
          price: incoming ? item.price : unitAfterDiscount(line),
          cost: incoming ? unitAfterDiscount(line) : item.cost,
          vatRate: line.vatRate,
          clientId: incoming ? '' : draft.clientId,
          docId: draft.id,
          /**
           * So the log describes itself. Anything reconciling movements against
           * the shelves has to leave these out, and it must be able to tell
           * without the product — which may have been renamed, or deleted, long
           * after the invoice was filed.
           */
          service: true,
          by: by || draft.by,
        });
        continue;
      }

      const before = item.quantity;
      item.quantity = Math.max(0, before + (incoming ? line.quantity : -line.quantity));
      item.updatedAt = postedAt;
      // What it cost this time is what it costs — after the discount, because
      // that is the money that actually left the shop.
      if (incoming && line.unitPrice > 0) item.cost = clampMoney(unitAfterDiscount(line));

      const actual = item.quantity - before;
      if (actual !== 0) {
        moved.push({
          itemId: item.id,
          itemName: item.name,
          delta: actual,
          quantityAfter: item.quantity,
          reason: incoming ? 'delivery' : 'sale',
          // The invoice line is the authority on price, not today's shelf — and
          // after any discount on it, so units × price is the line total the
          // paper shows and the VAT return cannot drift from the invoice.
          price: incoming ? item.price : unitAfterDiscount(line),
          cost: incoming ? unitAfterDiscount(line) : item.cost,
          vatRate: line.vatRate,
          clientId: incoming ? '' : draft.clientId,
          docId: draft.id,
          by: by || draft.by,
        });
      }
    }

    this.db.drafts = this.db.drafts.filter((candidate) => candidate.id !== id);
    // A delivery posted in somebody's name is what makes them a supplier. Doing
    // it here rather than asking means a shop that never opens the supplier
    // screen still has a complete book of who supplies it.
    if (incoming && draft.supplier) this.rememberSupplier(draft.supplier);
    this.persist();

    for (const entry of moved) this.logMovement(entry);
    this.fileDocument(posted);

    return { document: posted, moved: moved.length };
  }

  /**
   * Undoes a posted invoice by posting its opposite.
   *
   * Deliberately not a delete. The stock really did move, the VAT really was
   * recorded, and a history that can be quietly edited afterwards is not a
   * history — an accountant looking at last quarter should see both the
   * mistake and the correction.
   */
  voidDocument(id, { by = '' } = {}) {
    const original = this.documents.find(id);
    if (!original) throw new Error('That invoice is not in your records.');
    if (original.voids) throw new Error('That is already a reversal — void the invoice itself.');

    // Whether it has been voided cannot be a flag on the original: the log is
    // append-only, so nothing already written to it is ever changed. The
    // answer is whether a reversal naming it exists, which is also what makes
    // the state survive being read back from disk. See reversedDocuments.
    if (this.reversedDocuments().has(id)) {
      throw new Error('That invoice has already been voided.');
    }

    const incoming = original.kind === 'in';
    const at = nowIso();
    const moved = [];

    for (const line of original.lines) {
      const item = this.db.items.find((candidate) => candidate.id === line.itemId);
      if (!item) continue;
      const before = item.quantity;
      // The opposite of what posting did.
      item.quantity = Math.max(0, before + (incoming ? -line.quantity : line.quantity));
      item.updatedAt = at;

      const actual = item.quantity - before;
      if (actual !== 0) {
        moved.push({
          itemId: item.id,
          itemName: item.name,
          delta: actual,
          quantityAfter: item.quantity,
          // A cancelled sale is a return; a cancelled delivery is a correction,
          // because the goods went back to the supplier rather than to a
          // customer who was refunded.
          reason: incoming ? 'correction' : 'return',
          // The same figures the posting used, discount and all, so a void
          // cancels exactly what was recorded rather than approximately.
          price: incoming ? item.price : unitAfterDiscount(line),
          cost: incoming ? unitAfterDiscount(line) : item.cost,
          vatRate: line.vatRate,
          clientId: incoming ? '' : original.clientId,
          docId: original.id,
          by,
        });
      }
    }

    // Voiding an incoming invoice has to put the cost price back as well as the
    // stock. Posting it overwrote each product's cost with what that invoice
    // said, so leaving it there means a mistyped cost the shop has already
    // cancelled still values the shelves and every margin off a price nobody
    // paid — a delivery entered as 0,01 by accident would make the stock look
    // worthless and the margins look enormous, for ever.
    //
    // What it goes back to is the last delivery before this one, which the
    // movement log already knows. A product whose cost has been typed over since
    // is left alone: that figure is the shop's own answer, not this invoice's.
    if (incoming) {
      const previous = new Map();
      this.movements.forEach({}, (entry) => {
        if (entry.reason !== 'delivery' || (Number(entry.delta) || 0) <= 0) return;
        if (entry.docId === original.id) return;
        previous.set(entry.itemId, clampMoney(entry.cost));
      });
      for (const line of original.lines) {
        const item = this.db.items.find((candidate) => candidate.id === line.itemId);
        if (!item) continue;
        const before = previous.get(item.id);
        if (before !== undefined && item.cost === clampMoney(unitAfterDiscount(line))) {
          item.cost = before;
        }
      }
    }

    this.persist();
    for (const entry of moved) this.logMovement(entry);

    // The void is itself a document, so the file still only ever grows.
    const record = {
      ...original,
      id: newId(),
      voids: original.id,
      voided: false,
      number: original.number ? `${original.number} (void)` : '(void)',
      postedAt: at,
      by,
      lines: original.lines.map((line) => ({ ...line, quantity: -line.quantity })),
      totals: {
        ...original.totals,
        net: -original.totals.net,
        vat: -original.totals.vat,
        gross: -original.totals.gross,
        units: -original.totals.units,
      },
    };
    this.fileDocument(record);

    return { document: record, moved: moved.length };
  }

  /**
   * Reads a supplier's CSV straight onto a draft.
   *
   * Many suppliers email one, and typing thirty lines off a screen is no better
   * than typing them off paper. Products are matched on barcode first and name
   * second; anything that matches nothing is handed back rather than guessed
   * at, because a wrong match here silently books stock against the wrong
   * product.
   */
  importDraftLines(id, rows) {
    const draft = this.getDraft(id);
    const byBarcode = new Map(
      this.db.items.filter((item) => item.barcode).map((item) => [item.barcode.trim(), item]),
    );
    const byName = new Map(
      this.db.items.map((item) => [item.name.trim().toLowerCase(), item]),
    );

    // What this supplier called each product last time. Built per import rather
    // than kept about, because it is only ever asked once per line.
    const supplier = supplierKey(draft.supplier);
    const byCode = new Map();
    for (const item of this.db.items) {
      for (const known of item.supplierCodes || []) {
        if (!known.code) continue;
        // Keyed by supplier as well as code: two wholesalers both number things
        // from 1, and matching on a bare "558" across all of them would put the
        // wrong product on a delivery.
        byCode.set(`${supplierKey(known.supplier)}|${known.code.toLowerCase()}`, item);
      }
    }

    const result = {
      added: 0, unmatched: [], learned: 0, repriced: [],
    };

    for (const row of rows) {
      const lower = {};
      for (const [key, value] of Object.entries(row)) {
        lower[String(key).trim().toLowerCase()] = value;
      }

      const barcode = asString(lower.barcode ?? lower.ean ?? lower.code, 64).trim();
      const name = asString(lower.name ?? lower.product ?? lower.description, 160).trim();
      const quantity = clampQuantity(lower.quantity ?? lower.qty ?? lower.pcs ?? 0);
      const price = clampMoney(
        lower.price ?? lower['unit price'] ?? lower.cost ?? lower['unit cost'] ?? 0,
      );
      // A supplier who prints a discount and a rate on the line means them, and
      // dropping them would leave the draft disagreeing with the paper it was
      // read from — the one thing an imported document must never do.
      const discount = Number(lower.discount ?? lower['discount %'] ?? lower['disc %'] ?? 0) || 0;
      const rate = lower['vat rate'] ?? lower.vat ?? lower['vat %'] ?? lower['φπα'];

      if (!quantity) continue;

      const code = asString(lower.code ?? lower.sku ?? '', 64).trim();
      const item = (barcode && byBarcode.get(barcode))
        || (code && byCode.get(`${supplier}|${code.toLowerCase()}`))
        || (name && byName.get(name.toLowerCase()));

      if (!item) {
        result.unmatched.push({ barcode, name, code, quantity, price, discount, rate });
        continue;
      }

      // Matched some other way, and the paper names a code this supplier uses:
      // remember it, so next month's invoice needs nobody's help.
      if (code && supplier && !byCode.has(`${supplier}|${code.toLowerCase()}`)) {
        item.supplierCodes = [
          ...(item.supplierCodes || []),
          { supplier: draft.supplier, code },
        ].slice(-MAX_SUPPLIER_CODES);
        byCode.set(`${supplier}|${code.toLowerCase()}`, item);
        result.learned += 1;
      }

      // What this product cost last time, against what the paper is charging
      // now. A supplier putting a price up is not an error and MyVault does not
      // treat it as one — but it is the single most useful thing a delivery can
      // tell a shop, and the moment to see it is while the delivery is still a
      // draft that can be queried, not a fortnight later when the margin has
      // already been sold away. Only the lines that moved are reported, and only
      // past the point where a change is a change rather than a rounded cent.
      const wasPaid = draft.kind === 'in' ? Number(item.cost) : Number(item.price);
      if (price && wasPaid > 0) {
        const paying = clampMoney(price * (1 - (Number(discount) || 0) / 100));
        const difference = Math.round(((paying - wasPaid) / wasPaid) * 1000) / 10;
        if (Math.abs(difference) >= COST_CHANGE_THRESHOLD) {
          result.repriced.push({
            itemId: item.id,
            name: item.name,
            was: wasPaid,
            now: paying,
            percent: difference,
            kind: difference > 0 ? 'dearer' : 'cheaper',
          });
        }
      }

      draft.lines.push(normalizeLine({
        itemId: item.id,
        name: item.name,
        barcode: item.barcode,
        quantity,
        unitPrice: price || (draft.kind === 'in' ? item.cost : item.price),
        discount,
        // The rate the supplier charged, where the file says; otherwise the rate
        // this shop has for the product. A rate read off the paper is a fact
        // about that delivery, and the VAT return is built from these lines.
        vatRate: rate === undefined || rate === '' || rate === null
          ? this.vatRateFor(item)
          : normalizeRate(rate),
      }, { kind: draft.kind }));
      result.added += 1;
    }

    this.persist();
    return { ...result, draft: this.describeDraft(draft) };
  }

  // ------------------------------------------------------------- the suppliers
  //
  // Who the shop buys from, and everything they have ever sent.
  //
  // The list of names is kept in the data file, because a shop wants to write a
  // phone number against a wholesaler and have it still be there next year. What
  // each of them has sent is not kept anywhere twice: it is read out of the
  // invoice files, which already hold every posted document, for good, one file
  // per year. A supplier's history is therefore a question asked of the record
  // rather than a summary maintained beside it — the two can never disagree,
  // because there is only one of them.

  /**
   * Which invoices have been undone, worked out once instead of four times.
   *
   * A posted invoice is never edited, so "has this one been voided?" cannot be
   * a flag on it — the answer is whether a reversal naming it exists further
   * down the log. Four screens need that answer: the invoice history, the
   * supplier book, the sales search and voiding itself. Each was reading every
   * invoice file from the first year to the last to work it out, so opening
   * Suppliers on a shop with a decade of deliveries read the entire decade
   * twice, and the sales search read it again on every keystroke.
   *
   * The set is small — a shop voids a handful of invoices a year, not a
   * handful a day — and the log only ever grows at the end, so it is built on
   * demand and thrown away whenever anything is appended. Thrown away rather
   * than patched: a cache that is updated in two places is a cache that is
   * wrong in a third, and being wrong here means a voided invoice still
   * counting towards what a supplier was paid.
   */
  reversedDocuments() {
    if (this.reversedIds) return this.reversedIds;
    const reversed = new Set();
    this.documents.forEach({}, (document) => {
      if (document.voids) reversed.add(document.voids);
    });
    this.reversedIds = reversed;
    return reversed;
  }

  /**
   * Files a posted document, and forgets what was true before it existed.
   *
   * Every append goes through here so that no future one can be added without
   * the cache above being dropped with it.
   */
  fileDocument(record) {
    try {
      this.documents.append(record);
    } catch {
      // The stock has already moved and the movement is already in the
      // history. A missing copy of the paper is the lesser loss, and the
      // shop is better served by a delivery that posted than by one that
      // refused at the last step. See the history-trouble path for the case
      // that does matter, which is a movement that could not be written.
      return false;
    } finally {
      this.reversedIds = null;
    }
    return true;
  }

  /**
   * The date a shop means when it says "that invoice from August".
   *
   * The one printed on the paper, not the moment somebody typed it in. They are
   * usually the same day and occasionally a fortnight apart — a delivery note
   * from the end of December entered in January is the ordinary case, and it
   * belongs in December wherever the shop looks for it.
   */
  static documentDate(document) {
    return String(document?.date || document?.postedAt || '').slice(0, 10);
  }

  /**
   * The window to read the year files over, for a wanted range of invoice dates.
   *
   * The files are filed by when a document was posted, so a search for December
   * has to read a little of January to find the paper dated the 31st and typed
   * on the 2nd. A year either side is far more slack than any shop needs and
   * still spares a ten-year history from being read end to end for one month.
   */
  static scanWindow(from, to) {
    const shift = (value, years) => {
      const when = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(when.getTime())) return undefined;
      when.setUTCFullYear(when.getUTCFullYear() + years);
      return when.toISOString();
    };
    return { from: from ? shift(from, -1) : undefined, to: to ? shift(to, 1) : undefined };
  }

  normalizeSupplier(input = {}) {
    return {
      id: asString(input.id, 64) || newId(),
      name: asString(input.name, 120).trim(),
      vatNumber: asString(input.vatNumber, 40).trim(),
      phone: asString(input.phone, 40).trim(),
      email: asString(input.email, 120).trim(),
      note: asString(input.note, 500),
      createdAt: asString(input.createdAt) || nowIso(),
    };
  }

  /**
   * Makes sure a supplier is in the book, without asking anybody to type them in.
   *
   * Called when a delivery is posted and when a PDF fills in the supplier field.
   * The name is matched the way supplier codes are matched — case, spaces and
   * punctuation ignored — so "ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ Α.Ε." does not become a second
   * entry beside "ΑΦΟΙ ΠΑΠΑΔΟΠΟΥΛΟΥ ΑΕ".
   */
  rememberSupplier(name, details = {}) {
    const clean = asString(name, 120).trim();
    if (!clean) return null;
    const key = supplierKey(clean);
    if (!Array.isArray(this.db.suppliers)) this.db.suppliers = [];

    const known = this.db.suppliers.find((supplier) => supplierKey(supplier.name) === key);
    if (known) {
      // Anything the paper knows that the book does not. Never the other way
      // round: what somebody typed is theirs, and an invoice does not overwrite
      // a phone number the shop corrected by hand.
      let changed = false;
      for (const field of ['vatNumber', 'phone', 'email']) {
        const value = asString(details[field], 120).trim();
        if (value && !known[field]) { known[field] = value; changed = true; }
      }
      if (changed) this.persist();
      return known;
    }

    const supplier = this.normalizeSupplier({ ...details, name: clean });
    this.db.suppliers.push(supplier);
    this.persist();
    return supplier;
  }

  saveSupplier(input = {}) {
    const clean = this.normalizeSupplier(input);
    if (!clean.name) throw new Error('A supplier needs a name.');
    if (!Array.isArray(this.db.suppliers)) this.db.suppliers = [];

    const key = supplierKey(clean.name);
    const clash = this.db.suppliers.find(
      (supplier) => supplier.id !== clean.id && supplierKey(supplier.name) === key,
    );
    if (clash) throw new Error(`"${clash.name}" is already in your list of suppliers.`);

    const existing = this.db.suppliers.find((supplier) => supplier.id === clean.id);
    if (existing) Object.assign(existing, clean, { createdAt: existing.createdAt });
    else this.db.suppliers.push(clean);
    this.persist();
    return existing || clean;
  }

  /**
   * Takes a supplier out of the book — and nothing else.
   *
   * Their invoices stay exactly where they are. A shop that stops dealing with a
   * wholesaler still bought from them, still deducted the VAT on it, and still
   * has to be able to show the invoice five years later. The name simply stops
   * being offered; the history goes on being history, and appears under that
   * name as an entry nobody has details for.
   */
  removeSupplier(id) {
    const before = (this.db.suppliers || []).length;
    this.db.suppliers = (this.db.suppliers || []).filter((supplier) => supplier.id !== id);
    if (this.db.suppliers.length === before) throw new Error('That supplier is not in your list.');
    this.persist();
    return { removed: 1 };
  }

  /**
   * Every supplier, with what they have sent worked out from the invoice files.
   *
   * One pass over the record, not one per supplier: a shop with forty suppliers
   * and eight years of invoices would otherwise read the same files forty times
   * to draw one screen.
   */
  supplierBook({ query = '', from = '', to = '' } = {}) {
    const totals = new Map();
    const voided = this.reversedDocuments();
    const window = Store.scanWindow(from, to);

    this.documents.forEach(window, (document) => {
      if (document.kind !== 'in') return;
      if (document.voids || voided.has(document.id)) return;
      const when = Store.documentDate(document);
      if (from && when < from) return;
      if (to && when > to) return;
      const key = supplierKey(document.supplier) || '?';
      const seen = totals.get(key) || {
        key, name: document.supplier || '', invoices: 0, spent: 0, last: '', first: '',
      };
      seen.invoices += 1;
      seen.spent = clampMoney(seen.spent + (document.totals?.gross || 0));
      if (!seen.name && document.supplier) seen.name = document.supplier;
      if (when && (!seen.last || when > seen.last)) seen.last = when;
      if (when && (!seen.first || when < seen.first)) seen.first = when;
      totals.set(key, seen);
    });

    const book = [];
    const listed = new Set();
    for (const supplier of this.db.suppliers || []) {
      const key = supplierKey(supplier.name);
      listed.add(key);
      book.push({ ...supplier, key, ...(totals.get(key) || { invoices: 0, spent: 0, last: '', first: '' }), name: supplier.name });
    }
    // Suppliers that appear on invoices from before this list existed, or whose
    // details were removed. They have a history, so they have a place.
    for (const [key, seen] of totals.entries()) {
      if (listed.has(key)) continue;
      book.push({
        id: '', name: seen.name, vatNumber: '', phone: '', email: '', note: '',
        createdAt: '', key, invoices: seen.invoices, spent: seen.spent, last: seen.last, first: seen.first,
      });
    }

    const wanted = String(query || '').trim().toLowerCase();
    const matching = wanted
      ? book.filter((supplier) => [supplier.name, supplier.vatNumber, supplier.phone, supplier.email, supplier.note]
        .some((field) => String(field || '').toLowerCase().includes(wanted)))
      : book;

    return matching.sort((a, b) => (b.last || '').localeCompare(a.last || '')
      || a.name.localeCompare(b.name));
  }

  /**
   * Invoices, searched.
   *
   * One place for both directions, because "find me that invoice" is the same
   * question whether the paper came in or went out: a number, a name, a date,
   * or a product somebody remembers being on it. Reading the year files is what
   * makes it work on ten years of history without keeping an index that could
   * be wrong.
   */
  searchDocuments({
    kind = '', query = '', supplier = '', clientId = '', from = '', to = '', limit = 200,
  } = {}) {
    const wanted = String(query || '').trim().toLowerCase();
    const supplierWanted = supplierKey(supplier);
    const cap = Math.min(500, Math.max(1, Number(limit) || 200));

    const voided = this.reversedDocuments();

    const clientNames = new Map(
      (this.db.clients || []).map((client) => [client.id, client.name]),
    );

    const found = [];
    this.documents.forEach(Store.scanWindow(from, to), (document) => {
      if (kind && document.kind !== kind) return;
      // The date on the paper, which is what a shop searches by. See
      // Store.documentDate: it is not always the day it was typed in.
      const when = Store.documentDate(document);
      if (from && when < from) return;
      if (to && when > to) return;
      if (supplierWanted && supplierKey(document.supplier) !== supplierWanted) return;
      if (clientId && document.clientId !== clientId) return;

      if (wanted) {
        const client = clientNames.get(document.clientId) || '';
        const haystack = [
          document.number, document.supplier, client, document.note, document.date,
          ...(document.lines || []).map((line) => line.name),
        ].join(' ').toLowerCase();
        if (!haystack.includes(wanted)) return;
      }

      found.push({
        id: document.id,
        kind: document.kind,
        number: document.number || '',
        date: document.date || '',
        postedAt: document.postedAt || '',
        supplier: document.supplier || '',
        clientId: document.clientId || '',
        clientName: clientNames.get(document.clientId) || '',
        lines: (document.lines || []).length,
        units: document.totals?.units ?? 0,
        net: document.totals?.net ?? 0,
        vat: document.totals?.vat ?? 0,
        gross: document.totals?.gross ?? 0,
        voids: document.voids || '',
        voided: voided.has(document.id),
      });
      // Newest wanted, oldest read first: keep a window rather than the lot, so
      // a search across a decade never holds a decade in memory.
      if (found.length > cap * 2) found.splice(0, found.length - cap);
    });

    return found.slice(-cap).reverse();
  }

  /** One invoice in full, lines and all, for the shop that wants to look at it. */
  documentDetail(id) {
    const document = this.documents.find(id);
    if (!document) throw new Error('That invoice is not in your records.');
    const client = (this.db.clients || []).find((c) => c.id === document.clientId);
    return { ...document, clientName: client ? client.name : '' };
  }

  listDocuments(options = {}) {
    const voided = this.reversedDocuments();
    return this.documents
      .list({ from: options.from, to: options.to, limit: Math.min(500, Number(options.limit) || 100) })
      .map((document) => ({ ...document, voided: voided.has(document.id) }));
  }

  // -------------------------------------------------------------- stock take
  //
  // Counting a shop is a long job done on foot, interrupted by customers, and
  // usually finished the next morning. So the count is saved as it is typed and
  // nothing is corrected until the shop presses apply — up to that moment the
  // stock on file is untouched, and a stock take can be abandoned with no
  // consequences at all.

  startStockTake({ categoryId = '', by = '' } = {}) {
    if (this.db.stockTake) throw new Error('A count is already in progress.');
    this.db.stockTake = {
      startedAt: nowIso(),
      by: asString(by, 60),
      categoryId: asString(categoryId, 64),
      counts: {},
    };
    this.persist();
    return this.db.stockTake;
  }

  /**
   * Records one shelf's worth of counting.
   *
   * Saved immediately rather than at the end, because the alternative is losing
   * two hours of work to a power cut in a shop that already lost two hours.
   */
  countStockTake(itemId, counted) {
    if (!this.db.stockTake) throw new Error('No count is in progress.');
    const item = this.db.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('That product is no longer in the stock list.');
    // Refused here rather than only left off the list, because a figure that got
    // in would be kept by the rule below that protects counting already done —
    // and a service would then be "corrected" to a quantity it cannot have.
    if (item.service) {
      throw new Error(`"${item.name}" is a service, so it is no longer in the stock list to count.`);
    }
    if (counted === null || counted === '') {
      delete this.db.stockTake.counts[itemId];
    } else {
      this.db.stockTake.counts[itemId] = Math.max(0, clampQuantity(counted));
    }
    this.persist();
    return this.db.stockTake;
  }

  /** What has been counted so far, against what the file says should be there. */
  stockTakeProgress() {
    const take = this.db.stockTake;
    if (!take) return null;

    // Services are never counted: there is nothing on a shelf to walk up to.
    const scoped = this.db.items.filter(
      (item) => !item.service && (!take.categoryId || item.categoryId === take.categoryId),
    );

    // A figure already typed is work done, and it stays in the count even if the
    // product has since left the scope — moved to another category, or had its
    // category deleted underneath it. Scope decides what still needs counting;
    // it does not get to discard an afternoon of counting after the fact.
    const alreadyIn = new Set(scoped.map((item) => item.id));
    const inScope = scoped.concat(this.db.items.filter(
      (item) => !item.service
        && !alreadyIn.has(item.id) && take.counts[item.id] !== undefined,
    ));

    const lines = [];
    let missingUnits = 0;
    let extraUnits = 0;
    let shrinkage = 0;
    let counted = 0;
    let matching = 0;

    for (const item of inScope) {
      const seen = take.counts[item.id];
      if (seen === undefined) continue;
      counted += 1;
      const difference = seen - item.quantity;
      if (difference === 0) matching += 1;
      else if (difference < 0) {
        missingUnits += -difference;
        // Missing stock is valued at what it would have sold for — that is the
        // number the shop feels, not what they paid for it.
        shrinkage += -difference * (Number(item.price) || 0);
      } else {
        extraUnits += difference;
      }
      if (difference !== 0) {
        lines.push({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          expected: item.quantity,
          counted: seen,
          difference,
          value: Math.round(difference * (Number(item.price) || 0) * 100) / 100,
        });
      }
    }

    return {
      startedAt: take.startedAt,
      by: take.by,
      categoryId: take.categoryId,
      total: inScope.length,
      counted,
      remaining: Math.max(0, inScope.length - counted),
      matching,
      differing: lines.length,
      missingUnits,
      extraUnits,
      shrinkage: Math.round(shrinkage * 100) / 100,
      // Biggest discrepancies first: that is the order a shop wants to check
      // them in, because the top of the list is where a real mistake will be.
      lines: lines.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    };
  }

  /**
   * Puts the counted figures into the stock, in one go.
   *
   * Every correction goes through the movement log, so a stock take leaves a
   * permanent record of who counted what and by how much it was out — which is
   * the part that makes the exercise worth doing twice.
   */
  applyStockTake({ by = '' } = {}) {
    const progress = this.stockTakeProgress();
    if (!progress) throw new Error('No count is in progress.');

    // Every count in the shop is about to be overwritten by what somebody
    // walked round and typed. Usually that is exactly right and the whole point
    // — but a mistyped shelf, or a count abandoned half way and applied by
    // accident, is a thousand quantities gone with nothing to compare against.
    // A restore takes a copy first; so does this now.
    this.snapshot('before-stock-take');

    const applied = [];
    for (const line of progress.lines) {
      const item = this.db.items.find((candidate) => candidate.id === line.id);
      if (!item) continue;
      item.quantity = Math.max(0, line.counted);
      item.updatedAt = nowIso();
      applied.push({ item, difference: line.difference });
    }

    this.db.stockTake = null;
    this.persist();

    for (const { item, difference } of applied) {
      this.logMovement({
        itemId: item.id,
        itemName: item.name,
        delta: difference,
        quantityAfter: item.quantity,
        reason: 'stocktake',
        price: item.price,
        cost: item.cost,
        vatRate: this.vatRateFor(item),
        by: by || progress.by,
      });
    }

    return {
      corrected: applied.length,
      missingUnits: progress.missingUnits,
      extraUnits: progress.extraUnits,
      shrinkage: progress.shrinkage,
    };
  }

  /** Throws the count away. The stock on file was never touched. */
  cancelStockTake() {
    this.db.stockTake = null;
    this.persist();
    return null;
  }

  // ----------------------------------------------------------------- clients

  addClient(input) {
    const client = this.normalizeClient({ ...input, id: newId(), createdAt: nowIso(), updatedAt: nowIso() });
    const name = asString(input?.name, 120).trim();
    if (!name) throw new Error('Give this customer a name.');
    this.db.clients.push(client);
    this.persist();
    return client;
  }

  updateClient(id, patch = {}) {
    const index = this.db.clients.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('That customer is no longer on the list.');
    if (patch.name !== undefined && !asString(patch.name, 120).trim()) {
      throw new Error('Give this customer a name.');
    }
    const merged = this.normalizeClient({
      ...this.db.clients[index],
      ...patch,
      id,
      createdAt: this.db.clients[index].createdAt,
      updatedAt: nowIso(),
    });
    this.db.clients[index] = merged;
    this.persist();
    return merged;
  }

  /**
   * Removes the contact. What they bought stays in the history — those sales
   * really happened, and the takings for that month should not change because
   * somebody tidied the address book.
   */
  deleteClient(id) {
    this.db.clients = this.db.clients.filter((c) => c.id !== id);
    this.persist();
    return this.db.clients;
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

  addField({ name, type, options, showInTable }) {
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

  // -------------------------------------------------------------------- staff

  /** The staff list as the interface may see it: names and roles, never PINs. */
  listUsers() {
    return this.db.users.map(({ id, name, role, createdAt }) => ({ id, name, role, createdAt }));
  }

  /** Whoever's PIN this is, or null. Names are not needed to sign in — a PIN is. */
  findByPin(pin) {
    if (!isValidPin(pin)) return null;
    const user = this.db.users.find((candidate) => verifyPin(pin, candidate));
    return user ? { id: user.id, name: user.name, role: user.role } : null;
  }

  addUser({ name, role, pin }) {
    const clean = asString(name, 60).trim();
    if (!clean) throw new Error('Give this person a name.');
    if (!ROLES.includes(role)) throw new Error(`"${role}" is not a role MyVault knows.`);
    // The moment the first person exists, MyVault starts asking for a PIN. If
    // that person were an assistant, nobody could ever reach this screen again.
    if (this.db.users.length === 0 && role !== 'admin') {
      throw new Error('The first person has to be a manager, or nobody could add the others.');
    }
    if (this.db.users.some((u) => u.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`There is already someone called "${clean}".`);
    }
    // Two people sharing a PIN would sign each other in, since the PIN is the
    // whole of the sign-in.
    if (this.db.users.some((u) => verifyPin(pin, u))) {
      throw new Error('Somebody already uses that PIN. Choose another.');
    }

    const { salt, hash } = hashPin(pin);
    const user = { id: newId(), name: clean, role, salt, hash, createdAt: nowIso() };
    this.db.users.push(user);
    this.persist();
    return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
  }

  /**
   * Changes one person's name, role or PIN — all of it, or none of it.
   *
   * Every check runs before anything is written. It used to apply each field as
   * it went, so "rename this manager and make them an assistant" on the only
   * manager left the new name sitting in memory after the refusal: the screen
   * showed the old name, the next save wrote the new one, and the two disagreed
   * with no way for anybody to tell which was meant. A PIN that was too short
   * did the same, because hashPin throws after the name has already been taken.
   *
   * Written this way the refusal changes nothing at all, which is the only
   * behaviour a person can reason about.
   */
  updateUser(id, patch = {}) {
    const user = this.db.users.find((candidate) => candidate.id === id);
    if (!user) throw new Error('That person is no longer on the list.');
    if (!patch || typeof patch !== 'object') throw new Error('There is nothing to change.');

    const next = {};

    if (patch.name !== undefined) {
      const clean = asString(patch.name, 60).trim();
      if (!clean) throw new Error('Give this person a name.');
      const clash = this.db.users.find(
        (u) => u.id !== id && u.name.toLowerCase() === clean.toLowerCase(),
      );
      if (clash) throw new Error(`There is already someone called "${clean}".`);
      next.name = clean;
    }

    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw new Error(`"${patch.role}" is not a role MyVault knows.`);
      // Demoting the last admin would leave nobody able to promote anyone.
      if (user.role === 'admin' && patch.role !== 'admin' && this.adminCount() === 1) {
        throw new Error('This is the only manager. Make somebody else a manager first.');
      }
      next.role = patch.role;
    }

    if (patch.pin !== undefined) {
      const taken = this.db.users.find((u) => u.id !== id && verifyPin(patch.pin, u));
      if (taken) throw new Error('Somebody already uses that PIN. Choose another.');
      // Throws on a PIN that is too short, too long or not digits — before this
      // function has touched anything.
      const { salt, hash } = hashPin(patch.pin);
      next.salt = salt;
      next.hash = hash;
    }

    Object.assign(user, next);
    this.persist();
    return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
  }

  deleteUser(id) {
    const user = this.db.users.find((candidate) => candidate.id === id);
    if (!user) throw new Error('That person is no longer on the list.');
    if (user.role === 'admin' && this.adminCount() === 1) {
      throw new Error('This is the only manager. MyVault would be left with nobody in charge.');
    }
    this.db.users = this.db.users.filter((candidate) => candidate.id !== id);
    this.persist();
    return this.listUsers();
  }

  adminCount() {
    return this.db.users.filter((user) => user.role === 'admin').length;
  }

  /** Managers, oldest first — the first one is who recovery hands the shop back to. */
  admins() {
    return this.db.users
      .filter((user) => user.role === 'admin')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  // ----------------------------------------------------------------- recovery

  /**
   * Mints a recovery code, returning it in the clear exactly once.
   *
   * Only the hash is kept, so this is the single moment the code exists in a
   * readable form. If the shop loses the piece of paper, the answer is to
   * generate another one, not to look the old one up — there is nothing to look
   * up.
   */
  issueRecoveryCode() {
    const code = generateRecoveryCode();
    const { salt, hash } = hashRecoveryCode(code);
    this.db.recovery = { salt, hash, createdAt: nowIso() };
    this.persist();
    return code;
  }

  /** Whether a code exists at all, without saying anything about what it is. */
  recoveryStatus() {
    return {
      exists: Boolean(this.db.recovery),
      createdAt: this.db.recovery?.createdAt || '',
    };
  }

  /**
   * Spends the recovery code to put a new PIN on the shop's oldest manager.
   *
   * The oldest manager is the account created during setup — the owner's own.
   * Whoever holds the code is by definition the owner, so they are told whose
   * PIN they have just changed rather than being left to guess.
   *
   * The code is single-use: a slip of paper that has already been used is worth
   * nothing, and a fresh one is issued in its place so the shop is never left
   * without a way back.
   */
  useRecoveryCode(code, newPin) {
    if (!this.db.recovery) {
      throw new Error('This copy of MyVault has no recovery code set up.');
    }
    if (!verifyRecoveryCode(code, this.db.recovery)) {
      throw new Error('That recovery code was not recognised.');
    }
    if (!isValidPin(newPin)) {
      throw new Error('Choose a new PIN of 4 to 12 digits.');
    }

    const [manager] = this.admins();
    if (!manager) throw new Error('There is no manager account to restore.');

    // A PIN somebody else already uses would sign the wrong person in.
    const taken = this.db.users.find((u) => u.id !== manager.id && verifyPin(newPin, u));
    if (taken) throw new Error('Somebody already uses that PIN. Choose another.');

    const { salt, hash } = hashPin(newPin);
    manager.salt = salt;
    manager.hash = hash;

    const nextCode = generateRecoveryCode();
    const minted = hashRecoveryCode(nextCode);
    this.db.recovery = { salt: minted.salt, hash: minted.hash, createdAt: nowIso() };
    this.persist();

    return { user: { id: manager.id, name: manager.name, role: manager.role }, nextCode };
  }

  /**
   * Turns staff roles off entirely.
   *
   * A one-person shop that set this up and then found the daily PIN a nuisance
   * needs a way out that is not "edit the JSON file". Their stock is untouched;
   * only the staff list and the recovery code go, and MyVault opens straight
   * into the stock again the way it did before.
   */
  disableStaff() {
    this.db.users = [];
    this.db.recovery = null;
    this.persist();
    return this.listUsers();
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
    // A supplier's spreadsheet with its columns lined up one to the left will
    // put prices in the cost box and costs in the price box across the whole
    // shop, in one press, with no way back. The copy costs a few milliseconds
    // and is the difference between a mistake and a disaster.
    this.snapshot('before-import');

    const result = {
      added: 0, updated: 0, skipped: 0, newCategories: 0, newFields: 0,
      /** Columns that could not become details because the ceiling was reached. */
      droppedColumns: [],
    };
    /** Held back until the import has been saved, so a failure part-way through
     * does not leave a history of stock the file never received. */
    const moved = [];
    const core = new Set([
      'name', 'barcode', 'sku', 'category', 'quantity', 'price', 'cost',
      'low stock', 'lowstock', 'low stock threshold', 'supplier', 'service', 'notes',
    ]);

    /** "yes", "true", "1", "x" — whatever a spreadsheet put in the box. */
    const isYes = (value) => ['yes', 'y', 'true', '1', 'x', 'service'].includes(
      String(value ?? '').trim().toLowerCase(),
    );

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
        // Read back so a round trip through a spreadsheet does not quietly turn
        // the shop's own labour into stock it thinks is sitting on a shelf.
        service: isYes(lower.service),
        notes: asString(lower.notes, 2000),
        custom,
      };

      const existing = payload.barcode ? itemByBarcode.get(payload.barcode) : null;
      if (existing) {
        const before = existing.quantity;
        const index = this.db.items.findIndex((i) => i.id === existing.id);
        const merged = this.normalizeItem({
          ...existing,
          ...payload,
          custom: { ...existing.custom, ...custom },
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nowIso(),
        });
        this.db.items[index] = merged;
        result.updated += 1;
        if (merged.quantity !== before) {
          moved.push({
            itemId: merged.id,
            itemName: merged.name,
            delta: merged.quantity - before,
            quantityAfter: merged.quantity,
            reason: 'import',
            price: merged.price,
            cost: merged.cost,
            vatRate: this.vatRateFor(merged),
          });
        }
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
        if (item.quantity > 0) {
          moved.push({
            itemId: item.id,
            itemName: item.name,
            delta: item.quantity,
            quantityAfter: item.quantity,
            reason: 'import',
            price: item.price,
            cost: item.cost,
            vatRate: this.vatRateFor(item),
          });
        }
      }
    }

    this.persist();
    // One save for the whole spreadsheet, then the history. A five-thousand-row
    // import is five thousand appends, which is the cheap part; it is the single
    // persist() above that would have been five thousand file rewrites.
    for (const entry of moved) this.logMovement(entry);
    return result;
  }
}

module.exports = {
  Store,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  UPDATE_MODES,
  normalizeSettings,
  FIELD_TYPES,
  STANDARD_FIELDS,
  MAX_CUSTOM_FIELDS,
  ACCENTS,
  DENSITIES,
  emptyDatabase,
};
