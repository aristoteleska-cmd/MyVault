import { useCallback, useEffect, useRef, useState } from 'react';
import { useVault } from './state/vault';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import type { Filters, Item, SortState } from './types';
import { Icon, type IconName } from './components/Icon';
import { InventoryView } from './components/InventoryView';
import { CategoriesView } from './components/CategoriesView';
import { FieldsView } from './components/FieldsView';
import { SettingsView } from './components/SettingsView';
import { ItemDialog } from './components/ItemDialog';
import { Toasts } from './components/Toasts';

type ViewName = 'inventory' | 'categories' | 'fields' | 'settings';

const NAV: { id: ViewName; label: string; icon: IconName }[] = [
  { id: 'inventory', label: 'Stock', icon: 'box' },
  { id: 'categories', label: 'Categories', icon: 'tag' },
  { id: 'fields', label: 'Extra details', icon: 'fields' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const initialFilters: Filters = {
  query: '',
  scope: 'all',
  categoryIds: [],
  stock: 'all',
  customValues: {},
};

export function App() {
  const { ready, loadError, db, info, notify } = useVault();
  const [view, setView] = useState<ViewName>('inventory');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [dialogItem, setDialogItem] = useState<Item | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Follow the theme the shop picked, or Windows' own setting.
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const theme = db.settings.theme === 'system'
        ? (media.matches ? 'dark' : 'light')
        : db.settings.theme;
      root.setAttribute('data-theme', theme);
      root.style.colorScheme = theme;
    };

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [db.settings.theme]);

  useEffect(() => {
    document.title = db.settings.shopName ? `MyVault — ${db.settings.shopName}` : 'MyVault';
  }, [db.settings.shopName]);

  const openNewItem = useCallback(() => {
    setDialogItem(null);
    setDialogOpen(true);
  }, []);

  const focusSearch = useCallback(() => {
    setView('inventory');
    // Wait for the inventory view to mount before reaching for its input.
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

  /**
   * A scan from a USB reader works from any screen: it switches to the stock
   * list and pulls up that one item. Paused while a dialog is open so a scan
   * into the barcode field is never hijacked.
   */
  useBarcodeScanner((code) => {
    setView('inventory');
    setFilters((current) => ({ ...current, query: code, scope: 'barcode' }));
    const match = db.items.find((item) => item.barcode === code);
    notify(
      match ? `Scanned: ${match.name} — ${match.quantity} in stock.` : `No item found for ${code}.`,
      match ? 'success' : 'error',
    );
  }, !dialogOpen);

  // Keyboard shortcuts, matching the ones advertised in the File menu.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        openNewItem();
      } else if (key === 'f') {
        event.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openNewItem, focusSearch]);

  // Actions coming from the native window menu.
  const { importCsv, exportCsv, backup, restore } = useVault();
  useEffect(() => {
    if (!window.myvault?.onMenu) return undefined;
    return window.myvault.onMenu((channel) => {
      switch (channel) {
        case 'menu:new-item': openNewItem(); break;
        case 'menu:focus-search': focusSearch(); break;
        case 'menu:import-csv': void importCsv(); break;
        case 'menu:export-csv': void exportCsv(); break;
        case 'menu:backup': void backup(); break;
        case 'menu:restore': void restore(); break;
        default: break;
      }
    });
  }, [openNewItem, focusSearch, importCsv, exportCsv, backup, restore]);

  if (loadError) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="empty-art"><Icon name="alert" size={26} /></div>
          <h2>MyVault could not start</h2>
          <p style={{ maxWidth: '46ch' }}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="brand-mark"><Icon name="vault" size={22} /></div>
          <p>Opening your inventory…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="vault" size={22} /></div>
          <div className="brand-text">
            <div className="brand-name">MyVault</div>
            <div className="brand-sub">{db.settings.shopName || 'Stock manager'}</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <div className="nav-heading">Shop</div>
          {NAV.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="nav-item"
              aria-current={view === entry.id ? 'page' : undefined}
              onClick={() => setView(entry.id)}
              title={entry.label}
            >
              <Icon name={entry.icon} />
              <span className="nav-label">{entry.label}</span>
              {entry.id === 'inventory' && <span className="nav-count">{db.items.length}</span>}
              {entry.id === 'categories' && <span className="nav-count">{db.categories.length}</span>}
              {entry.id === 'fields' && <span className="nav-count">{db.customFields.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="storage-note">
            <Icon name="folder" size={16} />
            <span>
              <strong>Saved on this PC only.</strong> No internet, no accounts — your stock list
              never leaves this computer.
            </span>
          </div>
          {info?.version && <span className="field-hint">Version {info.version}</span>}
        </div>
      </aside>

      <main className="main">
        {view === 'inventory' && (
          <InventoryView
            filters={filters}
            setFilters={setFilters}
            sort={sort}
            setSort={setSort}
            onNewItem={openNewItem}
            onEditItem={(item) => { setDialogItem(item); setDialogOpen(true); }}
            searchRef={searchRef}
            onGoToFields={() => setView('fields')}
          />
        )}
        {view === 'categories' && (
          <CategoriesView
            onBrowse={(categoryId) => {
              setFilters((current) => ({ ...current, categoryIds: [categoryId], query: '' }));
              setView('inventory');
            }}
          />
        )}
        {view === 'fields' && <FieldsView />}
        {view === 'settings' && <SettingsView />}
      </main>

      {dialogOpen && (
        <ItemDialog item={dialogItem} onClose={() => { setDialogOpen(false); setDialogItem(null); }} />
      )}

      <Toasts />
    </div>
  );
}
