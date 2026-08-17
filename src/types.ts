export type FieldType = 'text' | 'number' | 'select' | 'date' | 'boolean';

export type CustomFieldValue = string | number | boolean;

export interface CustomField {
  id: string;
  name: string;
  type: FieldType;
  options: string[];
  showInTable: boolean;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Item {
  id: string;
  name: string;
  barcode: string;
  sku: string;
  categoryId: string;
  quantity: number;
  price: number;
  cost: number;
  lowStockThreshold: number | null;
  /** Null means the shop's default rate applies. */
  vatRate: number | null;
  supplier: string;
  notes: string;
  custom: Record<string, CustomFieldValue>;
  createdAt: string;
  updatedAt: string;
}

export type ThemeChoice = 'light' | 'dark' | 'system';

export type AccentChoice = 'blue' | 'teal' | 'green' | 'purple' | 'orange' | 'graphite';

/** How a suggested price is rounded: to five cents, to a ,99, or not at all. */
export type RoundingStyle = 'none' | 'nearest05' | 'nearest10' | 'ends9' | 'ends99';

export type DensityChoice = 'comfortable' | 'compact';

export interface Settings {
  currency: string;
  /** Empty means "follow the installer / Windows language". */
  language: string;
  theme: ThemeChoice;
  accent: AccentChoice;
  density: DensityChoice;
  /** Interface scale, 0.8–1.4. Applied through Electron's own zoom factor. */
  zoom: number;
  defaultLowStockThreshold: number;
  shopName: string;
  dateFormat: string;
  /** A second place to mirror backups to. Empty until the shop chooses one. */
  backupFolder: string;
  /** VAT is off until a shop switches it on. */
  vatEnabled: boolean;
  /** The rate most of the shop sells at; individual products may differ. */
  vatRate: number;
  /** In a retail shop the shelf price already contains VAT, so this is true. */
  pricesIncludeVat: boolean;
  /** Supplier invoices are usually net, so this is false. */
  costsIncludeVat: boolean;
  /**
   * The margin the shop wants, as a percentage of the price it charges. Zero
   * means "not set", which is the default — MyVault does not invent a target.
   */
  targetMargin: number;
  /** How a suggested price is rounded off before it is offered. */
  priceRounding: RoundingStyle;
  /** Off unless the shop deliberately switched it on. */
  updates: UpdateMode;
}

/** A customer the shop wants to be able to look up. Only the name is required. */
export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Why the stock moved. The sign of `delta` says which way. */
export type MovementReason =
  | 'sale' | 'return' | 'delivery' | 'correction' | 'stocktake'
  | 'new' | 'import' | 'delete' | 'restore';

/** A count in progress. Saved as it is typed, so a long job survives a restart. */
export interface StockTake {
  startedAt: string;
  by: string;
  categoryId: string;
  counts: Record<string, number>;
}

/** One product that did not match what the file said. */
export interface StockTakeLine {
  id: string;
  name: string;
  barcode: string;
  expected: number;
  counted: number;
  difference: number;
  value: number;
}

export interface StockTakeProgress {
  startedAt: string;
  by: string;
  categoryId: string;
  total: number;
  counted: number;
  remaining: number;
  matching: number;
  differing: number;
  missingUnits: number;
  extraUnits: number;
  shrinkage: number;
  lines: StockTakeLine[];
}

export interface ReorderItem {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
  threshold: number;
  sold: number;
  suggested: number;
  cost: number;
  /** Out of stock, not merely low — a customer is being turned away today. */
  urgent: boolean;
}

export interface ReorderList {
  days: number;
  cover: number;
  generatedAt: string;
  lines: number;
  estimatedCost: number;
  urgent: number;
  suppliers: { supplier: string; items: ReorderItem[]; units: number; cost: number }[];
}

/** One rate's worth of turnover, the way a VAT return is laid out. */
export interface VatRateLine {
  rate: number;
  net: number;
  vat: number;
  gross: number;
  units: number;
}

export interface VatSide {
  rates: VatRateLine[];
  net: number;
  vat: number;
  gross: number;
}

/** A calendar period a return can actually be filed for. */
export interface VatPeriod {
  from: string;
  to: string;
  year: number;
  /** 1–4, or 0 for a whole year. */
  quarter: number;
}

export interface VatReport {
  range: { from: string; to: string };
  enabled: boolean;
  pricesIncludeVat: boolean;
  costsIncludeVat: boolean;
  /** VAT charged to customers. */
  collected: VatSide;
  /** VAT paid to suppliers on stock coming in — deductible. */
  paid: VatSide;
  /** Collected less paid. Negative means the shop is owed, not billed. */
  payable: number;
  /** Movements deliberately left out of the sums — stock takes, write-offs. */
  excluded: { movements: number; units: number };
  /** Stock that moved with no rate recorded, e.g. before VAT was switched on. */
  withoutRate: number;
  movements: number;
}

/**
 * What one product's costs have done, and what the shop could charge.
 *
 * Every money figure is in the same terms the shop enters them: `price` is what
 * is on the shelf label, `netPrice` is what is left of it after VAT. Margins are
 * always on the net, and null rather than zero when there is no price to work
 * them out from.
 */
export interface PriceSuggestion {
  /**
   *   hold     leave the price alone and keep the extra margin
   *   passOn   drop the price to what keeps the margin it used to earn
   *   restore  put the price up to undo a cost rise
   *   target   reach the margin the shop said it wants
   *   cover    stop selling below cost
   */
  kind: 'hold' | 'passOn' | 'restore' | 'target' | 'cover';
  price: number;
  /** What this price would actually earn once rounded — not what was asked for. */
  margin: number | null;
  profit: number;
  /** How far it moves the shelf price. Negative is a price cut. */
  difference: number;
  /** A translation key naming the reason, or empty. */
  note: string;
  /** hold only: what the cheap batch earns above the usual cost. */
  extra?: number;
  /** hold only: the margin this product earned before the cost changed. */
  wasMargin?: number | null;
}

export interface CostChange {
  kind: 'cheaper' | 'dearer';
  /** The usual cost, and what this delivery actually cost. */
  from: number;
  to: number;
  difference: number;
  /** As a percentage of the usual cost, rounded the way it is displayed. */
  percent: number;
  at: string;
  units: number;
  /** Worth across the whole delivery. Negative when the cost went up. */
  saving: number;
}

export interface PriceAdvice {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
  vatRate: number;
  rounding: RoundingStyle;
  price: number;
  netPrice: number;
  cost: number;
  netCost: number;
  margin: number | null;
  markup: number | null;
  /** Per unit, and only the shop's own share of it. */
  profit: number;
  history: {
    deliveries: number;
    last: number | null;
    lastAt: string;
    lastUnits: number;
    usual: number | null;
    lowest: number | null;
    highest: number | null;
  };
  /** Null unless the last delivery moved by more than 5% against the usual. */
  change: CostChange | null;
  /** Selling at or below what it cost. */
  losing: boolean;
  suggestions: PriceSuggestion[];
}

export interface PriceReview {
  /** The shop's own target margin, or 0 when it has not set one. */
  target: number;
  rounding: RoundingStyle;
  generatedAt: string;
  cheaper: PriceAdvice[];
  dearer: PriceAdvice[];
  thin: PriceAdvice[];
  losing: PriceAdvice[];
  counts: {
    cheaper: number; dearer: number; thin: number; losing: number; items: number;
  };
}

/** Which lines on a delivery just came in at a different price than usual. */
export interface DeliveryReview {
  number?: string;
  supplier?: string;
  lines: PriceAdvice[];
  cheaper?: number;
  dearer?: number;
  saving?: number;
}

/** An invoice or delivery note: 'in' brings stock in, 'out' sends it out. */
export type DocumentKind = 'in' | 'out';

export interface DocumentLine {
  itemId: string;
  name: string;
  barcode: string;
  quantity: number;
  /** What the supplier charged, or what the customer was charged. */
  unitPrice: number;
  vatRate: number;
  kind: DocumentKind;
}

export interface DocumentTotals {
  net: number;
  vat: number;
  gross: number;
  units: number;
  lines: number;
}

/** A document being typed. Saved as it is typed, like a stock take. */
export interface DraftDocument {
  id: string;
  kind: DocumentKind;
  number: string;
  supplier: string;
  clientId: string;
  date: string;
  note: string;
  lines: DocumentLine[];
  startedAt: string;
  by: string;
  totals: DocumentTotals;
}

/** One that has been posted: history, never edited, only ever voided. */
export interface PostedDocument extends DraftDocument {
  postedAt: string;
  voided: boolean;
  /** Set on the reversing document, naming the one it cancels. */
  voids?: string;
}

/** How the copy to the shop's second drive is going. */
export interface BackupStatus {
  folder: string;
  configured: boolean;
  /** True when the chosen folder is on the same drive as the data it protects. */
  sameDrive: boolean;
  lastAt: string;
  lastPath: string;
  error: string;
}

/**
 * One line of the shop's history.
 *
 * Kept in its own append-only file rather than in the database, so it costs the
 * same to record the hundred-thousandth sale as the first. The item's name,
 * price and cost are copied in as they stood at the time: a product renamed or
 * marked up later must not change what last month earned.
 */
export interface Movement {
  id: string;
  at: string;
  itemId: string;
  itemName: string;
  delta: number;
  after: number;
  reason: MovementReason;
  price: number;
  cost: number;
  /** The rate in force that day, so a rate change never rewrites a return. */
  vatRate: number;
  clientId: string;
  /** The invoice this movement came from, when it came from one. */
  docId: string;
  by: string;
}

export interface Database {
  schemaVersion: number;
  users?: StaffMember[];
  appVersion?: string;
  createdAt: string;
  settings: Settings;
  categories: Category[];
  customFields: CustomField[];
  clients: Client[];
  stockTake: StockTake | null;
  drafts: DraftDocument[];
  items: Item[];
  recoveredFrom?: string;
  downgradedFrom?: number;
}

/** What is on the shelves right now, and what it is worth. */
export interface StockSnapshot {
  items: number;
  units: number;
  retailValue: number;
  costValue: number;
  potentialProfit: number;
  low: number;
  out: number;
  healthy: number;
  categories: { id: string; name: string; color: string; items: number; units: number; value: number }[];
  mostValuable: { id: string; name: string; quantity: number; value: number }[];
  needsAttention: { id: string; name: string; quantity: number; threshold: number }[];
}

/**
 * The finished statistics screen, summed on the other side of the bridge.
 *
 * Every list in here has a ceiling and the timeline has one point per day or
 * month, so this stays the same size whether the shop has traded for a week or
 * a decade.
 */
export interface StatsReport {
  range: { from: string; to: string; days: number; grouping: 'day' | 'month' };
  stock: StockSnapshot;
  sales: {
    units: number;
    takings: number;
    costOfSales: number;
    profit: number;
    received: number;
    spend: number;
    writtenOff: number;
    movements: number;
  };
  /** The same length of time immediately before, so the screen can say up or down. */
  previous: { units: number; takings: number; profit: number };
  timeline: { key: string; sold: number; takings: number; received: number }[];
  bestSellers: { id: string; name: string; units: number; takings: number }[];
  notMoving: { id: string; name: string; quantity: number; value: number }[];
  topClients: { id: string; name: string; units: number; takings: number; orders: number; lastAt: string }[];
}

/** What one customer has bought: recent lines, totals over everything. */
export interface ClientHistory {
  lines: Movement[];
  /** Net of anything handed back, so it agrees with the statistics screen. */
  units: number;
  spent: number;
  orders: number;
  returned: number;
  refunded: number;
  firstAt: string;
  lastAt: string;
}

export interface AppInfo {
  version: string;
  dataFile: string;
  dataDir: string;
  portable: boolean;
  /** The four details every item always has. */
  standardFields: string[];
  maxCustomFields: number;
  /** True always: the interface itself never makes a network request. */
  offline: boolean;
  /** The only hosts the updater may contact, shown to the shop verbatim. */
  updateHosts: string[];
  systemLocale: string;
}

/**
 * How much MyVault is allowed to do on its own.
 *
 *   off    no network request is ever made
 *   check  look daily and say so, but wait to be told what to do
 *   auto   look, fetch quietly, and swap it in when MyVault is next closed
 */
export type UpdateMode = 'off' | 'check' | 'auto';

/**
 * Where an update check has got to.
 *
 * `unsupported` covers the portable .exe and running from source — neither has
 * an installer to replace.
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error'
  | 'unsupported';

export interface UpdateStatus {
  state: UpdateState;
  reason: string;
  currentVersion: string;
  newVersion: string;
  notes: string;
  percent: number;
  transferred: number;
  total: number;
  checkedAt: string;
  error: string;
  supported: boolean;
  mode: UpdateMode;
  enabled: boolean;
  automatic: boolean;
}

/**
 * Staff separation, not security — see the README. The three roles are ordered
 * most-trusted first, which is also the order they are offered in.
 */
export type Role = 'admin' | 'senior' | 'junior';

export type Capability =
  | 'items.view'
  | 'items.sell'
  | 'items.receive'
  | 'items.create'
  | 'items.edit'
  | 'items.delete'
  | 'categories.manage'
  | 'fields.manage'
  | 'settings.manage'
  | 'data.export'
  | 'data.import'
  | 'staff.manage'
  | 'clients.view'
  | 'clients.manage'
  | 'stats.view'
  | 'vat.view'
  | 'documents.manage'
  | 'items.return'
  | 'stocktake.run'
  | 'pricing.view';

/** A member of staff as the window is allowed to see them: never a PIN. */
export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface AuthState {
  /** False until somebody sets roles up; then MyVault asks for a PIN. */
  locked: boolean;
  /** Whether a way back in exists if every PIN is forgotten. */
  hasRecoveryCode: boolean;
  signedIn: boolean;
  role: Role | null;
  user: { id: string; name: string; role: Role } | null;
  capabilities: Capability[];
  roles: Role[];
  staffCount: number;
}

export type ItemDraft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

export type SearchScope = 'all' | 'name' | 'barcode' | 'category';

export type StockFilter = 'all' | 'in-stock' | 'low' | 'out';

export type SortDirection = 'asc' | 'desc';

/** Built-in sort keys; custom fields are addressed as `custom:<fieldId>`. */
export type SortKey =
  | 'name'
  | 'quantity'
  | 'price'
  | 'value'
  | 'category'
  | 'barcode'
  | 'updatedAt'
  | 'createdAt'
  | `custom:${string}`;

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export interface Filters {
  query: string;
  scope: SearchScope;
  categoryIds: string[];
  stock: StockFilter;
  customValues: Record<string, string>;
}
