import type { CustomField, CustomFieldValue, Item } from '../types';

export function formatMoney(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency}${formatted}`;
}

export function formatNumber(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString();
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(iso)}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function formatFieldValue(value: CustomFieldValue | undefined, field: CustomField): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'date') return formatDate(String(value));
  return String(value);
}

export type StockLevel = 'out' | 'low' | 'ok';

export function stockLevel(item: Item, defaultThreshold: number): StockLevel {
  if (item.quantity <= 0) return 'out';
  const threshold = item.lowStockThreshold ?? defaultThreshold;
  if (threshold > 0 && item.quantity <= threshold) return 'low';
  return 'ok';
}

export const stockLabel: Record<StockLevel, string> = {
  out: 'Out of stock',
  low: 'Low stock',
  ok: 'In stock',
};

/** Deterministic, readable colour for a new category so the list stays varied. */
export const CATEGORY_COLORS = [
  '#4f7cff', '#12a594', '#e5484d', '#f5a524', '#8e4ec6',
  '#0091ff', '#30a46c', '#d6409f', '#f76808', '#6e56cf',
];

export function nextCategoryColor(usedCount: number): string {
  return CATEGORY_COLORS[usedCount % CATEGORY_COLORS.length];
}
