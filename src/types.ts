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
  supplier: string;
  notes: string;
  custom: Record<string, CustomFieldValue>;
  createdAt: string;
  updatedAt: string;
}

export type ThemeChoice = 'light' | 'dark' | 'system';

export type AccentChoice = 'blue' | 'teal' | 'green' | 'purple' | 'orange' | 'graphite';

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
  /** Off unless the shop deliberately switched it on. */
  updates: UpdateMode;
}

export interface Database {
  schemaVersion: number;
  appVersion?: string;
  createdAt: string;
  settings: Settings;
  categories: Category[];
  customFields: CustomField[];
  items: Item[];
  recoveredFrom?: string;
  downgradedFrom?: number;
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
