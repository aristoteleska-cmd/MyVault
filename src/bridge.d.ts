import type {
  AppInfo,
  AuthState,
  Category,
  CustomField,
  Database,
  FieldType,
  Item,
  Role,
  Settings,
  StaffMember,
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
    adjust(id: string, delta: number): Promise<Result<Item>>;
    remove(ids: string[]): Promise<Result<Item[]>>;
    restore(items: Item[]): Promise<Result<Item[]>>;
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
