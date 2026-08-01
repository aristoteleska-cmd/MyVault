import type { Category, CustomField, Item, SortKey, SortState } from '../types';
import { formatDate, formatFieldValue, formatMoney, stockLabel, stockLevel } from '../lib/format';
import { Icon } from './Icon';

interface ItemTableProps {
  items: Item[];
  categories: Category[];
  fields: CustomField[];
  currency: string;
  defaultThreshold: number;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  selected: Set<string>;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectAll: (selected: boolean) => void;
  onEdit: (item: Item) => void;
  onDelete: (ids: string[]) => void;
  onAdjust: (id: string, delta: number) => void;
}

export function ItemTable({
  items,
  categories,
  fields,
  currency,
  defaultThreshold,
  sort,
  onSortChange,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onDelete,
  onAdjust,
}: ItemTableProps) {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someSelected = items.some((item) => selected.has(item.id));

  const header = (key: SortKey, label: string, numeric = false, extra = '') => (
    <th key={key} className={`sortable${numeric ? ' num' : ''}${extra ? ` ${extra}` : ''}`} scope="col"
      aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="th-sort"
        data-active={sort.key === key}
        onClick={() => onSortChange(key)}
        title={`Sort by ${label}`}
      >
        {label}
        <Icon name={sort.key === key && sort.direction === 'desc' ? 'arrowDown' : 'arrowUp'} size={13} />
      </button>
    </th>
  );

  return (
    <div className="table-scroll">
      <table className="items">
        <thead>
          <tr>
            <th className="col-select" scope="col">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
                aria-label={allSelected ? 'Clear selection' : 'Select all items on this page'}
              />
            </th>
            {header('name', 'Item', false, 'col-name')}
            {header('barcode', 'Barcode')}
            {header('category', 'Category')}
            {fields.filter((field) => field.showInTable).map((field) =>
              header(`custom:${field.id}` as SortKey, field.name))}
            {header('quantity', 'In stock', true)}
            {header('price', 'Price', true)}
            {header('value', 'Stock value', true)}
            {header('updatedAt', 'Updated', true)}
            <th className="col-actions" scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const category = categoryById.get(item.categoryId);
            const level = stockLevel(item, defaultThreshold);
            const isSelected = selected.has(item.id);

            return (
              <tr
                key={item.id}
                data-selected={isSelected}
                onDoubleClick={() => onEdit(item)}
              >
                <td className="col-select">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => onToggleSelect(item.id, e.target.checked)}
                    aria-label={`Select ${item.name}`}
                  />
                </td>

                <td className="col-name">
                  <div className="item-name" title={item.name}>{item.name}</div>
                  {(item.sku || item.supplier) && (
                    <div className="item-meta">
                      {item.sku && <span>SKU {item.sku}</span>}
                      {item.supplier && <span>{item.supplier}</span>}
                    </div>
                  )}
                </td>

                <td className="mono">{item.barcode || <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>

                <td>
                  {category ? (
                    <span className="category-pill">
                      <span className="chip-dot" style={{ background: category.color }} />
                      <span>{category.name}</span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>

                {fields.filter((field) => field.showInTable).map((field) => (
                  <td key={field.id}>
                    {formatFieldValue(item.custom?.[field.id], field) || (
                      <span style={{ color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                ))}

                <td className="num">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {/* Only the exceptions are worth calling out — a badge on every
                        healthy row is noise that costs a lot of column width. */}
                    {level !== 'ok' && (
                      <span className={`badge badge-${level}`}>{stockLabel[level]}</span>
                    )}
                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() => onAdjust(item.id, -1)}
                        disabled={item.quantity <= 0}
                        aria-label={`Remove one ${item.name}`}
                        title="Sold one / remove one"
                      >
                        <Icon name="minus" size={15} />
                      </button>
                      <span className="stepper-value">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onAdjust(item.id, 1)}
                        aria-label={`Add one ${item.name}`}
                        title="Received one / add one"
                      >
                        <Icon name="plus" size={15} />
                      </button>
                    </div>
                  </div>
                </td>

                <td className="num">{formatMoney(item.price, currency)}</td>
                <td className="num">{formatMoney(item.price * item.quantity, currency)}</td>
                <td className="num" style={{ color: 'var(--text-muted)' }}>{formatDate(item.updatedAt)}</td>

                <td className="col-actions">
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onEdit(item)}
                      aria-label={`Edit ${item.name}`}
                      title="Edit"
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => onDelete([item.id])}
                      aria-label={`Delete ${item.name}`}
                      title="Delete"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
