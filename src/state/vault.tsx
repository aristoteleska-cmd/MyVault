import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppInfo,
  AuthState,
  Capability,
  Role,
  StaffMember,
  Category,
  Client,
  ClientHistory,
  CustomField,
  Database,
  FieldType,
  Item,
  Movement,
  PdfInvoiceResult,
  ReorderList,
  Settings,
  StatsReport,
  StockTakeProgress,
  DraftDocument,
  PostedDocument,
  VatPeriod,
  VatReport,
  PriceAdvice,
  PriceReview,
  DeliveryReview,
  BackupStatus,
  UpdateStatus,
} from '../types';
import type { ImportResult, Result } from '../bridge';
import type { TranslationKey } from '../i18n/locales/en';

/**
 * A toast holds a translation key rather than a finished sentence, so the text
 * is produced in the current language at the moment it is shown.
 */
export interface Toast {
  id: number;
  key: TranslationKey;
  vars?: Record<string, string | number>;
  /** Used for messages that come back from the main process already worded. */
  raw?: string;
  tone: 'info' | 'success' | 'error';
  action?: { labelKey: TranslationKey; run: () => void };
}

interface VaultValue {
  ready: boolean;
  loadError: string | null;
  db: Database;
  info: AppInfo | null;
  toasts: Toast[];
  /** Set after a CSV import so the UI can word the summary in its own language. */
  importSummary: ImportResult | null;
  clearImportSummary: () => void;
  /** Shows an already-worded import summary produced by the UI. */
  notifyImport: (summary: string) => void;
  notify: (
    key: TranslationKey,
    vars?: Record<string, string | number>,
    tone?: Toast['tone'],
    action?: Toast['action'],
  ) => void;
  dismissToast: (id: number) => void;

  addItem: (input: Partial<Item>) => Promise<Item | null>;
  updateItem: (id: string, patch: Partial<Item>) => Promise<Item | null>;
  adjustStock: (id: string, delta: number) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<void>;

  /**
   * The customer currently at the counter, or empty for nobody in particular.
   *
   * This is how a sale gets attached to a client without asking a question on
   * every press of the minus button: the person serving picks the regular once,
   * rings their things through, and clears it. Most shops will leave it empty
   * most of the time, and that is a perfectly good answer.
   */
  serving: string;
  setServing: (clientId: string) => void;

