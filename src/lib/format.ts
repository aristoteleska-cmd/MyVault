import type { CustomField, CustomFieldValue, Item } from '../types';

/**
 * Numbers and dates follow the language the shop chose, so a German shop sees
 * 1.234,50 and a British one 1,234.50 without any extra setting.
 */
export function formatMoney(value: number, currency: string, locale?: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = amount.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency}${formatted}`;
}

export function formatNumber(value: number, locale?: string): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString(locale);
}

export function formatDate(iso: string, locale?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string, locale?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(iso, locale)}, ${date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

type Translate = (key: 'common.yes' | 'common.no') => string;

export function formatFieldValue(
  value: CustomFieldValue | undefined,
  field: CustomField,
  t?: Translate,
  locale?: string,
): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'boolean') {
    if (t) return value ? t('common.yes') : t('common.no');
    return value ? 'Yes' : 'No';
  }
  if (field.type === 'date') return formatDate(String(value), locale);
  return String(value);
}

export type StockLevel = 'out' | 'low' | 'ok';

export function stockLevel(item: Item, defaultThreshold: number): StockLevel {
  if (item.quantity <= 0) return 'out';
  const threshold = item.lowStockThreshold ?? defaultThreshold;
  if (threshold > 0 && item.quantity <= threshold) return 'low';
  return 'ok';
}

/** Deterministic, readable colour for a new category so the list stays varied. */
export const CATEGORY_COLORS = [
  '#4f7cff', '#12a594', '#e5484d', '#f5a524', '#8e4ec6',
  '#0091ff', '#30a46c', '#d6409f', '#f76808', '#6e56cf',
];

export function nextCategoryColor(usedCount: number): string {
  return CATEGORY_COLORS[usedCount % CATEGORY_COLORS.length];
}
