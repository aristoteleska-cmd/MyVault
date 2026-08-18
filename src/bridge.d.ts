import type {
  AppInfo,
  AuthState,
  BackupStatus,
  Category,
  Client,
  ClientHistory,
  ReorderList,
  DraftDocument,
  PostedDocument,
  VatPeriod,
  VatReport,
  PriceAdvice,
  PriceReview,
  DeliveryReview,
  RoundingStyle,
  StockTake,
  StockTakeProgress,
  CustomField,
  Database,
  FieldType,
  HistoryTrouble,
  Item,
  Movement,
  MovementReason,
  Role,
  Settings,
  StaffMember,
  StatsReport,
  UpdateStatus,
} from './types';

/** Every call crosses the preload bridge and comes back in this envelope. */
export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ImportResult {
  canceled: boolean;
  added?: number;
  updated?: number;
  skipped?: number;
  newCategories?: number;
  newFields?: number;
  /** Columns that could not become details because the ceiling was reached. */
  droppedColumns?: string[];
  state?: Database;
}

export interface ExportResult {
  canceled: boolean;
  filePath?: string;
  count?: number;
}

export interface RestoreResult {
  canceled: boolean;
  state?: Database;
}

export interface PickedImage {
  canceled: boolean;
  /** The picture itself, as a data: URL the window is allowed to render. */
  dataUrl?: string;
  name?: string;
}

export interface MyVaultBridge {
  getInfo(): Promise<Result<AppInfo>>;
  getState(): Promise<Result<Database>>;

  items: {
    add(input: Partial<Item>): Promise<Result<Item>>;
    update(id: string, patch: Partial<Item>): Promise<Result<Item>>;
    adjust(
      id: string,
      delta: number,
      options?: { reason?: MovementReason; clientId?: string },
    ): Promise<Result<Item>>;
    remove(ids: string[]): Promise<Result<Item[]>>;
    restore(items: Item[]): Promise<Result<Item[]>>;
  };

  clients: {
    add(input: Partial<Client>): Promise<Result<Client>>;
    update(id: string, patch: Partial<Client>): Promise<Result<Client>>;
    remove(id: string): Promise<Result<Client[]>>;
    history(id: string, options?: { limit?: number }): Promise<Result<ClientHistory>>;
  };

  stats: {
    report(range?: { from?: string; to?: string }): Promise<Result<StatsReport>>;
    movements(range?: { from?: string; to?: string; limit?: number }): Promise<Result<Movement[]>>;
    reorder(options?: { days?: number; cover?: number }): Promise<Result<ReorderList>>;
  };

  docs: {
    drafts(): Promise<Result<DraftDocument[]>>;
    start(options?: { kind?: 'in' | 'out' }): Promise<Result<DraftDocument>>;
    update(id: string, patch: Partial<DraftDocument>): Promise<Result<DraftDocument>>;
    setLine(id: string, line: {
      itemId: string; quantity: number; unitPrice?: number | string;
      discount?: number | string; vatRate?: number | string; lineId?: number;
    }): Promise<Result<DraftDocument>>;
    removeLine(id: string, index: number): Promise<Result<DraftDocument>>;
    discard(id: string): Promise<Result<DraftDocument[]>>;
    post(id: string): Promise<Result<{
      document: PostedDocument;
      moved: number;
      /** Which lines came in at a different price than usual. Empty for an 'out'. */
      prices: DeliveryReview;
      state: Database;
    }>>;
    void(id: string): Promise<Result<{ document: PostedDocument; moved: number; state: Database }>>;
    list(options?: { limit?: number }): Promise<Result<PostedDocument[]>>;
    importCsv(id: string): Promise<Result<{
      canceled: boolean;
      added?: number;
      unmatched?: { barcode: string; name: string; quantity: number; price: number }[];
      draft?: DraftDocument;
    }>>;
  };

  vat: {
    report(range?: { from?: string; to?: string }): Promise<Result<VatReport>>;
    periods(): Promise<Result<{
      periods: Record<string, VatPeriod>;
      suggestedRates: number[];
    }>>;
  };

  /** Read-only. Nothing here changes a price; the shop saves the product to do that. */
  pricing: {
    review(options?: { limit?: number }): Promise<Result<PriceReview>>;
    advice(id: string): Promise<Result<PriceAdvice | null>>;
    styles(): Promise<Result<{ rounding: RoundingStyle[] }>>;
  };

