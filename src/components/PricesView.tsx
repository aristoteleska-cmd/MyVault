import { useCallback, useEffect, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatMoney, formatNumber } from '../lib/format';
import type { PriceAdvice, PriceSuggestion } from '../types';
import { Icon } from './Icon';

/**
 * What the shop is charging, against what it is paying.
 *
 * Four lists, in the order a shop should read them. Losing money comes first
 * because every sale of one of those lines makes the shop poorer, and it is the
 * only section that is always wrong rather than merely worth a look. "Bought
 * cheaper" is second, because a deal is only useful while the cheap stock is
 * still on the shelf.
 *
 * Nothing on this screen changes a price by itself. Each suggestion has a button
 * next to it and the shop presses it or does not — a shopkeeper knows about the
 * competitor down the road, and MyVault does not.
 */

const SECTIONS = [
  {
    id: 'losing',
    titleKey: 'prices.losingTitle',
    subKey: 'prices.losingSub',
    emptyKey: 'prices.noLosing',
    tone: 'is-bad',
  },
  {
    id: 'cheaper',
    titleKey: 'prices.cheaperTitle',
    subKey: 'prices.cheaperSub',
    emptyKey: 'prices.noCheaper',
    tone: 'is-good',
  },
  {
    id: 'dearer',
    titleKey: 'prices.dearerTitle',
    subKey: 'prices.dearerSub',
    emptyKey: 'prices.noDearer',
    tone: 'is-warn',
  },
  {
    id: 'thin',
    titleKey: 'prices.thinTitle',
    subKey: 'prices.thinSub',
    emptyKey: 'prices.noThin',
    tone: '',
  },
] as const;

const SUGGESTION_LABELS: Record<PriceSuggestion['kind'], string> = {
  hold: 'prices.holdLabel',
  passOn: 'prices.passOnLabel',
  restore: 'prices.restoreLabel',
  target: 'prices.targetLabel',
  cover: 'prices.coverLabel',
};

const NOTE_KEYS: Record<string, string> = {
  earnsExtra: 'prices.earnsExtra',
  oneOffCost: 'prices.oneOffCost',
  costRose: 'prices.costRose',
  belowTarget: 'prices.belowTarget',
  belowCost: 'prices.belowCost',
};

