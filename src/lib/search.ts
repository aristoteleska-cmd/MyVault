import type {
  Category,
  CustomField,
  Filters,
  Item,
  SortState,
} from '../types';
import { stockLevel } from './format';

/**
 * Lower-cases and strips accents so "Παπούτσι" matches "παπουτσι" and
 * "Café" matches "cafe". Shop staff should not have to type accents to find
 * something at the till.
 */
export function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Splits a query into terms so "red shirt" matches an item named "Shirt red". */
function terms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

interface Haystacks {
  name: string;
  barcode: string;
  category: string;
  everything: string;
}

function buildHaystacks(
  item: Item,
  categoryName: string,
  fields: CustomField[],
): Haystacks {
  const customValues = fields
    .map((field) => item.custom?.[field.id])
    .filter((value) => value !== undefined && value !== '')
    .map((value) => String(value));

  const name = normalize(item.name);
  const barcode = normalize(item.barcode);
  const category = normalize(categoryName);

  return {
    name,
    barcode,
    category,
    everything: [
      name,
      barcode,
      normalize(item.sku),
      category,
      normalize(item.supplier),
      normalize(item.notes),
      ...customValues.map(normalize),
    ].join(' '),
  };
}

function matchesQuery(haystacks: Haystacks, scope: Filters['scope'], queryTerms: string[]): boolean {
  if (!queryTerms.length) return true;
  const target =
    scope === 'name' ? haystacks.name
      : scope === 'barcode' ? haystacks.barcode
        : scope === 'category' ? haystacks.category
          : haystacks.everything;
  return queryTerms.every((term) => target.includes(term));
}

export interface FilterContext {
  items: Item[];
  categories: Category[];
  fields: CustomField[];
  filters: Filters;
  sort: SortState;
  defaultThreshold: number;
}

export function filterAndSort({
  items,
  categories,
  fields,
  filters,
  sort,
  defaultThreshold,
}: FilterContext): Item[] {
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const queryTerms = terms(filters.query);
  const categoryFilter = new Set(filters.categoryIds);
  const customFilters = Object.entries(filters.customValues).filter(([, value]) => value !== '');

  const filtered = items.filter((item) => {
    if (categoryFilter.size) {
      // "uncategorised" is represented by an empty id in the filter list.
      if (!categoryFilter.has(item.categoryId || '__none__')) return false;
    }

    if (filters.stock !== 'all') {
      const level = stockLevel(item, defaultThreshold);
      if (filters.stock === 'out' && level !== 'out') return false;
      if (filters.stock === 'low' && level !== 'low') return false;
      if (filters.stock === 'in-stock' && item.quantity <= 0) return false;
    }

    for (const [fieldId, wanted] of customFilters) {
      if (normalize(item.custom?.[fieldId]) !== normalize(wanted)) return false;
    }

    if (queryTerms.length) {
      const haystacks = buildHaystacks(item, categoryName.get(item.categoryId) ?? '', fields);
      if (!matchesQuery(haystacks, filters.scope, queryTerms)) return false;
    }

    return true;
  });

  return sortItems(filtered, sort, categoryName);
}

function sortValue(
  item: Item,
  key: SortState['key'],
  categoryName: Map<string, string>,
): string | number {
  if (key.startsWith('custom:')) {
    const fieldId = key.slice('custom:'.length);
    const raw = item.custom?.[fieldId];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    const asNumber = Number(raw);
    // Sizes and ages are usually numbers stored as text — sort them numerically.
    if (raw !== undefined && raw !== '' && Number.isFinite(asNumber)) return asNumber;
    return normalize(raw);
  }

  switch (key) {
    case 'quantity': return item.quantity;
    case 'price': return item.price;
    case 'value': return item.quantity * item.price;
    case 'barcode': return normalize(item.barcode);
    case 'category': return normalize(categoryName.get(item.categoryId) ?? '');
    case 'updatedAt': return Date.parse(item.updatedAt) || 0;
    case 'createdAt': return Date.parse(item.createdAt) || 0;
    case 'name':
    default: return normalize(item.name);
  }
}

export function sortItems(
  items: Item[],
  sort: SortState,
  categoryName: Map<string, string>,
): Item[] {
  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...items].sort((a, b) => {
    const left = sortValue(a, sort.key, categoryName);
    const right = sortValue(b, sort.key, categoryName);

    if (typeof left === 'number' && typeof right === 'number') {
      if (left !== right) return (left - right) * factor;
    } else {
      const comparison = String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (comparison !== 0) return comparison * factor;
    }

    // Stable, predictable tiebreaker so equal rows never jump around.
    return normalize(a.name).localeCompare(normalize(b.name));
  });
}

export interface Totals {
  skus: number;
  units: number;
  retailValue: number;
  costValue: number;
  lowStock: number;
  outOfStock: number;
}

export function computeTotals(items: Item[], defaultThreshold: number): Totals {
  return items.reduce<Totals>(
    (totals, item) => {
      const level = stockLevel(item, defaultThreshold);
      totals.skus += 1;
      totals.units += item.quantity;
      totals.retailValue += item.quantity * item.price;
      totals.costValue += item.quantity * item.cost;
      if (level === 'low') totals.lowStock += 1;
      if (level === 'out') totals.outOfStock += 1;
      return totals;
    },
    { skus: 0, units: 0, retailValue: 0, costValue: 0, lowStock: 0, outOfStock: 0 },
  );
}
