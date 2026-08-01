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
import type { Result } from '../bridge';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface VaultValue {
  ready: boolean;
  loadError: string | null;
  db: Database;
  info: AppInfo | null;
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
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
    required?: boolean;
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
    theme: 'system',
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
  const toastId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [...current.slice(-3), { id, message, tone, action }]);
      // Give people longer to react when there is a button to press.
      window.setTimeout(() => dismissToast(id), action ? 9000 : 4500);
    },
    [dismissToast],
  );

  /** Unwraps the {ok,data} envelope and surfaces failures as a toast. */
  const run = useCallback(
    async <T,>(promise: Promise<Result<T>>): Promise<T | null> => {
      try {
        const result = await promise;
        if (!result?.ok) {
          notify(result?.error || 'Something went wrong.', 'error');
          return null;
        }
        return (result.data ?? null) as T | null;
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
        return null;
      }
    },
    [notify],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!window.myvault) {
        setLoadError('MyVault could not reach its local storage layer. Please restart the app.');
        return;
      }
      const [state, appInfo] = await Promise.all([
        window.myvault.getState(),
        window.myvault.getInfo(),
      ]);
      if (cancelled) return;

      if (!state.ok || !state.data) {
        setLoadError(state.error || 'Could not open your inventory file.');
        return;
      }
      setDb(state.data);
      if (appInfo.ok && appInfo.data) setInfo(appInfo.data);
      setReady(true);

      if (state.data.recoveredFrom) {
        notify(
          'Your data file could not be read, so a fresh one was created. The old file is kept in the backups folder.',
          'error',
        );
      }
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
        notify(`"${item.name}" added to your inventory.`, 'success');
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
        notify(`"${item.name}" saved.`, 'success');
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
        removed.length === 1 ? `"${removed[0].name}" deleted.` : `${removed.length} items deleted.`,
        'info',
        {
          label: 'Undo',
          run: async () => {
            const restored = await run(window.myvault.items.restore(removed));
            if (restored) {
              setDb((current) => ({ ...current, items: [...current.items, ...restored] }));
              notify('Restored.', 'success');
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
        notify('Category removed. Its items are still here, just uncategorised.', 'info');
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
      required?: boolean;
      showInTable?: boolean;
    }) => {
      const state = await run(window.myvault.fields.add(input));
      if (state) {
        setDb(state);
        notify(`"${input.name}" is now available on every item.`, 'success');
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
        notify('Detail removed from all items.', 'info');
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
      notify(`${result.count} items exported to ${result.filePath}`, 'success');
    }
  }, [run, notify]);

  const importCsv = useCallback(async () => {
    const result = await run(window.myvault.data.importCsv());
    if (result && !result.canceled) {
      if (result.state) setDb(result.state);
      const parts = [`${result.added ?? 0} added`, `${result.updated ?? 0} updated`];
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.newFields) parts.push(`${result.newFields} new details`);
      notify(`Import finished — ${parts.join(', ')}.`, 'success');
    }
  }, [run, notify]);

  const backup = useCallback(async () => {
    const result = await run(window.myvault.data.backup());
    if (result && !result.canceled) notify(`Backup saved to ${result.filePath}`, 'success');
  }, [run, notify]);

  const restore = useCallback(async () => {
    const result = await run(window.myvault.data.restore());
    if (result && !result.canceled && result.state) {
      setDb(result.state);
      notify('Backup restored.', 'success');
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
      ready, loadError, db, info, toasts, notify, dismissToast,
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
