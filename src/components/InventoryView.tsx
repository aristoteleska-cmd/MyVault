import { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../state/vault';
import { computeTotals, filterAndSort } from '../lib/search';
import { formatMoney, formatNumber } from '../lib/format';
import type { Filters, Item, SortKey, SortState, StockFilter } from '../types';
import { Icon } from './Icon';
import { ItemTable } from './ItemTable';

interface InventoryViewProps {
  filters: Filters;
  setFilters: (update: (current: Filters) => Filters) => void;
  sort: SortState;
  setSort: (sort: SortState) => void;
  onNewItem: () => void;
  onEditItem: (item: Item) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onGoToFields: () => void;
}

const PAGE_SIZES = [25, 50, 100, 250];

const STOCK_FILTERS: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-stock', label: 'In stock' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
];

export function InventoryView({
  filters,
  setFilters,
  sort,
  setSort,
  onNewItem,
  onEditItem,
  searchRef,
  onGoToFields,
}: InventoryViewProps) {
  const { db, deleteItems, adjustStock, importCsv, exportCsv } = useVault();
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
    { value: 'name', label: 'Name' },
    { value: 'quantity', label: 'Stock quantity' },
    { value: 'price', label: 'Price' },
    { value: 'value', label: 'Stock value' },
    { value: 'category', label: 'Category' },
    { value: 'barcode', label: 'Barcode' },
    { value: 'updatedAt', label: 'Last updated' },
    { value: 'createdAt', label: 'Date added' },
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
            placeholder="Search by name, barcode or category…"
            aria-label="Search your stock"
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
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
          <label className="visually-hidden" htmlFor="search-scope">Search in</label>
          <select
            id="search-scope"
            className="select scope-select"
            value={filters.scope}
            onChange={(e) =>
              setFilters((current) => ({ ...current, scope: e.target.value as Filters['scope'] }))
            }
          >
            <option value="all">Everything</option>
            <option value="name">Name only</option>
            <option value="barcode">Barcode only</option>
            <option value="category">Category only</option>
          </select>
        </div>

        <button type="button" className="btn btn-primary btn-lg" onClick={onNewItem}>
          <Icon name="plus" />
          Add item
        </button>
      </div>

      <div className="view">
        <section className="stats" aria-label="Stock summary">
          <div className="stat">
            <span className="stat-label"><Icon name="box" size={14} />Different items</span>
            <span className="stat-value">{formatNumber(totals.skus)}</span>
            <span className="stat-foot">{formatNumber(totals.units)} pieces in total</span>
          </div>
          <div className="stat">
            <span className="stat-label"><Icon name="tag" size={14} />Stock value</span>
            <span className="stat-value">{formatMoney(totals.retailValue, db.settings.currency)}</span>
            <span className="stat-foot">
              at cost {formatMoney(totals.costValue, db.settings.currency)}
            </span>
          </div>
          <div className={totals.lowStock ? 'stat is-warning' : 'stat'}>
            <span className="stat-label"><Icon name="alert" size={14} />Running low</span>
            <span className="stat-value">{formatNumber(totals.lowStock)}</span>
            {totals.lowStock > 0 ? (
              <button
                type="button"
                className="stat-action"
                onClick={() => setFilters((current) => ({ ...current, stock: 'low' }))}
              >
                Show these items
              </button>
            ) : (
              <span className="stat-foot">Everything is above its limit</span>
            )}
          </div>
          <div className={totals.outOfStock ? 'stat is-danger' : 'stat'}>
            <span className="stat-label"><Icon name="alert" size={14} />Out of stock</span>
            <span className="stat-value">{formatNumber(totals.outOfStock)}</span>
            {totals.outOfStock > 0 ? (
              <button
                type="button"
                className="stat-action"
                onClick={() => setFilters((current) => ({ ...current, stock: 'out' }))}
              >
                Show these items
              </button>
            ) : (
              <span className="stat-foot">Nothing has run out</span>
            )}
          </div>
        </section>

        <section className="toolbar" aria-label="Filters and sorting">
          <div className="toolbar-group">
            <Icon name="filter" size={16} />
            <span className="toolbar-label">Stock</span>
            <div className="segmented">
              {STOCK_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filters.stock === option.value}
                  onClick={() => setFilters((current) => ({ ...current, stock: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar-divider" aria-hidden="true" />

          <div className="toolbar-group">
            <label className="toolbar-label" htmlFor="sort-key">Sort by</label>
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
              title={sort.direction === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
            >
              <Icon name={sort.direction === 'asc' ? 'arrowUp' : 'arrowDown'} size={15} />
              {sort.direction === 'asc' ? 'A → Z' : 'Z → A'}
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
                <option value="">Any</option>
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
              Clear filters
            </button>
          )}
        </section>

        {db.categories.length > 0 && (
          <div className="chip-scroller" role="group" aria-label="Filter by category">
            <button
              type="button"
              className="chip"
              aria-pressed={filters.categoryIds.length === 0}
              onClick={() => setFilters((current) => ({ ...current, categoryIds: [] }))}
            >
              All categories
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
              Uncategorised
            </button>
          </div>
        )}

        <div className="table-card">
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span>{selected.size} selected</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  void deleteItems([...selected]);
                  setSelected(new Set());
                }}
              >
                <Icon name="trash" size={15} />
                Delete selected
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          {db.items.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><Icon name="box" size={28} /></div>
              <h3>Your shop is empty — let's fill it</h3>
              <p>
                Add your products one by one, or bring in a list you already have in Excel.
                Everything stays on this computer.
              </p>
              <div className="empty-actions">
                <button type="button" className="btn btn-primary btn-lg" onClick={onNewItem}>
                  <Icon name="plus" />
                  Add your first item
                </button>
                <button type="button" className="btn btn-lg" onClick={() => void importCsv()}>
                  <Icon name="upload" />
                  Import from CSV
                </button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><Icon name="search" size={28} /></div>
              <h3>Nothing matches that search</h3>
              <p>
                Try a shorter word, check the search mode next to the search box, or clear the
                filters to see everything again.
              </p>
              <div className="empty-actions">
                <button type="button" className="btn" onClick={resetFilters}>Clear filters</button>
                <button type="button" className="btn btn-primary" onClick={onNewItem}>
                  <Icon name="plus" size={16} />
                  Add it as a new item
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
                  Showing {formatNumber(pageItems.length)} of {formatNumber(visible.length)}
                  {isFiltered ? ` matching items · ${formatMoney(visibleTotals.retailValue, db.settings.currency)} value` : ' items'}
                </span>

                <label className="visually-hidden" htmlFor="page-size">Items per page</label>
                <select
                  id="page-size"
                  className="select"
                  style={{ width: 'auto', minHeight: 30, fontSize: 13 }}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} per page</option>
                  ))}
                </select>

                {pageCount > 1 && (
                  <div className="pager">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      aria-label="Previous page"
                    >
                      <Icon name="chevronLeft" size={16} />
                    </button>
                    <span style={{ padding: '0 8px' }}>
                      Page {safePage + 1} of {pageCount}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      aria-label="Next page"
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
            <button type="button" className="btn btn-sm" onClick={() => void importCsv()}>
              <Icon name="upload" size={15} />
              Import CSV
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void exportCsv()}>
              <Icon name="download" size={15} />
              Export CSV
            </button>
            <button type="button" className="btn btn-sm" onClick={onGoToFields}>
              <Icon name="fields" size={15} />
              Manage extra details
            </button>
          </div>
          <span className="field-hint">
            Tip: <kbd>Ctrl</kbd> + <kbd>N</kbd> adds an item, <kbd>Ctrl</kbd> + <kbd>F</kbd> jumps to search,
            double-clicking a row edits it. Scanning a barcode anywhere finds the item.
          </span>
        </div>

        <div className="visually-hidden" role="status" aria-live="polite" ref={liveRegion}>
          {visible.length} items match your search.
        </div>
      </div>
    </>
  );
}