export function PricesView() {
  const { db, priceReview, applyPrice, printPdf, can } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [data, setData] = useState<Awaited<ReturnType<typeof priceReview>>>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const currency = db.settings.currency;
  const money = useCallback(
    (value: number) => formatMoney(value, currency, locale),
    [currency, locale],
  );
  const pct = useCallback(
    (value: number | null) => (value === null ? '—' : `${formatNumber(value, locale)}%`),
    [locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const next = await priceReview({ limit: 20 });
    setData(next);
    setLoading(false);
  }, [priceReview]);

  useEffect(() => { void load(); }, [load]);

  async function apply(advice: PriceAdvice, suggestion: PriceSuggestion) {
    setBusy(advice.id + suggestion.kind);
    await applyPrice(advice.id, suggestion.price);
    setBusy('');
    // The lists are built from the prices that just changed, so they are read
    // again rather than patched — a product that has been put right should
    // disappear off the screen it was listed on.
    await load();
  }

  async function print() {
    if (!data) return;
    const rows = (list: PriceAdvice[]) => list.map((line) => ({
      name: line.name,
      price: money(line.price),
      cost: money(line.cost),
      margin: pct(line.margin),
      usual: line.history.usual === null ? '—' : money(line.history.usual),
      suggested: line.suggestions.length > 0 && line.suggestions[0].kind !== 'hold'
        ? money(line.suggestions[0].price)
        : '—',
    }));

    await printPdf({
      kind: 'prices',
      fileName: 'myvault-prices',
      payload: {
        title: t('prices.title'),
        shop: db.settings.shopName,
        when: new Date().toLocaleString(locale || undefined),
        target: data.target > 0 ? `${formatNumber(data.target, locale)}%` : '',
        sections: SECTIONS.map((section) => ({
          title: t(section.titleKey),
          rows: rows(data[section.id]),
        })).filter((section) => section.rows.length > 0),
        labels: {
          product: t('prices.product'),
          price: t('prices.priceNow'),
          cost: t('prices.costNow'),
          margin: t('prices.margin'),
          usual: t('prices.usualCost'),
          suggested: t('prices.suggested'),
          targetLabel: t('prices.targetIs'),
          caveat: t('prices.caveat'),
        },
      },
    });
  }

  if (loading && !data) {
    return (
      <div className="view">
        <div className="panel"><p className="panel-empty">{t('prices.loading')}</p></div>
      </div>
    );
  }

  const nothing = data !== null
    && SECTIONS.every((section) => data[section.id].length === 0);

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('prices.title')}</h1>
        <p className="view-sub">{t('prices.sub')}</p>
      </header>

      <div className="stat-section-head">
        <p className="panel-sub">
          {data && data.target > 0
            ? t('prices.targetSet', { percent: formatNumber(data.target, locale) })
            : t('prices.targetUnset')}
        </p>
        <button type="button" className="btn" onClick={() => void print()} disabled={!data || nothing}>
          <Icon name="download" size={16} />
          {t('prices.printBtn')}
        </button>
      </div>

      {nothing && (
        <div className="panel">
          <div className="empty">
            <div className="empty-art"><Icon name="tag" size={26} /></div>
            <h3>{t('prices.allWellTitle')}</h3>
            <p>{t('prices.allWellBody')}</p>
          </div>
        </div>
      )}

      {data && !nothing && SECTIONS.map((section) => {
        const list = data[section.id];
        if (list.length === 0) return null;
        return (
          <section className="panel" key={section.id}>
            <h3 className="panel-title">
              {t(section.titleKey)}
              <span className="panel-count">{formatNumber(data.counts[section.id], locale)}</span>
            </h3>
            <p className="panel-sub">{t(section.subKey)}</p>

            <table className="table">
              <thead>
                <tr>
                  <th>{t('prices.product')}</th>
                  <th className="num">{t('prices.priceNow')}</th>
                  <th className="num">{t('prices.costNow')}</th>
                  <th className="num">{t('prices.margin')}</th>
                  <th>{t('prices.suggested')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((advice) => (
                  <tr key={advice.id} className={section.tone}>
                    <td>
                      <div className="cell-strong">{advice.name}</div>
                      {advice.change && (
                        <div className="cell-note">
                          {t(
                            advice.change.kind === 'cheaper'
                              ? 'prices.changeCheaper'
                              : 'prices.changeDearer',
                            {
                              percent: formatNumber(advice.change.percent, locale),
                              was: money(advice.change.from),
                              now: money(advice.change.to),
                            },
                          )}
                          {' · '}
                          {t('prices.overDelivery', {
                            money: money(Math.abs(advice.change.saving)),
                            count: advice.change.units,
                          })}
                        </div>
                      )}
                      {!advice.change && advice.history.deliveries === 0 && (
                        <div className="cell-note">{t('prices.neverDelivered')}</div>
                      )}
                      {!advice.change && advice.history.usual !== null && (
                        <div className="cell-note">
                          {t('prices.usuallyPaid', { money: money(advice.history.usual) })}
                        </div>
                      )}
                    </td>
                    <td className="num">{money(advice.price)}</td>
                    <td className="num">{money(advice.cost)}</td>
                    <td className="num">
                      <strong>{pct(advice.margin)}</strong>
                      <div className="cell-note">
                        {t('prices.perUnit', { money: money(advice.profit) })}
                      </div>
                    </td>
                    <td>
                      {advice.suggestions.length === 0 && <span className="cell-note">—</span>}
                      <ul className="suggestion-list">
                        {advice.suggestions.map((suggestion) => (
                          <li key={suggestion.kind}>
                            <span className="suggestion-head">
                              {t(SUGGESTION_LABELS[suggestion.kind] as never)}
                            </span>
                            <span className="suggestion-figures">
                              {suggestion.kind === 'hold'
                                ? t('prices.holdFigures', {
                                  money: money(suggestion.extra ?? 0),
                                  from: pct(suggestion.wasMargin ?? null),
                                  to: pct(suggestion.margin),
                                })
                                : t('prices.suggestFigures', {
                                  price: money(suggestion.price),
                                  margin: pct(suggestion.margin),
                                })}
                            </span>
                            {suggestion.note && NOTE_KEYS[suggestion.note] && (
                              <span className="suggestion-note">
                                {t(NOTE_KEYS[suggestion.note] as never)}
                              </span>
                            )}
                            {suggestion.kind !== 'hold' && can('items.edit') && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={busy === advice.id + suggestion.kind}
                                onClick={() => void apply(advice, suggestion)}
                              >
                                {t('prices.applyBtn', { price: money(suggestion.price) })}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <p className="panel-sub">{t('prices.caveat')}</p>
    </div>
  );
}
