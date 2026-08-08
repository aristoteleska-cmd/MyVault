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
  Category,
  CustomField,
  Database,
  FieldType,
  Item,
  Settings,
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
  },
  categories: [],
  customFields: [],
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
  const toastId = useRef(0);

  const clearImportSummary = useCallback(() => setImportSummary(null), []);

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
      const [state, appInfo] = await Promise.all([
        window.myvault.getState(),
        window.myvault.getInfo(),
      ]);
      if (cancelled) return;

      if (!state.ok || !state.data) {
        setLoadError(state.error || 'splash.noFile');
        return;
      }
      setDb(state.data);
      if (appInfo.ok && appInfo.data) setInfo(appInfo.data);
      setReady(true);

      if (state.data.recoveredFrom) notify('toast.recovered', undefined, 'error');
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
      const item = await run(window.myvault.items.adjust(id, delta));
      if (item) replaceItem(item);
    },
    [run, replaceItem],
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
      addCategory,
      updateCategory,
      deleteCategory,
      addField,
      updateField,
      deleteField,
      moveField,
      updateSettings,
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
      addCategory, updateCategory, deleteCategory,
      addField, updateField, deleteField, moveField,
      updateSettings, exportCsv, importCsv, backup, restore, openDataFolder,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside <VaultProvider>');
  return context;
}