  addClient: (input: Partial<Client>) => Promise<Client | null>;
  updateClient: (id: string, patch: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  clientHistory: (id: string) => Promise<ClientHistory | null>;

  /** Both already summed on the other side of the bridge. */
  statsReport: (range?: { from?: string; to?: string }) => Promise<StatsReport | null>;
  recentMovements: (range?: { from?: string; to?: string; limit?: number })
    => Promise<Movement[] | null>;
  reorderList: (options?: { days?: number; cover?: number }) => Promise<ReorderList | null>;

  /**
   * Margins, and what the shop usually pays. Read-only: applyPrice is an
   * ordinary product edit, not a separate power.
   */
  priceReview: (options?: { limit?: number }) => Promise<PriceReview | null>;
  priceAdvice: (id: string) => Promise<PriceAdvice | null>;
  applyPrice: (id: string, price: number) => Promise<Item | null>;

  /** Invoices and delivery notes. Posting one moves all its stock at once. */
  drafts: DraftDocument[];
  refreshDrafts: () => Promise<void>;
  startDoc: (kind: 'in' | 'out') => Promise<DraftDocument | null>;
  updateDoc: (id: string, patch: Partial<DraftDocument>) => Promise<DraftDocument | null>;
  setDocLine: (id: string, line: {
    itemId: string; quantity: number; unitPrice?: number | string;
    discount?: number | string; vatRate?: number | string; lineId?: number;
  }) => Promise<DraftDocument | null>;
  removeDocLine: (id: string, index: number) => Promise<DraftDocument | null>;
  discardDoc: (id: string) => Promise<void>;
  /**
   * Posts the paper, and hands back which of its lines came in at a price the
   * shop does not usually pay. Null if the post was refused.
   */
  postDoc: (id: string) => Promise<DeliveryReview | null>;
  voidDoc: (id: string) => Promise<boolean>;
  listDocs: (options?: { limit?: number }) => Promise<PostedDocument[] | null>;
  importDocCsv: (id: string) => Promise<DraftDocument | null>;
  /** Reads a supplier's PDF invoice onto the draft, and hands back what it read. */
  importDocPdf: (id: string) => Promise<PdfInvoiceResult | null>;

  /** What the shop owes, and the calendar periods it can be filed for. */
  vatReport: (range?: { from?: string; to?: string }) => Promise<VatReport | null>;
  vatPeriods: () => Promise<{ periods: Record<string, VatPeriod>; suggestedRates: number[] } | null>;

  /** Something came back over the counter: stock returns, money goes out. */
  returnItem: (id: string, quantity: number) => Promise<void>;

  /** Counting the shelves. The count is saved as it is typed. */
  startStockTake: (categoryId: string) => Promise<StockTakeProgress | null>;
  stockTakeProgress: () => Promise<StockTakeProgress | null>;
  countStockTake: (itemId: string, counted: number | null) => Promise<StockTakeProgress | null>;
  cancelStockTake: () => Promise<void>;
  applyStockTake: () => Promise<{ corrected: number; missingUnits: number; shrinkage: number } | null>;

  /** Saves one of MyVault's own documents as a PDF. Returns the path, or null. */
  printPdf: (request: {
    kind: 'stocktake' | 'reorder' | 'inventory' | 'vat' | 'prices';
    fileName?: string;
    payload: Record<string, unknown>;
  }) => Promise<string | null>;

  backupStatus: BackupStatus | null;
  refreshBackupStatus: () => Promise<void>;
  chooseBackupFolder: () => Promise<void>;
  forgetBackupFolder: () => Promise<void>;
  backupNow: () => Promise<void>;
  /** Puts away the notice that movements could not be written down. */
  clearHistoryTrouble: () => Promise<void>;

  addCategory: (name: string, color: string) => Promise<Category | null>;
  updateCategory: (id: string, patch: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  addField: (input: {
    name: string;
    type: FieldType;
    options?: string[];
    showInTable?: boolean;
  }) => Promise<boolean>;
  updateField: (id: string, patch: Partial<CustomField>) => Promise<void>;
  deleteField: (id: string) => Promise<void>;
  moveField: (id: string, direction: 'up' | 'down') => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  /** Null until the main process has reported in. */
  update: UpdateStatus | null;
  /** Reads a barcode from a picture; null if cancelled or nothing was found. */
  scanBarcodePhoto: () => Promise<string | null>;

  auth: AuthState;
  /**
   * Whether the person at the screen may do this.
   *
   * Only ever used to decide what to show. The main process checks the same
   * thing again on the far side of the bridge, which is what actually stops it.
   */
  can: (capability: Capability) => boolean;
  signIn: (pin: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  createFirstAdmin: (input: { name: string; pin: string }) => Promise<boolean>;
  /** Non-empty only while a newly minted code is waiting to be written down. */
  recoveryCode: string;
  clearRecoveryCode: () => void;
  recoverWithCode: (code: string, pin: string) => Promise<boolean>;
  newRecoveryCode: () => Promise<void>;
  disableStaff: () => Promise<void>;

  staff: StaffMember[];
  refreshStaff: () => Promise<void>;
  addStaff: (input: { name: string; role: Role; pin: string }) => Promise<boolean>;
  updateStaff: (id: string, patch: { name?: string; role?: Role; pin?: string }) => Promise<boolean>;
  removeStaff: (id: string) => Promise<void>;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;

  exportCsv: () => Promise<void>;
  importCsv: () => Promise<void>;
  backup: () => Promise<void>;
  restore: () => Promise<void>;
  openDataFolder: () => Promise<void>;
}

const emptyDb: Database = {
  schemaVersion: 1,
  createdAt: '',
  settings: {
    currency: '€',
    language: '',
    theme: 'system',
    accent: 'blue',
    density: 'comfortable',
    zoom: 1,
    defaultLowStockThreshold: 5,
    shopName: '',
    dateFormat: 'dd/MM/yyyy',
    backupFolder: '',
    vatEnabled: false,
    vatRate: 24,
    pricesIncludeVat: true,
    costsIncludeVat: false,
    targetMargin: 0,
    priceRounding: 'nearest05',
    updates: 'off',
  },
  categories: [],
  customFields: [],
  clients: [],
  stockTake: null,
  drafts: [],
  items: [],
};

const VaultContext = createContext<VaultValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(emptyDb);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [importSummary, setImportSummary] = useState<ImportResult | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // Assume nothing until the main process says otherwise: unlocked, but with no
  // capabilities, so a flash of buttons cannot appear before the answer lands.
  const [auth, setAuth] = useState<AuthState>({
    locked: false,
    hasRecoveryCode: false,
    signedIn: false,
    role: null,
    user: null,
    capabilities: [],
    roles: ['admin', 'senior', 'junior'],
    staffCount: 0,
  });
  const [staff, setStaff] = useState<StaffMember[]>([]);
  // Who is at the counter. Deliberately not saved anywhere: it belongs to this
  // customer, not to this shop, and the next person to open MyVault should not
  // find yesterday's regular still selected.
  const [serving, setServing] = useState('');
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [drafts, setDrafts] = useState<DraftDocument[]>([]);
  // Held only long enough to be shown and written down.
  const [recoveryCode, setRecoveryCode] = useState('');
  const toastId = useRef(0);

  const clearImportSummary = useCallback(() => setImportSummary(null), []);
  const clearRecoveryCode = useCallback(() => setRecoveryCode(''), []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (
      key: TranslationKey,
      vars?: Record<string, string | number>,
      tone: Toast['tone'] = 'info',
      action?: Toast['action'],
    ) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [...current.slice(-3), { id, key, vars, tone, action }]);
      // Give people longer to react when there is a button to press.
      window.setTimeout(() => dismissToast(id), action ? 9000 : 4500);
    },
    [dismissToast],
  );

