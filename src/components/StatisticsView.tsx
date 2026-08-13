import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import type { StatsReport } from '../types';
import { Icon } from './Icon';

/**
 * How far back the screen is looking. Days, because that is how a shopkeeper
 * asks the question — "how did last week go" rather than "give me a range".
 */
const PERIODS = [
  { days: 7, labelKey: 'stats.week' },
  { days: 30, labelKey: 'stats.month' },
  { days: 90, labelKey: 'stats.quarter' },
  { days: 365, labelKey: 'stats.year' },
] as const;

/**
 * A bar chart drawn with plain elements.
 *
 * No charting library: MyVault ships with no external assets and this is a row
 * of divs with a height, which scales, prints and reads by screen reader better
 * than a canvas would.
 */
function Timeline({ report, currency, locale }: {
  report: StatsReport;
  currency: string;
  locale: string;
}) {
  const t = useT();
  const peak = Math.max(1, ...report.timeline.map((point) => point.sold));

  if (report.timeline.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="chart" size={26} /></div>
        <h3>{t('stats.emptyTitle')}</h3>
        <p>{t('stats.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="chart" role="img" aria-label={t('stats.chartAria')}>
      {report.timeline.map((point) => {
        const label = report.range.grouping === 'month'
          ? point.key
          : formatDate(`${point.key}T12:00:00`, locale);
        return (
          <div className="chart-col" key={point.key}>
            <div
              className="chart-bar"
              style={{ height: `${Math.max(2, (point.sold / peak) * 100)}%` }}
              title={t('stats.chartPoint', {
                date: label,
                count: formatNumber(point.sold, locale),
                money: formatMoney(point.takings, currency, locale),
              })}
            />
          </div>
        );
      })}
    </div>
  );
}

/** "Up 12% on the week before", or nothing at all when there is nothing to compare. */
function Change({ now, before }: { now: number; before: number }) {
  const t = useT();
  if (before <= 0) return null;
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return <span className="trend">{t('stats.trendSame')}</span>;
  return (
    <span className={percent > 0 ? 'trend up' : 'trend down'}>
      <Icon name={percent > 0 ? 'arrowUp' : 'arrowDown'} size={13} />
      {t(percent > 0 ? 'stats.trendUp' : 'stats.trendDown', { percent: Math.abs(percent) })}
    </span>
  );
}

export function StatisticsView({ onBrowseItem }: { onBrowseItem: (name: string) => void }) {
  const { db, statsReport } = useVault();
  const { locale } = useI18n();
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const currency = db.settings.currency;

  const load = useCallback(async (span: number) => {
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - (span - 1) * 86400000);
    from.setHours(0, 0, 0, 0);
    const next = await statsReport({ from: from.toISOString(), to: to.toISOString() });
    setReport(next);
    setLoading(false);
  }, [statsReport]);

  useEffect(() => { void load(days); }, [load, days]);

  const money = useMemo(
    () => (value: number) => formatMoney(value, currency, locale),
    [currency, locale],
  );
  const count = useMemo(() => (value: number) => formatNumber(value, locale), [locale]);

  if (!report) {
    return (
      <div className="view">
        <div className="panel"><div className="empty"><p>{t(loading ? 'stats.loading' : 'stats.emptyTitle')}</p></div></div>
      </div>
    );
  }

  const { stock, sales, previous } = report;

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('stats.title')}</h1>
        <p className="view-sub">{t('stats.sub')}</p>
      </header>

      {/* ---------------------------------------------------- on the shelves */}
      <section className="stat-section">
        <h2 className="stat-heading">{t('stats.shelvesTitle')}</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">{t('stats.retailValue')}</div>
            <div className="stat-value">{money(stock.retailValue)}</div>
            <div className="stat-note">{t('stats.retailNote', { count: count(stock.units) })}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.costValue')}</div>
            <div className="stat-value">{money(stock.costValue)}</div>
            <div className="stat-note">{t('stats.costNote')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.products')}</div>
            <div className="stat-value">{count(stock.items)}</div>
            <div className="stat-note">
              {t('stats.stockSplit', { low: count(stock.low), out: count(stock.out) })}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.potential')}</div>
            <div className="stat-value">{money(stock.potentialProfit)}</div>
            <div className="stat-note">{t('stats.potentialNote')}</div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ what happened */}
      <section className="stat-section">
        <div className="stat-section-head">
          <h2 className="stat-heading">{t('stats.movementTitle')}</h2>
          <div className="segmented" role="group" aria-label={t('stats.periodAria')}>
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                className="segment"
                aria-pressed={days === period.days}
                onClick={() => setDays(period.days)}
              >
                {t(period.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">{t('stats.takings')}</div>
            <div className="stat-value">{money(sales.takings)}</div>
            <div className="stat-note">
              <Change now={sales.takings} before={previous.takings} />
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.sold')}</div>
            <div className="stat-value">{count(sales.units)}</div>
            <div className="stat-note">
              <Change now={sales.units} before={previous.units} />
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.profit')}</div>
            <div className="stat-value">{money(sales.profit)}</div>
            <div className="stat-note">{t('stats.profitNote', { money: money(sales.costOfSales) })}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('stats.received')}</div>
            <div className="stat-value">{count(sales.received)}</div>
            <div className="stat-note">{t('stats.receivedNote', { money: money(sales.spend) })}</div>
          </div>
        </div>

        <div className="panel chart-panel">
          <Timeline report={report} currency={currency} locale={locale} />
          <div className="chart-foot">
            {t(report.range.grouping === 'month' ? 'stats.perMonth' : 'stats.perDay')}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- lists */}
      <section className="stat-columns">
        <div className="panel">
          <h3 className="panel-title">{t('stats.bestSellers')}</h3>
          {report.bestSellers.length === 0 ? (
            <p className="panel-empty">{t('stats.noSales')}</p>
          ) : (
            <ol className="rank-list">
              {report.bestSellers.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="rank-name" onClick={() => onBrowseItem(entry.name)}>
                    {entry.name}
                  </button>
                  <span className="rank-value">
                    {t('stats.soldUnits', { count: count(entry.units) })}
                    <em>{money(entry.takings)}</em>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">{t('stats.notMoving')}</h3>
          <p className="panel-sub">{t('stats.notMovingSub', { days })}</p>
          {report.notMoving.length === 0 ? (
            <p className="panel-empty">{t('stats.everythingSells')}</p>
          ) : (
            <ol className="rank-list">
              {report.notMoving.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="rank-name" onClick={() => onBrowseItem(entry.name)}>
                    {entry.name}
                  </button>
                  <span className="rank-value">
                    {t('stats.onShelf', { count: count(entry.quantity) })}
                    <em>{money(entry.value)}</em>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">{t('stats.byCategory')}</h3>
          {stock.categories.length === 0 ? (
            <p className="panel-empty">{t('stats.noStock')}</p>
          ) : (
            <ol className="rank-list">
              {stock.categories.map((entry) => (
                <li key={entry.id || 'none'}>
                  <span className="rank-name plain">
                    <span className="dot" style={{ background: entry.color || 'var(--border)' }} />
                    {entry.name || t('stats.noCategory')}
                  </span>
                  <span className="rank-value">
                    {t('stats.productCount', { count: count(entry.items) })}
                    <em>{money(entry.value)}</em>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">{t('stats.topClients')}</h3>
          <p className="panel-sub">{t('stats.topClientsSub')}</p>
          {report.topClients.length === 0 ? (
            <p className="panel-empty">{t('stats.noClientSales')}</p>
          ) : (
            <ol className="rank-list">
              {report.topClients.map((entry) => (
                <li key={entry.id}>
                  <span className="rank-name plain">{entry.name}</span>
                  <span className="rank-value">
                    {t('stats.orders', { count: count(entry.orders) })}
                    <em>{money(entry.takings)}</em>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <div className="callout">
        <Icon name="info" size={18} />
        <div>{t('stats.note')}</div>
      </div>
    </div>
  );
}
