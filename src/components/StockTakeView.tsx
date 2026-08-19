import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { StockTakeProgress } from '../types';
import { Icon } from './Icon';

/**
 * Counting the shelves.
 *
 * The shape of this screen follows the shape of the job: it is done standing
 * up, on foot, over hours, and it gets interrupted. So the count is saved as
 * each number is typed rather than at the end, nothing on file changes until
 * the shop presses apply, and the whole thing can be abandoned with no
 * consequences at all.
 */
export function StockTakeView() {
  const {
    db, startStockTake, stockTakeProgress, countStockTake,
    cancelStockTake, applyStockTake, printPdf,
  } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [progress, setProgress] = useState<StockTakeProgress | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const currency = db.settings.currency;
  const running = Boolean(db.stockTake);

  useEffect(() => {
    if (!running) { setProgress(null); return; }
    void stockTakeProgress().then(setProgress);
  }, [running, stockTakeProgress]);

  const counts = db.stockTake?.counts ?? {};
  const scope = db.stockTake?.categoryId ?? '';

  const inScope = useMemo(
    () => db.items.filter((item) => !scope || item.categoryId === scope),
    [db.items, scope],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? inScope.filter((item) =>
        item.name.toLowerCase().includes(needle) || item.barcode.includes(needle))
      : inScope;
    // Uncounted first — the list is a worklist, and what is left to do belongs
    // at the top of it.
    return [...list].sort((a, b) => {
      const seen = Number(counts[a.id] !== undefined) - Number(counts[b.id] !== undefined);
      return seen || a.name.localeCompare(b.name, locale);
    });
  }, [inScope, query, counts, locale]);

  const record = useCallback(async (itemId: string, raw: string) => {
    setDrafts((current) => ({ ...current, [itemId]: raw }));
    const clean = raw.trim();
    const next = await countStockTake(itemId, clean === '' ? null : Number(clean));
    if (next) setProgress(next);
  }, [countStockTake]);

  async function begin() {
    setBusy(true);
    const started = await startStockTake(categoryId);
    if (started) setProgress(started);
    setBusy(false);
    searchRef.current?.focus();
  }

  async function finish() {
    setBusy(true);
    await applyStockTake();
    setConfirming(false);
    setProgress(null);
    setDrafts({});
    setBusy(false);
  }

  async function printSheet(blank: boolean) {
    const lines = blank
      ? shown.map((item) => ({ name: item.name, barcode: item.barcode }))
      : (progress?.lines ?? []).map((line) => ({
        name: line.name,
        barcode: line.barcode,
        expected: formatNumber(line.expected, locale),
        counted: formatNumber(line.counted, locale),
        difference: line.difference,
        value: formatMoney(line.value, currency, locale),
      }));

    await printPdf({
      kind: 'stocktake',
      fileName: 'myvault-stock-take',
      payload: {
        title: t('stocktake.title'),
        shop: db.settings.shopName,
        when: new Date().toLocaleString(locale || undefined),
        blank,
        lines,
        totals: progress ? {
          counted: formatNumber(progress.counted, locale),
          matching: formatNumber(progress.matching, locale),
          missingUnits: formatNumber(progress.missingUnits, locale),
          extraUnits: formatNumber(progress.extraUnits, locale),
          shrinkage: formatMoney(progress.shrinkage, currency, locale),
        } : {},
        labels: {
          product: t('stocktake.product'),
          barcode: t('table.barcode'),
          expected: t('stocktake.expected'),
          counted: t('stocktake.counted'),
          difference: t('stocktake.difference'),
          value: t('stocktake.value'),
          matching: t('stocktake.matching'),
          missing: t('stocktake.missing'),
          extra: t('stocktake.extra'),
          shrinkage: t('stocktake.shrinkage'),
          blankNote: t('stocktake.blankNote'),
          nothing: t('stocktake.allMatched'),
        },
      },
    });
  }

  // ------------------------------------------------------------ not started
  if (!running) {
    return (
      <div className="view">
        <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <header className="view-header">
            <h1 className="view-title">{t('stocktake.title')}</h1>
            <p className="view-sub">{t('stocktake.sub')}</p>
          </header>

          <div className="panel form-panel">
            <h3 className="panel-title">{t('stocktake.startTitle')}</h3>
            <p className="panel-sub">{t('stocktake.startBody')}</p>
            <div className="field">
              <label className="field-label" htmlFor="stocktake-scope">{t('stocktake.scope')}</label>
              <select
                id="stocktake-scope"
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t('stocktake.wholeShop', { count: db.items.length })}</option>
                {db.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => void begin()} disabled={busy}>
                <Icon name="check" size={16} />
                {t('stocktake.startBtn')}
              </button>
            </div>
          </div>

          <div className="callout">
            <Icon name="info" size={18} />
            <div>{t('stocktake.note')}</div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- counting
  const done = progress?.counted ?? 0;
  const total = progress?.total ?? inScope.length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('stocktake.title')}</h1>
        <p className="view-sub">
          {t('stocktake.startedAt', { when: formatDateTime(db.stockTake?.startedAt ?? '', locale) })}
          {db.stockTake?.by ? ` · ${db.stockTake.by}` : ''}
        </p>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">{t('stocktake.progress')}</div>
          <div className="stat-value">{done} / {total}</div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('stocktake.matching')}</div>
          <div className="stat-value">{formatNumber(progress?.matching ?? 0, locale)}</div>
          <div className="stat-note">{t('stocktake.differing', { count: progress?.differing ?? 0 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('stocktake.missing')}</div>
          <div className="stat-value">{formatNumber(progress?.missingUnits ?? 0, locale)}</div>
          <div className="stat-note">{t('stocktake.extraNote', { count: progress?.extraUnits ?? 0 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('stocktake.shrinkage')}</div>
          <div className="stat-value">{formatMoney(progress?.shrinkage ?? 0, currency, locale)}</div>
          <div className="stat-note">{t('stocktake.shrinkageNote')}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="field search-field" style={{ flex: 1 }}>
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor="stocktake-search">{t('stocktake.findLabel')}</label>
          <input
            id="stocktake-search"
            ref={searchRef}
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('stocktake.findPlaceholder')}
            autoComplete="off"
          />
        </div>
        <button type="button" className="btn" onClick={() => void printSheet(true)}>
          <Icon name="download" size={16} />
          {t('stocktake.printBlank')}
        </button>
        <button type="button" className="btn" onClick={() => void printSheet(false)} disabled={!progress?.differing}>
          <Icon name="download" size={16} />
          {t('stocktake.printResult')}
        </button>
        <button type="button" className="btn danger" onClick={() => void cancelStockTake()}>
          {t('stocktake.abandon')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setConfirming(true)}
          disabled={busy || !progress?.counted}
        >
          <Icon name="check" size={16} />
          {t('stocktake.apply')}
        </button>
      </div>

      {confirming && (
        <div className="panel form-panel">
          <h3 className="panel-title">{t('stocktake.confirmTitle')}</h3>
          <p className="panel-sub">
            {t('stocktake.confirmBody', {
              count: progress?.differing ?? 0,
              remaining: progress?.remaining ?? 0,
            })}
          </p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>{t('dialog.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => void finish()} disabled={busy}>
              {t('stocktake.confirmBtn')}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <table className="table count-table">
          <thead>
            <tr>
              <th>{t('stocktake.product')}</th>
              <th>{t('table.barcode')}</th>
              <th className="num">{t('stocktake.expected')}</th>
              <th className="num">{t('stocktake.counted')}</th>
              <th className="num">{t('stocktake.difference')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const seen = counts[item.id];
              const draft = drafts[item.id] ?? (seen === undefined ? '' : String(seen));
              const difference = seen === undefined ? null : seen - item.quantity;
              return (
                <tr key={item.id} className={seen === undefined ? '' : 'is-counted'}>
                  <td>{item.name}</td>
                  <td className="mono">{item.barcode || '—'}</td>
                  {/* What the file thinks is deliberately still shown. Hiding it
                      would guard against anchoring, but a shopkeeper counting
                      their own shop wants to see the disagreement as it happens. */}
                  <td className="num">{formatNumber(item.quantity, locale)}</td>
                  <td className="num">
                    <input
                      className="input count-input"
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => void record(item.id, e.target.value.replace(/[^0-9]/g, ''))}
                      aria-label={t('stocktake.countAria', { name: item.name })}
                    />
                  </td>
                  <td className={`num ${difference && difference < 0 ? 'short' : ''} ${difference && difference > 0 ? 'over' : ''}`}>
                    {difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatNumber(difference, locale)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="panel-empty">{t('stocktake.noMatch')}</p>}
      </div>
    </div>
  );
}
