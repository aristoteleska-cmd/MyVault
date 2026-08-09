import { useCallback, useEffect, useRef, useState } from 'react';
import { useVault } from './state/vault';
import { useI18n, type TranslationKey } from './i18n';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import type { Capability, Filters, Item, SortState } from './types';
import { Icon, type IconName } from './components/Icon';
import { InventoryView } from './components/InventoryView';
import { CategoriesView } from './components/CategoriesView';
import { FieldsView } from './components/FieldsView';
import { SettingsView } from './components/SettingsView';
import { ItemDialog } from './components/ItemDialog';
import { StaffView } from './components/StaffView';
import { SignInView } from './components/SignInView';
import { Toasts } from './components/Toasts';

type ViewName = 'inventory' | 'categories' | 'fields' | 'settings' | 'staff';

/**
 * The sidebar, and what each entry needs before it is offered.
 *
 * A junior on the till sees Stock and nothing else, so the screen is not a wall
 * of buttons that refuse them. Stock and Settings are always shown: settings
 * still holds the appearance controls, which are anyone's to change.
 */
const NAV: {
  id: ViewName;
  labelKey: TranslationKey;
  icon: IconName;
  needs?: Capability;
}[] = [
  { id: 'inventory', labelKey: 'nav.stock', icon: 'box' },
  { id: 'categories', labelKey: 'nav.categories', icon: 'tag', needs: 'categories.manage' },
  { id: 'fields', labelKey: 'nav.details', icon: 'fields', needs: 'fields.manage' },
  { id: 'staff', labelKey: 'nav.staff', icon: 'staff', needs: 'staff.manage' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings' },
];

const initialFilters: Filters = {
  query: '',
  scope: 'all',
  categoryIds: [],
  stock: 'all',
  customValues: {},
};

export function App() {
  const { ready, loadError, db, info, notify, scanBarcodePhoto, auth, can } = useVault();
  const { t, rtl } = useI18n();
  const [view, setView] = useState<ViewName>('inventory');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [dialogItem, setDialogItem] = useState<Item | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillBarcode, setPrefillBarcode] = useState('');
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

  // The rest of the look: accent colour, row density and overall scale.
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', db.settings.accent);
  }, [db.settings.accent]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', db.settings.density);
  }, [db.settings.density]);

  useEffect(() => {
    window.myvault?.setZoom?.(db.settings.zoom);
  }, [db.settings.zoom]);

  useEffect(() => {
    document.title = db.settings.shopName ? `MyVault — ${db.settings.shopName}` : 'MyVault';
  }, [db.settings.shopName]);

  // Arabic and Urdu lay the whole interface out right-to-left.
  useEffect(() => {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [rtl]);

  const openNewItem = useCallback(() => {
    setDialogItem(null);
    setPrefillBarcode('');
    setDialogOpen(true);
  }, []);

  /**
   * A photo of a barcode, from the stock list.
   *
   * If the shop already sells the thing, open it for editing — that is almost
   * always why someone photographs a barcode at the counter. If they do not,
   * start a new item with the number already filled in, which is the whole
   * point of the feature: registering stock without typing thirteen digits.
   */
  const scanPhotoAndRegister = useCallback(async () => {
    const code = await scanBarcodePhoto();
    if (!code) return;

    setView('inventory');
    const match = db.items.find((item) => item.barcode === code);
    if (match) {
      setDialogItem(match);
      setPrefillBarcode('');
    } else {
      setDialogItem(null);
      setPrefillBarcode(code);
    }
    setDialogOpen(true);
  }, [scanBarcodePhoto, db.items]);

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
    if (match) notify('toast.scanned', { name: match.name, count: match.quantity }, 'success');
    else notify('toast.scanMissing', { code }, 'error');
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
          <h2>{t('splash.errorTitle')}</h2>
          <p style={{ maxWidth: '46ch' }}>
            {loadError === 'splash.noBridge' || loadError === 'splash.noFile'
              ? t(loadError)
              : loadError}
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="brand-mark"><Icon name="vault" size={22} /></div>
          <p>{t('splash.opening')}</p>
        </div>
      </div>
    );
  }

  // With staff roles set up, nothing is shown until somebody signs in — not the
  // sidebar, not the totals, not a single product name.
  if (auth.locked && !auth.signedIn) {
    return (
      <>
        <SignInView />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="vault" size={22} /></div>
          <div className="brand-text">
            <div className="brand-name">MyVault</div>
            <div className="brand-sub">{db.settings.shopName || t('brand.tagline')}</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <div className="nav-heading">{t('nav.section')}</div>
          {NAV.filter((entry) => !entry.needs || can(entry.needs)).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="nav-item"
              aria-current={view === entry.id ? 'page' : undefined}
              onClick={() => setView(entry.id)}
              title={t(entry.labelKey)}
            >
              <Icon name={entry.icon} />
              <span className="nav-label">{t(entry.labelKey)}</span>
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
              <strong>{t('sidebar.localTitle')}</strong> {t('sidebar.localBody')}
            </span>
          </div>
          {info?.version && <span className="field-hint">{t('sidebar.version', { version: info.version })}</span>}
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
            onScanPhoto={() => void scanPhotoAndRegister()}
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
        {view === 'staff' && <StaffView />}
        {view === 'settings' && <SettingsView />}
      </main>

      {dialogOpen && (
        <ItemDialog
          item={dialogItem}
          prefillBarcode={prefillBarcode}
          onClose={() => { setDialogOpen(false); setDialogItem(null); setPrefillBarcode(''); }}
        />
      )}

      <Toasts />
    </div>
  );
}