  stocktake: {
    start(options?: { categoryId?: string }): Promise<Result<StockTake>>;
    progress(): Promise<Result<StockTakeProgress | null>>;
    count(itemId: string, counted: number | null): Promise<Result<StockTakeProgress>>;
    cancel(): Promise<Result<null>>;
    apply(): Promise<Result<{
      corrected: number;
      missingUnits: number;
      extraUnits: number;
      shrinkage: number;
      state: Database;
    }>>;
  };

  print: {
    /** The page is built in the main process — only values cross the bridge. */
    pdf(request: {
      kind: 'stocktake' | 'reorder' | 'inventory' | 'vat' | 'prices';
      fileName?: string;
      payload: Record<string, unknown>;
    }): Promise<Result<{ canceled: boolean; filePath?: string }>>;
  };

  backup: {
    status(): Promise<Result<BackupStatus>>;
    chooseFolder(): Promise<Result<{
      canceled: boolean; status?: BackupStatus; settings?: Settings;
    }>>;
    forgetFolder(): Promise<Result<{ status: BackupStatus; settings: Settings }>>;
    now(): Promise<Result<BackupStatus>>;
    historyStatus(): Promise<Result<HistoryTrouble | null>>;
    acknowledgeHistory(): Promise<Result<null>>;
  };

  categories: {
    add(input: { name: string; color?: string }): Promise<Result<Category>>;
    update(id: string, patch: Partial<Category>): Promise<Result<Category>>;
    remove(id: string): Promise<Result<Database>>;
  };

  fields: {
    add(input: {
      name: string;
      type: FieldType;
      options?: string[];
      showInTable?: boolean;
    }): Promise<Result<Database>>;
    update(id: string, patch: Partial<CustomField>): Promise<Result<Database>>;
    remove(id: string): Promise<Result<Database>>;
    move(id: string, direction: 'up' | 'down'): Promise<Result<Database>>;
  };

  settings: {
    update(patch: Partial<Settings>): Promise<Result<Settings>>;
  };

  auth: {
    state(): Promise<Result<AuthState>>;
    signIn(pin: string): Promise<Result<AuthState>>;
    signOut(): Promise<Result<AuthState>>;
    createFirstAdmin(input: { name: string; pin: string }): Promise<Result<AuthState>>;
    pendingRecoveryCode(): Promise<Result<string>>;
    recoveryStatus(): Promise<Result<{ exists: boolean; createdAt: string }>>;
    recover(input: { code: string; pin: string }): Promise<Result<{
      auth: AuthState;
      user: { id: string; name: string; role: Role };
    }>>;
  };

  staff: {
    list(): Promise<Result<StaffMember[]>>;
    add(input: { name: string; role: Role; pin: string }): Promise<Result<StaffMember>>;
    update(
      id: string,
      patch: { name?: string; role?: Role; pin?: string },
    ): Promise<Result<StaffMember>>;
    remove(id: string): Promise<Result<StaffMember[]>>;
    newRecoveryCode(): Promise<Result<{ exists: boolean; createdAt: string }>>;
    disable(): Promise<Result<AuthState>>;
  };

  updates: {
    status(): Promise<Result<UpdateStatus>>;
    check(): Promise<Result<UpdateStatus>>;
    download(): Promise<Result<UpdateStatus>>;
    install(): Promise<Result<boolean>>;
    onStatus(handler: (status: UpdateStatus) => void): () => void;
  };

  /** Scales the whole interface. Returns the factor actually applied. */
  setZoom(factor: number): number;

  data: {
    exportCsv(): Promise<Result<ExportResult>>;
    importCsv(): Promise<Result<ImportResult>>;
    backup(): Promise<Result<ExportResult>>;
    restore(): Promise<Result<RestoreResult>>;
    openFolder(): Promise<Result<string>>;
    pickImage(): Promise<Result<PickedImage>>;
  };

  confirmDelete(count: number): Promise<Result<boolean>>;

  onMenu(handler: (channel: string) => void): () => void;
}

declare global {
  interface Window {
    myvault: MyVaultBridge;
  }
}
