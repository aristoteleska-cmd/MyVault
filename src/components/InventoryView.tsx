import { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../state/vault';
import { computeTotals, filterAndSort } from '../lib/search';
import { formatMoney, formatNumber } from '../lib/format';
import { useI18n, type TranslationKey } from '../i18n';
import type { Filters, Item, SortKey, SortState, StockFilter } from '../types';
import { Icon } from './Icon';
import { ItemTable } from './ItemTable';

interface InventoryViewProps {
  filters: Filters;
  setFilters: (update: (current: Filters) => Filters) => void;
  sort: SortState;
  setSort: (sort: SortState) => void;
  onNewItem: () => void;
  onScanPhoto: () => void;
  onEditItem: (item: Item) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onGoToFields: () => void;
}

const PAGE_SIZES = [25, 50, 100, 250];

const STOCK_FILTERS: { value: StockFilter; labelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'filters.all' },
  { value: 'in-stock', labelKey: 'filters.inStock' },
  { value: 'low', labelKey: 'filters.low' },
  { value: 'out', labelKey: 'filters.out' },
];

export function InventoryView({
  filters,
  setFilters,
  sort,
  setSort,
  onNewItem,
  onScanPhoto,
  onEditItem,
  searchRef,
  onGoToFields,
}: InventoryViewProps) {
  const { db, deleteItems, adjustStock, importCsv, exportCsv, can } = useVault();
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const liveRegion = useRef<HTMLDivElement>(null);

  const threshold = db.settings.defaultLowStockThreshold;

  const visible = useMemo(
    () =>
      filterAndSort({
        items: db.items,
        categories: db.categories,
        fields: db.customFields,
        filters,
        sort,
        defaultThreshold: threshold,
      }),
    [db.items, db.categories, db.customFields, filters, sort, threshold],
  );

  const totals = useMemo(() => computeTotals(db.items, threshold), [db.items, threshold]);
  const visibleTotals = useMemo(() => computeTotals(visible, threshold), [visible, threshold]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => visible.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [visible, safePage, pageSize],
  );

  // Any change to what is being shown puts us back on the first page.
  useEffect(() => { setPage(0); }, [filters, sort, pageSize]);

  // Drop selections for rows that are no longer on screen.
  useEffect(() => {
    setSelected((current) => {
      if (!current.size) return current;
      const stillVisible = new Set(visible.map((item) => item.id));
      const next = new Set([...current].filter((id) => stillVisible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visible]);

  const isFiltered =
    filters.query.trim() !== '' ||
    filters.categoryIds.length > 0 ||
    filters.stock !== 'all' ||
    Object.values(filters.customValues).some(Boolean);

  const selectFields = db.customFields.filter((field) => field.type === 'select');

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'name', label: t('sort.name') },
    { value: 'quantity', label: t('sort.quantity') },
    { value: 'price', label: t('sort.price') },
    { value: 'value', label: t('sort.value') },
    { value: 'category', label: t('sort.category') },
    { value: 'barcode', label: t('sort.barcode') },
    { value: 'updatedAt', label: t('sort.updated') },
    { value: 'createdAt', label: t('sort.created') },
    ...db.customFields.map((field) => ({
      value: `custom:${field.id}` as SortKey,
      label: field.name,
    })),
  ];

  function toggleCategory(id: string) {
    setFilters((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(id)
        ? current.categoryIds.filter((c) => c !== id)
        : [...current.categoryIds, id],
    }));
  }

  /**
   * Words start A→Z, numbers and dates start with the biggest first. The same
   * rule applies whether the column header or the Sort by menu was used, so
   * the two never disagree.
   */
  function defaultDirection(key: SortKey): SortState['direction'] {
    if (key.startsWith('custom:')) {
      const field = db.customFields.find((f) => `custom:${f.id}` === key);
      return field && (field.type === 'number' || field.type === 'date') ? 'desc' : 'asc';
    }
    return key === 'name' || key === 'category' || key === 'barcode' ? 'asc' : 'desc';
  }

  function changeSort(key: SortKey) {
    setSort(
      sort.key === key
        ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultDirection(key) },
    );
  }

  function resetFilters() {
    setFilters((current) => ({
      ...current,
      query: '',
      categoryIds: [],
      stock: 'all',
      customValues: {},
    }));
    searchRef.current?.focus();
  }

  return (
    <>
      <div className="topbar">
        <div className="search-shell">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            className="search-input"
            type="search"
            value={filters.query}
            onChange={(e) => setFilters((current) => ({ ...current, query: e.target.value }))}
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            autoComplete="off"
          />
          {filters.query && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setFilters((current) => ({ ...current, query: '' }));
                searchRef.current?.focus();
              }}
              aria-label={t('search.clear')}
            >
              <Icon name="close" size={16} />
            </button>
          )}
          <label className="visually-hidden" htmlFor="search-scope">{t('search.in')}</label>
          <select
            id="search-scope"
            className="select scope-select"
            value={filters.scope}
            onChange={(e) =>
              setFilters((current) => ({ ...current, scope: e.target.value as Filters['scope'] }))
            }
          >
            <option value="all">{t('scope.all')}</option>
            <option value="name">{t('scope.name')}</option>
            <option value="barcode">{t('scope.barcode')}</option>
            <option value="category">{t('scope.category')}</option>
          </select>
        </div>

        {/* For a shop with no scanner: a photo of the barcode is enough to
            pull up the item, or to start registering it if it is new. */}
        <button type="button" className="btn btn-lg" onClick={onScanPhoto}>
          <Icon name="image" />
          {t('action.scanPhoto')}
        </button>

        {can('items.create') && (
          <button type="button" className="btn btn-primary btn-lg" onClick={onNewItem}>
            <Icon name="plus" />
            {t('action.addItem')}
          </button>
        )}
      </div>

      <div className="view">
        <section className="stats" aria-label={t('stats.aria')}>
          <div className="stat">
            <span className="stat-label"><Icon name="box" size={14} />{t('stats.differentItems')}</span>
            <span className="stat-value">{formatNumber(totals.skus, locale)}</span>
            <span className="stat-foot">{t('stats.pieces', { count: formatNumber(totals.units, locale) })}</span>
          </div>
          <div className="stat">
            <span className="stat-label"><Icon name="tag" size={14} />{t('stats.stockValue')}</span>
            <span className="stat-value">{formatMoney(totals.retailValue, db.settings.currency, locale)}</span>
            <span className="stat-foot">
              {t('stats.atCost', { value: formatMoney(totals.costValue, db.settings.currency, locale) })}
            </span>
          </div>
          <div className={totals.lowStock ? 'stat is-warning' : 'stat'}>
            <span className="stat-label"><Icon name="alert" size={14} />{t('stats.runningLow')}</span>
            <span className="stat-value">{formatNumber(totals.lowStock, locale)}</span>
            {totals.lowStock > 0 ? (
              <button
                type="button"
                className="stat-action"
                onClick={() => setFilters((current) => ({ ...current, stock: 'low' }))}
              >
                {t('stats.showThese')}
              </button>
            ) : (
              <span className="stat-foot">{t('stats.allAbove')}</span>
            )}
          </div>
          <div className={totals.outOfStock ? 'stat is-danger' : 'stat'}>
            <span className="stat-label"><Icon name="alert" size={14} />{t('stats.outOfStock')}</span>
            <span className="stat-value">{formatNumber(totals.outOfStock, locale)}</span>
            {totals.outOfStock > 0 ? (
              <button
                type="button"
                className="stat-action"
                onClick={() => setFilters((current) => ({ ...current, stock: 'out' }))}
              >
                {t('stats.showThese')}
              </button>
            ) : (
              <span className="stat-foot">{t('stats.nothingOut')}</span>
            )}
          </div>
        </section>

        <section className="toolbar" aria-label={t('filters.aria')}>
          <div className="toolbar-group">
            <Icon name="filter" size={16} />
            <span className="toolbar-label">{t('filters.stock')}</span>
            <div className="segmented">
              {STOCK_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filters.stock === option.value}
                  onClick={() => setFilters((current) => ({ ...current, stock: option.value }))}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar-divider" aria-hidden="true" />

          <div className="toolbar-group">
            <label className="toolbar-label" htmlFor="sort-key">{t('filters.sortBy')}</label>
            <select
              id="sort-key"
              className="select"
              style={{ width: 'auto', minWidth: 150 }}
              value={sort.key}
              onChange={(e) => changeSort(e.target.value as SortKey)}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
              title={sort.direction === 'asc' ? t('filters.ascTitle') : t('filters.descTitle')}
            >
              <Icon name={sort.direction === 'asc' ? 'arrowUp' : 'arrowDown'} size={15} />
              {sort.direction === 'asc' ? t('filters.asc') : t('filters.desc')}
            </button>
          </div>

          {selectFields.length > 0 && <div className="toolbar-divider" aria-hidden="true" />}

          {selectFields.map((field) => (
            <div className="toolbar-group" key={field.id}>
              <label className="toolbar-label" htmlFor={`filter-${field.id}`}>{field.name}</label>
              <select
                id={`filter-${field.id}`}
                className="select"
                style={{ width: 'auto', minWidth: 110 }}
                value={filters.customValues[field.id] ?? ''}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    customValues: { ...current.customValues, [field.id]: e.target.value },
                  }))
                }
              >
                <option value="">{t('filters.any')}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          ))}

          <div className="toolbar-spacer" />

          {isFiltered && (
            <button type="button" className="btn btn-sm" onClick={resetFilters}>
              <Icon name="close" size={15} />
              {t('filters.clear')}
            </button>
          )}
        </section>

        {db.categories.length > 0 && (
          <div className="chip-scroller" role="group" aria-label={t('filters.byCategory')}>
            <button
              type="button"
              className="chip"
              aria-pressed={filters.categoryIds.length === 0}
              onClick={() => setFilters((current) => ({ ...current, categoryIds: [] }))}
            >
              {t('filters.allCategories')}
            </button>
            {db.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="chip"
                aria-pressed={filters.categoryIds.includes(category.id)}
                onClick={() => toggleCategory(category.id)}
              >
                <span className="chip-dot" style={{ background: category.color }} />
                {category.name}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={filters.categoryIds.includes('__none__')}
              onClick={() => toggleCategory('__none__')}
            >
              {t('filters.uncategorised')}
            </button>
          </div>
        )}

        <div className="table-card">
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span>{t('bulk.selected', { count: selected.size })}</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  void deleteItems([...selected]);
                  setSelected(new Set());
                }}
              >
                <Icon name="trash" size={15} />
                {t('bulk.delete')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
                {t('bulk.clear')}
              </button>
            </div>
          )}

          {db.items.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><Icon name="box" size={28} /></div>
              <h3>{t('empty.noItemsTitle')}</h3>
              <p>{t('empty.noItemsBody')}</p>
              <div className="empty-actions">
                <button type="button" className="btn btn-primary btn-lg" onClick={onNewItem}>
                  <Icon name="plus" />
                  {t('empty.addFirst')}
                </button>
                <button type="button" className="btn btn-lg" onClick={() => void importCsv()}>
                  <Icon name="upload" />
                  {t('tools.import')}
                </button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><Icon name="search" size={28} /></div>
              <h3>{t('empty.noMatchTitle')}</h3>
              <p>{t('empty.noMatchBody')}</p>
              <div className="empty-actions">
                <button type="button" className="btn" onClick={resetFilters}>{t('filters.clear')}</button>
                <button type="button" className="btn btn-primary" onClick={onNewItem}>
                  <Icon name="plus" size={16} />
                  {t('empty.addAsNew')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <ItemTable
                items={pageItems}
                categories={db.categories}
                fields={db.customFields}
                currency={db.settings.currency}
                defaultThreshold={threshold}
                sort={sort}
                onSortChange={changeSort}
                selected={selected}
                onToggleSelect={(id, isSelected) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (isSelected) next.add(id); else next.delete(id);
                    return next;
                  })
                }
                onToggleSelectAll={(isSelected) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    pageItems.forEach((item) => {
                      if (isSelected) next.add(item.id); else next.delete(item.id);
                    });
                    return next;
                  })
                }
                onEdit={onEditItem}
                onDelete={(ids) => void deleteItems(ids)}
                onAdjust={(id, delta) => void adjustStock(id, delta)}
              />

              <div className="table-foot">
                <span>
                  {t('foot.showing', {
                    shown: formatNumber(pageItems.length, locale),
                    total: formatNumber(visible.length, locale),
                  })}{' '}
                  {isFiltered
                    ? t('foot.matching', {
                        value: formatMoney(visibleTotals.retailValue, db.settings.currency, locale),
                      })
                    : t('foot.items')}
                </span>

                <label className="visually-hidden" htmlFor="page-size">{t('foot.perPageLabel')}</label>
                <select
                  id="page-size"
                  className="select"
                  style={{ width: 'auto', minHeight: 30, fontSize: 13 }}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{t('foot.perPage', { size })}</option>
                  ))}
                </select>

                {pageCount > 1 && (
                  <div className="pager">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      aria-label={t('foot.prev')}
                    >
                      <Icon name="chevronLeft" size={16} />
                    </button>
                    <span style={{ padding: '0 8px' }}>
                      {t('foot.page', { page: safePage + 1, pages: pageCount })}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      aria-label={t('foot.next')}
                    >
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="toolbar-group">
            {can('data.import') && (
              <button type="button" className="btn btn-sm" onClick={() => void importCsv()}>
                <Icon name="upload" size={15} />
                {t('tools.import')}
              </button>
            )}
            {can('data.export') && (
              <button type="button" className="btn btn-sm" onClick={() => void exportCsv()}>
                <Icon name="download" size={15} />
                {t('tools.export')}
              </button>
            )}
            {can('fields.manage') && (
              <button type="button" className="btn btn-sm" onClick={onGoToFields}>
                <Icon name="fields" size={15} />
                {t('tools.manageDetails')}
              </button>
            )}
          </div>
          <span className="field-hint">
            {t('tools.tip', { new: 'Ctrl + N', find: 'Ctrl + F' })}
          </span>
        </div>

        <div className="visually-hidden" role="status" aria-live="polite" ref={liveRegion}>
          {t('tools.matchCount', { count: visible.length })}
        </div>
      </div>
    </>
  );
}