  const notifyImport = useCallback(
    (summary: string) => notify('toast.imported', { summary }, 'success'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** For text that arrives already worded from the main process. */
  const notifyRaw = useCallback(
    (raw: string, tone: Toast['tone'] = 'error') => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [
        ...current.slice(-3),
        { id, key: 'toast.genericError' as TranslationKey, raw, tone },
      ]);
      window.setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  /** Unwraps the {ok,data} envelope and surfaces failures as a toast. */
  const run = useCallback(
    async <T,>(promise: Promise<Result<T>>): Promise<T | null> => {
      try {
        const result = await promise;
        if (!result?.ok) {
          if (result?.error) notifyRaw(result.error);
          else notify('toast.genericError', undefined, 'error');
          return null;
        }
        return (result.data ?? null) as T | null;
      } catch (error) {
        notifyRaw(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [notify, notifyRaw],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!window.myvault) {
        setLoadError('splash.noBridge');
        return;
      }
      const [authResult, appInfo] = await Promise.all([
        window.myvault.auth.state(),
        window.myvault.getInfo(),
      ]);
      if (cancelled) return;

      if (authResult.ok && authResult.data) setAuth(authResult.data);

      // The installer may have created the manager before the window existed,
      // in which case a recovery code is waiting to be written down.
      const waiting = await window.myvault.auth.pendingRecoveryCode();
      if (!cancelled && waiting.ok && waiting.data) setRecoveryCode(waiting.data);
      if (appInfo.ok && appInfo.data) setInfo(appInfo.data);

      // With staff roles set up, the stock is refused until somebody signs in —
      // which is the point. The sign-in screen is what the shop sees first.
      const needsSignIn = authResult.ok && authResult.data
        ? authResult.data.locked && !authResult.data.signedIn
        : false;

      if (!needsSignIn) {
        const state = await window.myvault.getState();
        if (cancelled) return;
        if (!state.ok || !state.data) {
          setLoadError(state.error || 'splash.noFile');
          return;
        }
        setDb(state.data);
        // Three different bad mornings, each of which the shop has to be told
        // about plainly rather than left to work out from a number looking odd.
        if (state.data.recoveredBackup) {
          // The data file could not be read and a backup was put back in its
          // place. Anything entered after that copy was taken is gone, so the
          // date on it is the important part of the message.
          notify('toast.recoveredBackup', {
            when: new Date(state.data.recoveredBackup.at).toLocaleString(),
            count: state.data.recoveredBackup.items,
          }, 'error');
        } else if (state.data.recoveredFrom) {
          notify('toast.recovered', undefined, 'error');
        }
        if (state.data.historyTrouble?.lost) {
          // Stock moved and the history could not be written. The counts are
          // right; the takings and the VAT return are missing those movements.
          notify('toast.historyLost', { count: state.data.historyTrouble.lost }, 'error');
        }
      }

      setReady(true);
    })();

    return () => { cancelled = true; };
  }, [notify]);

  // ------------------------------------------------------------------ items

  const replaceItem = useCallback((item: Item) => {
    setDb((current) => {
      const index = current.items.findIndex((i) => i.id === item.id);
      if (index === -1) return { ...current, items: [...current.items, item] };
      const items = [...current.items];
      items[index] = item;
      return { ...current, items };
    });
  }, []);

  const addItem = useCallback(
    async (input: Partial<Item>) => {
      const item = await run(window.myvault.items.add(input));
      if (item) {
        replaceItem(item);
        notify('toast.added', { name: item.name }, 'success');
      }
      return item;
    },
    [run, replaceItem, notify],
  );

  const updateItem = useCallback(
    async (id: string, patch: Partial<Item>) => {
      const item = await run(window.myvault.items.update(id, patch));
      if (item) {
        replaceItem(item);
        notify('toast.saved', { name: item.name }, 'success');
      }
      return item;
    },
    [run, replaceItem, notify],
  );

  const adjustStock = useCallback(
    async (id: string, delta: number) => {
      // A fall is a sale and goes against whoever is being served; a rise is a
      // delivery, which belongs to no customer. The main process decides this
      // again for itself — this is only so the history reads correctly.
      const item = await run(window.myvault.items.adjust(id, delta, {
        reason: delta < 0 ? 'sale' : 'delivery',
        clientId: delta < 0 ? serving : '',
      }));
      if (item) replaceItem(item);
    },
    [run, replaceItem, serving],
  );

  const deleteItems = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const confirmed = await run(window.myvault.confirmDelete(ids.length));
      if (!confirmed) return;

      const removed = await run(window.myvault.items.remove(ids));
      if (!removed) return;

      setDb((current) => ({
        ...current,
        items: current.items.filter((item) => !ids.includes(item.id)),
      }));

      notify(
        removed.length === 1 ? 'toast.deleted' : 'toast.deletedMany',
        removed.length === 1 ? { name: removed[0].name } : { count: removed.length },
        'info',
        {
          labelKey: 'toast.undo',
          run: async () => {
            const restored = await run(window.myvault.items.restore(removed));
            if (restored) {
              setDb((current) => ({ ...current, items: [...current.items, ...restored] }));
              notify('toast.restored', undefined, 'success');
            }
          },
        },
      );
    },
    [run, notify],
  );

  // ------------------------------------------------------------- categories

  const addCategory = useCallback(
    async (name: string, color: string) => {
      const category = await run(window.myvault.categories.add({ name, color }));
      if (category) {
        setDb((current) =>
          current.categories.some((c) => c.id === category.id)
            ? current
            : { ...current, categories: [...current.categories, category] },
        );
      }
      return category;
    },
    [run],
  );

  const updateCategory = useCallback(
    async (id: string, patch: Partial<Category>) => {
      const category = await run(window.myvault.categories.update(id, patch));
      if (category) {
        setDb((current) => ({
          ...current,
          categories: current.categories.map((c) => (c.id === id ? category : c)),
        }));
      }
    },
    [run],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const state = await run(window.myvault.categories.remove(id));
      if (state) {
        setDb(state);
        notify('toast.categoryRemoved', undefined, 'info');
      }
    },
    [run, notify],
  );

  // ---------------------------------------------------------------- clients

  const addClient = useCallback(
    async (input: Partial<Client>) => {
      const client = await run(window.myvault.clients.add(input));
      if (client) {
        setDb((current) => ({ ...current, clients: [...current.clients, client] }));
        notify('toast.clientAdded', { name: client.name }, 'success');
      }
      return client;
    },
    [run, notify],
  );

  const updateClient = useCallback(
    async (id: string, patch: Partial<Client>) => {
      const client = await run(window.myvault.clients.update(id, patch));
      if (client) {
        setDb((current) => ({
          ...current,
          clients: current.clients.map((c) => (c.id === id ? client : c)),
        }));
      }
    },
    [run],
  );

  const deleteClient = useCallback(
    async (id: string) => {
      const clients = await run(window.myvault.clients.remove(id));
      if (!clients) return;
      setDb((current) => ({ ...current, clients }));
      // Whoever was being served may be the person just removed.
      setServing((current) => (current === id ? '' : current));
      notify('toast.clientRemoved', undefined, 'info');
    },
    [run, notify],
  );

  const clientHistory = useCallback(
    async (id: string) => run(window.myvault.clients.history(id, { limit: 100 })),
    [run],
  );

  // ------------------------------------------------------------- statistics

  const statsReport = useCallback(
    async (range?: { from?: string; to?: string }) => run(window.myvault.stats.report(range)),
    [run],
  );

  const recentMovements = useCallback(
    async (range?: { from?: string; to?: string; limit?: number }) =>
      run(window.myvault.stats.movements(range)),
    [run],
  );

  const refreshDrafts = useCallback(async () => {
    const list = await run(window.myvault.docs.drafts());
    if (list) setDrafts(list);
  }, [run]);

  const startDoc = useCallback(async (kind: 'in' | 'out') => {
    const draft = await run(window.myvault.docs.start({ kind }));
    if (draft) setDrafts((current) => [...current, draft]);
    return draft;
  }, [run]);

  const replaceDraft = useCallback((draft: DraftDocument) => {
    setDrafts((current) => current.map((d) => (d.id === draft.id ? draft : d)));
  }, []);

  const updateDoc = useCallback(async (id: string, patch: Partial<DraftDocument>) => {
    const draft = await run(window.myvault.docs.update(id, patch));
    if (draft) replaceDraft(draft);
    return draft;
  }, [run, replaceDraft]);

  const setDocLine = useCallback(async (id: string, line: {
    itemId: string; quantity: number; unitPrice?: number | string;
    vatRate?: number | string; lineId?: number;
  }) => {
    const draft = await run(window.myvault.docs.setLine(id, line));
    if (draft) replaceDraft(draft);
    return draft;
  }, [run, replaceDraft]);

  const removeDocLine = useCallback(async (id: string, index: number) => {
    const draft = await run(window.myvault.docs.removeLine(id, index));
    if (draft) replaceDraft(draft);
    return draft;
  }, [run, replaceDraft]);

  const discardDoc = useCallback(async (id: string) => {
    const list = await run(window.myvault.docs.discard(id));
    if (list) setDrafts(list);
  }, [run]);

  const postDoc = useCallback(async (id: string) => {
    const result = await run(window.myvault.docs.post(id));
    if (!result) return null;
    if (result.state) setDb(result.state);
    setDrafts((current) => current.filter((d) => d.id !== id));
    notify('toast.docPosted', { count: result.moved }, 'success');
    // Handed back rather than announced in a toast. A cost that moved is worth a
    // decision, and a decision needs the figures on screen next to a button —
    // not a message that disappears after four seconds.
    return result.prices ?? { lines: [] };
  }, [run, notify]);

  const voidDoc = useCallback(async (id: string) => {
    const result = await run(window.myvault.docs.void(id));
    if (!result) return false;
    if (result.state) setDb(result.state);
    notify('toast.docVoided', undefined, 'info');
    return true;
  }, [run, notify]);

  const listDocs = useCallback(
    async (options?: { limit?: number }) => run(window.myvault.docs.list(options)),
    [run],
  );

  const importDocCsv = useCallback(async (id: string) => {
    const result = await run(window.myvault.docs.importCsv(id));
    if (!result || result.canceled) return null;
    if (result.draft) replaceDraft(result.draft);
    const missed = result.unmatched?.length ?? 0;
    notify(missed ? 'toast.docImportedSome' : 'toast.docImported',
      { count: result.added ?? 0, missed }, missed ? 'info' : 'success');
    return result.draft ?? null;
  }, [run, replaceDraft, notify]);

  const importDocPdf = useCallback(async (id: string) => {
    const result = await run(window.myvault.docs.importPdf(id));
    if (!result || result.canceled) return null;
    if (result.draft) replaceDraft(result.draft);
    const missed = result.unmatched?.length ?? 0;
    notify(missed ? 'toast.docImportedSome' : 'toast.docImported',
      { count: result.added ?? 0, missed }, missed ? 'info' : 'success');
    return result;
  }, [run, replaceDraft, notify]);

  const vatReport = useCallback(
    async (range?: { from?: string; to?: string }) => run(window.myvault.vat.report(range)),
    [run],
  );

  const vatPeriods = useCallback(
    async () => run(window.myvault.vat.periods()),
    [run],
  );

  const reorderList = useCallback(
    async (options?: { days?: number; cover?: number }) =>
      run(window.myvault.stats.reorder(options)),
    [run],
  );

  // ----------------------------------------------------------------- prices

  const priceReview = useCallback(
    async (options?: { limit?: number }) => run(window.myvault.pricing.review(options)),
    [run],
  );

  const priceAdvice = useCallback(
    async (id: string) => run(window.myvault.pricing.advice(id)),
    [run],
  );

  /**
   * Takes a suggestion and makes it the price.
   *
   * Nothing about this is special: it is the same edit as typing the number into
   * the product, which is why it goes through updateItem rather than a channel of
   * its own. A suggestion the shop never presses changes nothing at all.
   */
  const applyPrice = useCallback(async (id: string, price: number) => {
    const item = await updateItem(id, { price });
    if (item) notify('toast.priceApplied', { name: item.name }, 'success');
    return item;
  }, [updateItem, notify]);

  // ---------------------------------------------------------------- returns

  const returnItem = useCallback(
    async (id: string, quantity: number) => {
      const amount = Math.max(1, Math.round(quantity) || 1);
      const item = await run(window.myvault.items.adjust(id, amount, {
        reason: 'return',
        clientId: serving,
      }));
      if (item) {
        replaceItem(item);
        notify('toast.returned', { name: item.name, count: amount }, 'success');
      }
    },
    [run, replaceItem, notify, serving],
  );

  // ------------------------------------------------------------- stock take

  const startStockTake = useCallback(async (categoryId: string) => {
    const started = await run(window.myvault.stocktake.start({ categoryId }));
    if (!started) return null;
    return run(window.myvault.stocktake.progress());
  }, [run]);

  const stockTakeProgress = useCallback(
    async () => run(window.myvault.stocktake.progress()),
    [run],
  );

  const countStockTake = useCallback(
    async (itemId: string, counted: number | null) =>
      run(window.myvault.stocktake.count(itemId, counted)),
    [run],
  );

  const cancelStockTake = useCallback(async () => {
    await run(window.myvault.stocktake.cancel());
    setDb((current) => ({ ...current, stockTake: null }));
  }, [run]);

  const applyStockTake = useCallback(async () => {
    const result = await run(window.myvault.stocktake.apply());
    if (!result) return null;
    if (result.state) setDb(result.state);
    notify('toast.stockTakeApplied', { count: result.corrected }, 'success');
    return result;
  }, [run, notify]);

  // ---------------------------------------------------------------- printing

  const printPdf = useCallback(async (request: {
    kind: 'stocktake' | 'reorder' | 'inventory' | 'vat' | 'prices';
    fileName?: string;
    payload: Record<string, unknown>;
  }) => {
    const result = await run(window.myvault.print.pdf(request));
    if (!result || result.canceled || !result.filePath) return null;
    notify('toast.pdfSaved', { path: result.filePath }, 'success');
    return result.filePath;
  }, [run, notify]);

  // --------------------------------------------------------- second backup

  const refreshBackupStatus = useCallback(async () => {
    const status = await run(window.myvault.backup.status());
    if (status) setBackupStatus(status);
  }, [run]);

  const chooseBackupFolder = useCallback(async () => {
    const result = await run(window.myvault.backup.chooseFolder());
    if (!result || result.canceled) return;
    if (result.status) setBackupStatus(result.status);
    if (result.settings) setDb((current) => ({ ...current, settings: result.settings! }));
    notify('toast.backupFolderSet', undefined, 'success');
  }, [run, notify]);

  const forgetBackupFolder = useCallback(async () => {
    const result = await run(window.myvault.backup.forgetFolder());
    if (!result) return;
    setBackupStatus(result.status);
    setDb((current) => ({ ...current, settings: result.settings }));
  }, [run]);

  const backupNow = useCallback(async () => {
    const status = await run(window.myvault.backup.now());
    if (!status) return;
    setBackupStatus(status);
    if (status.error) notifyRaw(status.error);
    else notify('toast.backupMirrored', undefined, 'success');
  }, [run, notify, notifyRaw]);

  const clearHistoryTrouble = useCallback(async () => {
    const result = await window.myvault.backup.acknowledgeHistory();
    if (!result.ok) { notifyRaw(result.error || ''); return; }
    setDb((current) => {
      const next = { ...current };
      delete next.historyTrouble;
      return next;
    });
  }, [notifyRaw]);

  // ----------------------------------------------------------- custom fields

  const addField = useCallback(
    async (input: {
      name: string;
      type: FieldType;
      options?: string[];
      showInTable?: boolean;
    }) => {
      const state = await run(window.myvault.fields.add(input));
      if (state) {
        setDb(state);
        notify('toast.detailAdded', { name: input.name }, 'success');
        return true;
      }
      return false;
    },
    [run, notify],
  );

  const updateField = useCallback(
    async (id: string, patch: Partial<CustomField>) => {
      const state = await run(window.myvault.fields.update(id, patch));
      if (state) setDb(state);
    },
    [run],
  );

  const deleteField = useCallback(
    async (id: string) => {
      const state = await run(window.myvault.fields.remove(id));
      if (state) {
        setDb(state);
        notify('toast.detailRemoved', undefined, 'info');
      }
    },
    [run, notify],
  );

  const moveField = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const state = await run(window.myvault.fields.move(id, direction));
      if (state) setDb(state);
    },
    [run],
  );

  // --------------------------------------------------------------- settings

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const settings = await run(window.myvault.settings.update(patch));
      if (settings) setDb((current) => ({ ...current, settings }));
    },
    [run],
  );

  // ---------------------------------------------------------- import/export

  const exportCsv = useCallback(async () => {
    const result = await run(window.myvault.data.exportCsv());
    if (result && !result.canceled) {
      notify('toast.exported', { count: result.count ?? 0, path: result.filePath ?? '' }, 'success');
    }
  }, [run, notify]);

  const importCsv = useCallback(async () => {
    const result = await run(window.myvault.data.importCsv());
    if (result && !result.canceled) {
      if (result.state) setDb(result.state);
      setImportSummary(result);
    }
  }, [run, notify]);

  const backup = useCallback(async () => {
    const result = await run(window.myvault.data.backup());
    if (result && !result.canceled) notify('toast.backupSaved', { path: result.filePath ?? '' }, 'success');
  }, [run, notify]);

  const restore = useCallback(async () => {
    const result = await run(window.myvault.data.restore());
    if (result && !result.canceled && result.state) {
      setDb(result.state);
      notify('toast.restoreDone', undefined, 'success');
    }
  }, [run, notify]);

  const openDataFolder = useCallback(async () => {
    await run(window.myvault.data.openFolder());
  }, [run]);

  // ------------------------------------------------------------------ staff

  const can = useCallback(
    (capability: Capability) => auth.capabilities.includes(capability),
    [auth.capabilities],
  );

  const signIn = useCallback(async (pin: string) => {
    const next = await run(window.myvault.auth.signIn(pin));
    if (!next) return false;
    setAuth(next);
    // The stock list was refused while nobody was signed in; fetch it now.
    const state = await run(window.myvault.getState());
    if (state) setDb(state);
    notify('toast.signedIn', { name: next.user?.name ?? '' }, 'success');
    return true;
  }, [run, notify]);

  const signOut = useCallback(async () => {
    const next = await run(window.myvault.auth.signOut());
    if (next) {
      setAuth(next);
      setStaff([]);
      // Leave nothing on screen for the next person to read over the counter.
      setDb(emptyDb);
    }
  }, [run]);

  const createFirstAdmin = useCallback(async (input: { name: string; pin: string }) => {
    const next = await run(window.myvault.auth.createFirstAdmin(input));
    if (!next) return false;
    setAuth(next);
    const code = await run(window.myvault.auth.pendingRecoveryCode());
    if (code) setRecoveryCode(code);
    const state = await run(window.myvault.getState());
    if (state) setDb(state);
    return true;
  }, [run]);

  /**
   * Getting back in with the recovery code.
   *
   * On success the shop is signed in as that manager straight away — they have
   * just proved who they are, and a fresh code is minted because the one they
   * used is now spent.
   */
  const recoverWithCode = useCallback(async (code: string, pin: string) => {
    const result = await run(window.myvault.auth.recover({ code, pin }));
    if (!result) return false;
    setAuth(result.auth);
    const next = await run(window.myvault.auth.pendingRecoveryCode());
    if (next) setRecoveryCode(next);
    const state = await run(window.myvault.getState());
    if (state) setDb(state);
    notify('toast.recovered2', { name: result.user.name }, 'success');
    return true;
  }, [run, notify]);

  const newRecoveryCode = useCallback(async () => {
    const status = await run(window.myvault.staff.newRecoveryCode());
    if (!status) return;
    const code = await run(window.myvault.auth.pendingRecoveryCode());
    if (code) setRecoveryCode(code);
    setAuth((current) => ({ ...current, hasRecoveryCode: true }));
  }, [run]);

  const disableStaff = useCallback(async () => {
    const next = await run(window.myvault.staff.disable());
    if (!next) return;
    setAuth(next);
    setStaff([]);
    const state = await run(window.myvault.getState());
    if (state) setDb(state);
  }, [run]);

  const refreshStaff = useCallback(async () => {
    const list = await run(window.myvault.staff.list());
    if (list) setStaff(list);
  }, [run]);

  const addStaff = useCallback(async (input: { name: string; role: Role; pin: string }) => {
    const added = await run(window.myvault.staff.add(input));
    if (!added) return false;
    await refreshStaff();
    const next = await run(window.myvault.auth.state());
    if (next) setAuth(next);
    notify('toast.staffAdded', { name: added.name }, 'success');
    return true;
  }, [run, refreshStaff, notify]);

  const updateStaff = useCallback(async (
    id: string,
    patch: { name?: string; role?: Role; pin?: string },
  ) => {
    const saved = await run(window.myvault.staff.update(id, patch));
    if (!saved) return false;
    await refreshStaff();
    notify('toast.staffSaved', { name: saved.name }, 'success');
    return true;
  }, [run, refreshStaff, notify]);

  const removeStaff = useCallback(async (id: string) => {
    const remaining = await run(window.myvault.staff.remove(id));
    if (!remaining) return;
    setStaff(remaining);
    // Removing yourself signs you out, so ask what is true now rather than
    // assuming the sitting continues.
    const next = await run(window.myvault.auth.state());
    if (next) {
      setAuth(next);
      if (!next.signedIn) setDb(emptyDb);
    }
  }, [run]);

  // ---------------------------------------------------------------- updates

  // Progress arrives unprompted once a download starts, so the listener is set
  // up whether or not updates are switched on — it simply never fires if not.
  useEffect(() => {
    if (!window.myvault?.updates) return undefined;
    void window.myvault.updates.status().then((result) => {
      if (result.ok && result.data) setUpdate(result.data);
    });
    return window.myvault.updates.onStatus(setUpdate);
  }, []);

  const checkForUpdate = useCallback(async () => {
    const status = await run(window.myvault.updates.check());
    if (status) setUpdate(status);
  }, [run]);

  const downloadUpdate = useCallback(async () => {
    const status = await run(window.myvault.updates.download());
    if (status) setUpdate(status);
  }, [run]);

  const installUpdate = useCallback(async () => {
    await run(window.myvault.updates.install());
  }, [run]);

  // ------------------------------------------------------- barcode from photo

  /**
   * Reads a barcode out of a picture the shop chooses. Returns the code, or
   * null if they cancelled or nothing readable was in the frame — the caller
   * decides what to do with it, because registering an item and filling in one
   * field are different jobs.
   */
  const scanBarcodePhoto = useCallback(async (): Promise<string | null> => {
    const picked = await run(window.myvault.data.pickImage());
    if (!picked || picked.canceled || !picked.dataUrl) return null;

    notify('toast.scanReading', undefined, 'info');
    try {
      const { scanImage } = await import('../lib/scan-image');
      const found = await scanImage(picked.dataUrl);
      if (!found) {
        notify('toast.scanNoCode', undefined, 'error');
        return null;
      }
      notify('toast.scanFound', { code: found.text, format: found.format }, 'success');
      return found.text;
    } catch (error) {
      notifyRaw(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [run, notify, notifyRaw]);

  const value = useMemo<VaultValue>(
    () => ({
      ready,
      loadError,
      db,
      info,
      toasts,
      importSummary,
      clearImportSummary,
      notifyImport,
      notify,
      dismissToast,
      addItem,
      updateItem,
      adjustStock,
      deleteItems,
      serving,
      setServing,
      addClient,
      updateClient,
      deleteClient,
      clientHistory,
      statsReport,
      recentMovements,
      reorderList,
      priceReview,
      priceAdvice,
      applyPrice,
      drafts,
      refreshDrafts,
      startDoc,
      updateDoc,
      setDocLine,
      removeDocLine,
      discardDoc,
      postDoc,
      voidDoc,
      listDocs,
      importDocCsv,
      importDocPdf,
      vatReport,
      vatPeriods,
      returnItem,
      startStockTake,
      stockTakeProgress,
      countStockTake,
      cancelStockTake,
      applyStockTake,
      printPdf,
      backupStatus,
      refreshBackupStatus,
      chooseBackupFolder,
      forgetBackupFolder,
      backupNow,
      clearHistoryTrouble,
      addCategory,
      updateCategory,
      deleteCategory,
      addField,
      updateField,
      deleteField,
      moveField,
      updateSettings,
      update,
      scanBarcodePhoto,
      auth,
      can,
      signIn,
      signOut,
      createFirstAdmin,
      recoveryCode,
      clearRecoveryCode,
      recoverWithCode,
      newRecoveryCode,
      disableStaff,
      staff,
      refreshStaff,
      addStaff,
      updateStaff,
      removeStaff,
      checkForUpdate,
      downloadUpdate,
      installUpdate,
      exportCsv,
      importCsv,
      backup,
      restore,
      openDataFolder,
    }),
    [
      ready, loadError, db, info, toasts, importSummary, clearImportSummary, notifyImport,
      notify, dismissToast,
      addItem, updateItem, adjustStock, deleteItems,
      serving, addClient, updateClient, deleteClient, clientHistory,
      statsReport, recentMovements, reorderList, vatReport, vatPeriods, returnItem,
      priceReview, priceAdvice, applyPrice,
      drafts, refreshDrafts, startDoc, updateDoc, setDocLine, removeDocLine,
      discardDoc, postDoc, voidDoc, listDocs, importDocCsv, importDocPdf,
      startStockTake, stockTakeProgress, countStockTake, cancelStockTake, applyStockTake,
      printPdf, backupStatus, refreshBackupStatus, chooseBackupFolder, forgetBackupFolder, backupNow,
      clearHistoryTrouble,
      addCategory, updateCategory, deleteCategory,
      addField, updateField, deleteField, moveField,
      updateSettings, exportCsv, importCsv, backup, restore, openDataFolder,
      update, checkForUpdate, downloadUpdate, installUpdate, scanBarcodePhoto,
      auth, can, signIn, signOut, createFirstAdmin,
      staff, refreshStaff, addStaff, updateStaff, removeStaff,
      recoveryCode, clearRecoveryCode, recoverWithCode, newRecoveryCode, disableStaff,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside <VaultProvider>');
  return context;
}
