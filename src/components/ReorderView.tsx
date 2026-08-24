import { useCallback, useEffect, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatMoney, formatNumber } from '../lib/format';
import type { ReorderList } from '../types';
import { Icon } from './Icon';

/** How far back to look at sales when working out how fast something moves. */
const WINDOWS = [
  { days: 14, labelKey: 'reorder.window14' },
  { days: 30, labelKey: 'reorder.window30' },
  { days: 90, labelKey: 'reorder.window90' },
] as const;

/**
 * What to order this morning.
 *
 * Everything at or below its limit, with a suggested quantity worked out from
 * what actually sold, grouped by the supplier the order has to go to — because
 * ordering happens one supplier at a time, on the phone or by email, and a list
 * sorted any other way has to be re-sorted by hand before it can be used.
 */
export function ReorderView({ onBrowseItem }: { onBrowseItem: (name: string) => void }) {
  const { db, reorderList, printPdf } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [days, setDays] = useState<number>(30);
  const [list, setList] = useState<ReorderList | null>(null);
  const [loading, setLoading] = useState(true);

  const currency = db.settings.currency;

  const load = useCallback(async (span: number) => {
    setLoading(true);
    setList(await reorderList({ days: span }));
    setLoading(false);
  }, [reorderList]);

  useEffect(() => { void load(days); }, [load, days]);

  async function print() {
    if (!list) return;
    await printPdf({
      kind: 'reorder',
      fileName: 'myvault-order',
      payload: {
        title: t('reorder.title'),
        shop: db.settings.shopName,
        when: new Date().toLocaleString(locale || undefined),
        suppliers: list.suppliers.map((supplier) => ({
          supplier: supplier.supplier,
          units: formatNumber(supplier.units, locale),
          cost: formatMoney(supplier.cost, currency, locale),
          items: supplier.items.map((item) => ({
            name: item.name,
            barcode: item.barcode,
            quantity: formatNumber(item.quantity, locale),
            sold: formatNumber(item.sold, locale),
            suggested: formatNumber(item.suggested, locale),
            urgent: item.urgent,
          })),
        })),
        totals: {
          lines: formatNumber(list.lines, locale),
          urgent: formatNumber(list.urgent, locale),
          estimatedCost: formatMoney(list.estimatedCost, currency, locale),
        },
        labels: {
          product: t('reorder.product'),
          barcode: t('table.barcode'),
          inStock: t('reorder.inStock'),
          sold: t('reorder.sold', { days }),
          suggested: t('reorder.suggested'),
          order: t('reorder.orderColumn'),
          outNow: t('reorder.outNow'),
          noSupplier: t('reorder.noSupplier'),
          supplierTotal: t('reorder.supplierTotal'),
          lines: t('reorder.lines'),
          estimatedCost: t('reorder.estimatedCost'),
          basedOn: t('reorder.basedOn', { days }),
          nothing: t('reorder.nothing'),
        },
      },
    });
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('reorder.title')}</h1>
        <p className="view-sub">{t('reorder.sub')}</p>
      </header>

      <div className="stat-section-head">
        <div className="segmented" role="group" aria-label={t('reorder.windowAria')}>
          {WINDOWS.map((window) => (
            <button
              key={window.days}
              type="button"
              className="segment"
              aria-pressed={days === window.days}
              onClick={() => setDays(window.days)}
            >
              {t(window.labelKey)}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => void print()} disabled={!list?.lines}>
          <Icon name="download" size={16} />
          {t('reorder.printBtn')}
        </button>
      </div>

      {loading && <div className="panel"><p className="panel-empty">{t('reorder.loading')}</p></div>}

      {!loading && list && list.lines === 0 && (
        <div className="panel">
          <div className="empty">
            <div className="empty-art"><Icon name="check" size={26} /></div>
            <h3>{t('reorder.emptyTitle')}</h3>
            <p>{t('reorder.emptyBody')}</p>
          </div>
        </div>
      )}

      {!loading && list && list.lines > 0 && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">{t('reorder.lines')}</div>
              <div className="stat-value">{formatNumber(list.lines, locale)}</div>
              <div className="stat-note">{t('reorder.acrossSuppliers', { count: list.suppliers.length })}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('reorder.outNow')}</div>
              <div className="stat-value">{formatNumber(list.urgent, locale)}</div>
              <div className="stat-note">{t('reorder.urgentNote')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('reorder.estimatedCost')}</div>
              <div className="stat-value">{formatMoney(list.estimatedCost, currency, locale)}</div>
              <div className="stat-note">{t('reorder.estimatedNote')}</div>
            </div>
          </div>

          {list.suppliers.map((supplier) => (
            <div className="panel supplier-panel" key={supplier.supplier || '—'}>
              <div className="panel-head">
                <span>{supplier.supplier || t('reorder.noSupplier')}</span>
                <span className="panel-head-right">
                  {t('reorder.supplierSummary', {
                    count: formatNumber(supplier.units, locale),
                    money: formatMoney(supplier.cost, currency, locale),
                  })}
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('reorder.product')}</th>
                    <th scope="col" className="num">{t('reorder.inStock')}</th>
                    <th scope="col" className="num">{t('reorder.sold', { days })}</th>
                    <th scope="col" className="num">{t('reorder.suggested')}</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button type="button" className="rank-name" onClick={() => onBrowseItem(item.name)}>
                          {item.name}
                        </button>
                        {item.urgent && <span className="badge badge-out">{t('reorder.outNow')}</span>}
                      </td>
                      <td className="num">{formatNumber(item.quantity, locale)}</td>
                      <td className="num">{formatNumber(item.sold, locale)}</td>
                      <td className="num"><strong>{formatNumber(item.suggested, locale)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      <div className="callout">
        <Icon name="info" size={18} />
        <div>{t('reorder.note')}</div>
      </div>
    </div>
  );
}
