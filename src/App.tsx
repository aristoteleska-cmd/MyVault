import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useVault } from './state/vault';
import { useI18n, type TranslationKey } from './i18n';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import type { Capability, Filters, Item, SortState } from './types';
import { Icon, type IconName } from './components/Icon';
import { InventoryView } from './components/InventoryView';
import { ItemDialog } from './components/ItemDialog';
import { SignInView } from './components/SignInView';
import { RecoveryCode } from './components/RecoveryCode';
import { Toasts } from './components/Toasts';

type ViewName = 'inventory' | 'statistics' | 'reorder' | 'stocktake' | 'prices' | 'vat' | 'invoices' | 'suppliers' | 'sales' | 'clients' | 'categories' | 'fields' | 'settings' | 'staff';

/**
 * The screens that are not the one MyVault opens on.
 *
 * Everything used to arrive in a single file of about a megabyte: the barcode
 * decoder, the VAT engine, the invoice reader, the statistics — all of it read
 * off the disk and parsed before the shop could see how many bags of coffee it
 * had. On the machine behind a counter, which is not a new machine, that is the
 * difference between the program being open and the program being usable.
 *
 * Stock is imported normally above, because it is what opens and there is
 * nothing to wait for. The rest are fetched when somebody first asks for them,
 * out of the app's own bundle — there is no network here and there never will
 * be, so "fetched" means read from a file beside the program.
 */
const StatisticsView = lazy(() => import('./components/StatisticsView').then((m) => ({ default: m.StatisticsView })));
const StockTakeView = lazy(() => import('./components/StockTakeView').then((m) => ({ default: m.StockTakeView })));
const ReorderView = lazy(() => import('./components/ReorderView').then((m) => ({ default: m.ReorderView })));
const VatView = lazy(() => import('./components/VatView').then((m) => ({ default: m.VatView })));
const PricesView = lazy(() => import('./components/PricesView').then((m) => ({ default: m.PricesView })));
const InvoicesView = lazy(() => import('./components/InvoicesView').then((m) => ({ default: m.InvoicesView })));
const SuppliersView = lazy(() => import('./components/SuppliersView').then((m) => ({ default: m.SuppliersView })));
const SalesView = lazy(() => import('./components/SalesView').then((m) => ({ default: m.SalesView })));
const ClientsView = lazy(() => import('./components/ClientsView').then((m) => ({ default: m.ClientsView })));
const CategoriesView = lazy(() => import('./components/CategoriesView').then((m) => ({ default: m.CategoriesView })));
const FieldsView = lazy(() => import('./components/FieldsView').then((m) => ({ default: m.FieldsView })));
const StaffView = lazy(() => import('./components/StaffView').then((m) => ({ default: m.StaffView })));
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));

/**
 * What stands in while a screen is being read off the disk.
 *
 * Deliberately empty, and deliberately holding the page's height. The wait is
 * a few milliseconds from a local file, and a word like "Loading…" that appears
 * and vanishes inside one frame reads as a flicker, not as information — it
 * would also need translating into twelve languages to say nothing.
 */
const screenLoading = <div className="view" aria-busy="true" />;

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
  { id: 'statistics', labelKey: 'nav.statistics', icon: 'chart', needs: 'stats.view' },
  { id: 'reorder', labelKey: 'nav.reorder', icon: 'upload', needs: 'stats.view' },
  { id: 'stocktake', labelKey: 'nav.stocktake', icon: 'check', needs: 'stocktake.run' },
  { id: 'invoices', labelKey: 'nav.invoices', icon: 'invoice', needs: 'documents.manage' },
  { id: 'suppliers', labelKey: 'nav.suppliers', icon: 'people', needs: 'documents.manage' },
  { id: 'sales', labelKey: 'nav.sales', icon: 'receipt', needs: 'documents.manage' },
  { id: 'prices', labelKey: 'nav.prices', icon: 'tag', needs: 'pricing.view' },
  { id: 'vat', labelKey: 'nav.vat', icon: 'receipt', needs: 'vat.view' },
  { id: 'clients', labelKey: 'nav.clients', icon: 'people', needs: 'clients.view' },
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
  const { ready, loadError, db, info, notify, scanBarcodePhoto, auth, can, recoveryCode } = useVault();
  const { t, rtl } = useI18n();
  const [view, setView] = useState<ViewName>('inventory');
  /** Set when the shop reached the order list from one supplier's own screen. */
  const [orderSupplier, setOrderSupplier] = useState('');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [dialogItem, setDialogItem] = useState<Item | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillBarcode, setPrefillBarcode] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

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
  const { importCsv, exportCsv, backup, restore, startDoc, importDocPdf } = useVault();
  useEffect(() => {
    if (!window.myvault?.onMenu) return undefined;
    return window.myvault.onMenu((channel) => {
      switch (channel) {
        case 'menu:new-item': openNewItem(); break;
        case 'menu:focus-search': focusSearch(); break;
        // From anywhere in the program: go to Invoices, start the delivery, and
        // open the file chooser. Somebody holding an invoice should not have to
        // know which screen it belongs to before they can hand it over.
        case 'menu:read-pdf': void (async () => {
          setView('invoices');
          const draft = await startDoc('in');
          if (draft) await importDocPdf(draft.id);
        })(); break;
        case 'menu:import-csv': void importCsv(); break;
        case 'menu:export-csv': void exportCsv(); break;
        case 'menu:backup': void backup(); break;
        case 'menu:restore': void restore(); break;
        default: break;
      }
    });
  }, [openNewItem, focusSearch, importCsv, exportCsv, backup, restore, startDoc, importDocPdf]);

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

  // A code that has just been minted is shown before anything else and cannot
  // be clicked past — it is the last time it exists in a readable form.
  if (recoveryCode) {
    return (
      <>
        <RecoveryCode />
        <Toasts />
      </>
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
      {/* Fifteen tab stops separate the top of the window from the first thing
          on the screen somebody actually came to use. This is the way past
          them, and it stays invisible until a keyboard finds it. It moves the
          focus itself rather than following a link, because there is no
          address bar here to put a fragment in. */}
      <button
        type="button"
        className="skip-link"
        onClick={() => mainRef.current?.focus()}
      >
        {t('nav.skip')}
      </button>

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
              {entry.id === 'clients' && <span className="nav-count">{db.clients.length}</span>}
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

      <main className="main" ref={mainRef} tabIndex={-1}>
        <Suspense fallback={screenLoading}>
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
        {view === 'statistics' && (
          <StatisticsView
            onBrowseItem={(name) => {
              setFilters((current) => ({ ...current, query: name, scope: 'all' }));
              setView('inventory');
            }}
          />
        )}
        {view === 'reorder' && (
          <ReorderView
            onBrowseItem={(name) => {
              setFilters((current) => ({ ...current, query: name, scope: 'all' }));
              setView('inventory');
            }}
            supplier={orderSupplier}
            onShowAll={() => setOrderSupplier('')}
          />
        )}
        {view === 'stocktake' && <StockTakeView />}
        {view === 'prices' && <PricesView />}
        {view === 'vat' && <VatView />}
        {view === 'invoices' && <InvoicesView />}
        {/* A supplier has two halves — what they have sent, and what to ask
            them for next — and the second half lives on the order list. */}
        {view === 'suppliers' && (
          <SuppliersView
            onGoToOrders={(name) => { setOrderSupplier(name); setView('reorder'); }}
          />
        )}
        {view === 'sales' && <SalesView />}
        {view === 'clients' && <ClientsView />}
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
        </Suspense>
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
