export { nextCategoryColor, CATEGORY_COLORS } from './format';

/**
 * Accepts what a shop owner would actually type for money — "12,50", "12.50",
 * " 12.5 " — and returns a plain number, or null when it is not a number at all.
 */
export function normalizeNumberInput(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
