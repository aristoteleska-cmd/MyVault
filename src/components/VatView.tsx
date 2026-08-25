import { useCallback, useEffect, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import type { VatPeriod, VatReport } from '../types';
import { Icon } from './Icon';

const CHOICES = [
  { id: 'thisQuarter', labelKey: 'vat.thisQuarter' },
  { id: 'lastQuarter', labelKey: 'vat.lastQuarter' },
  { id: 'thisYear', labelKey: 'vat.thisYear' },
  { id: 'lastYear', labelKey: 'vat.lastYear' },
] as const;

type ChoiceId = typeof CHOICES[number]['id'];

/**
 * What the shop owes.
 *
 * The one figure that matters is at the top and is deliberately not the VAT on
 * sales: it is that less the VAT already paid to suppliers, which is what a
 * retailer actually hands over. Showing sales VAT as "what you owe" would have
 * a shop paying substantially more than it should.
 */
export function VatView() {
  const { db, vatReport, vatPeriods, printPdf } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [periods, setPeriods] = useState<Record<ChoiceId, VatPeriod> | null>(null);
  const [choice, setChoice] = useState<ChoiceId>('thisQuarter');
  const [data, setData] = useState<VatReport | null>(null);
  const [loading, setLoading] = useState(true);

  const currency = db.settings.currency;
  const money = useCallback(
    (value: number) => formatMoney(value, currency, locale),
    [currency, locale],
  );

  useEffect(() => { void vatPeriods().then((p) => setPeriods(p?.periods ?? null)); }, [vatPeriods]);

  useEffect(() => {
    if (!periods) return;
    setLoading(true);
    void vatReport(periods[choice]).then((next) => { setData(next); setLoading(false); });
  }, [periods, choice, vatReport]);

  async function print() {
    if (!data || !periods) return;
    const period = periods[choice];
    await printPdf({
      kind: 'vat',
      fileName: 'myvault-vat',
      payload: {
        title: t('vat.title'),
        shop: db.settings.shopName,
        when: new Date().toLocaleString(locale || undefined),
        lines: {
          collected: data.collected.rates.map((r) => ({
            rate: `${r.rate}%`,
            net: money(r.net),
            vat: money(r.vat),
            gross: money(r.gross),
          })),
          paid: data.paid.rates.map((r) => ({
            rate: `${r.rate}%`,
            net: money(r.net),
            vat: money(r.vat),
            gross: money(r.gross),
          })),
        },
        totals: {
          collected: money(data.collected.vat),
          paid: money(data.paid.vat),
          payable: money(Math.abs(data.payable)),
          payableLabel: data.payable >= 0 ? t('vat.payable') : t('vat.refundable'),
          excluded: data.excluded.movements
            ? t('vat.excludedNote', { count: data.excluded.movements })
            : '',
          withoutRate: data.withoutRate ? t('vat.withoutRateNote', { count: data.withoutRate }) : '',
        },
        labels: {
          rate: t('vat.rate'),
          net: t('vat.net'),
          vat: t('vat.vat'),
          gross: t('vat.gross'),
          onSales: t('vat.onSales'),
          onPurchases: t('vat.onPurchases'),
          noSales: t('vat.noSales'),
          noPurchases: t('vat.noPurchases'),
          collected: t('vat.collected'),
          paid: t('vat.paid'),
          caveat: t('vat.caveat'),
          period: `${formatDate(period.from, locale)} — ${formatDate(period.to, locale)}`,
        },
      },
    });
  }

  if (!db.settings.vatEnabled) {
    return (
      <div className="view">
        <div className="view-narrow">
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="receipt" size={26} /></div>
              <h3>{t('vat.offTitle')}</h3>
              <p>{t('vat.offBody')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const period = periods?.[choice];

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('vat.title')}</h1>
        <p className="view-sub">{t('vat.sub')}</p>
      </header>

      <div className="stat-section-head">
        <div className="segmented" role="group" aria-label={t('vat.periodAria')}>
          {CHOICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="segment"
              aria-pressed={choice === entry.id}
              onClick={() => setChoice(entry.id)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => void print()} disabled={!data}>
          <Icon name="download" size={16} />
          {t('vat.printBtn')}
        </button>
      </div>

      {period && (
        <p className="panel-sub">
          {formatDate(period.from, locale)} — {formatDate(period.to, locale)}
        </p>
      )}

      {loading && <div className="panel"><p className="panel-empty">{t('vat.loading')}</p></div>}

      {!loading && data && (
        <>
          {/* The bill, and the two halves it is made of. Deliberately in this
              order: a shop reading only the first card would otherwise take the
              VAT on its sales for the amount due. */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">{t('vat.collected')}</div>
              <div className="stat-value">{money(data.collected.vat)}</div>
              <div className="stat-note">{t('vat.collectedNote', { money: money(data.collected.gross) })}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('vat.paid')}</div>
              <div className="stat-value">−{money(data.paid.vat)}</div>
              <div className="stat-note">{t('vat.paidNote')}</div>
            </div>
            <div className={data.payable >= 0 ? 'stat-card is-owed' : 'stat-card is-refund'}>
              <div className="stat-label">
                {data.payable >= 0 ? t('vat.payable') : t('vat.refundable')}
              </div>
              <div className="stat-value">{money(Math.abs(data.payable))}</div>
              <div className="stat-note">
                {data.payable >= 0 ? t('vat.payableNote') : t('vat.refundableNote')}
              </div>
            </div>
          </div>

          <section className="stat-columns">
            <div className="panel">
              <h3 className="panel-title">{t('vat.onSales')}</h3>
              {data.collected.rates.length === 0 ? (
                <p className="panel-empty">{t('vat.noSales')}</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('vat.rate')}</th>
                      <th scope="col" className="num">{t('vat.net')}</th>
                      <th scope="col" className="num">{t('vat.vat')}</th>
                      <th scope="col" className="num">{t('vat.gross')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.collected.rates.map((rate) => (
                      <tr key={rate.rate}>
                        <td>{rate.rate}%</td>
                        <td className="num">{money(rate.net)}</td>
                        <td className="num"><strong>{money(rate.vat)}</strong></td>
                        <td className="num">{money(rate.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3 className="panel-title">{t('vat.onPurchases')}</h3>
              <p className="panel-sub">{t('vat.onPurchasesSub')}</p>
              {data.paid.rates.length === 0 ? (
                <p className="panel-empty">{t('vat.noPurchases')}</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('vat.rate')}</th>
                      <th scope="col" className="num">{t('vat.net')}</th>
                      <th scope="col" className="num">{t('vat.vat')}</th>
                      <th scope="col" className="num">{t('vat.gross')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paid.rates.map((rate) => (
                      <tr key={rate.rate}>
                        <td>{rate.rate}%</td>
                        <td className="num">{money(rate.net)}</td>
                        <td className="num"><strong>{money(rate.vat)}</strong></td>
                        <td className="num">{money(rate.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* What was left out, said plainly rather than quietly dropped. */}
          {(data.excluded.movements > 0 || data.withoutRate > 0) && (
            <div className="callout">
              <Icon name="info" size={18} />
              <div>
                {data.excluded.movements > 0
                  && <div>{t('vat.excludedNote', { count: data.excluded.movements })}</div>}
                {data.withoutRate > 0
                  && <div>{t('vat.withoutRateNote', { count: formatNumber(data.withoutRate, locale) })}</div>}
              </div>
            </div>
          )}
        </>
      )}

      {/* Standing advice, not something that just happened — so no `role="alert"`.
          A screen reader that announced this every time the screen was drawn
          would be interrupting to say the same sentence it said last time. */}
      <div className="callout warn">
        <Icon name="alert" size={18} />
        <div>{t('vat.caveat')}</div>
      </div>
    </div>
  );
}
