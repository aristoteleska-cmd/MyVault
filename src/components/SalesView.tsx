import { useCallback, useEffect, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';
import type { DocumentSummary, PostedDocument } from '../types';
import { Icon } from './Icon';

/**
 * Everything the shop has sold on paper.
 *
 * The other side of the Invoices screen: that one is for making an invoice,
 * this one is for finding it again — six months later, when a customer rings up
 * about something they bought and nobody remembers which piece of paper it was
 * on. So the search covers everything printed on it, the number and the
 * customer and the products, and the date range is the date on the invoice
 * rather than the day somebody typed it.
 *
 * Nothing is stored here. Every answer is read from the invoice files, which
 * already hold every posted document for good.
 */
export function SalesView() {
  const { searchDocs, docDetail, exportDocsCsv, printPdf, db } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<DocumentSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<(PostedDocument & { clientName: string }) | null>(null);

  const currency = db.settings.currency;

  const run = useCallback(async () => {
    setSearching(true);
    setRows(await searchDocs({ kind: 'out', query, from, to, limit: 300 }));
    setSearching(false);
  }, [searchDocs, query, from, to]);

  // Waited on rather than run per keystroke: each search reads the year files,
  // and a shop typing a customer's name would otherwise start eight of them.
  useEffect(() => {
    const timer = window.setTimeout(() => { void run(); }, 250);
    return () => window.clearTimeout(timer);
  }, [run]);

  const open = useCallback(async (row: DocumentSummary) => {
    if (openId === row.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(row.id);
    setDetail(null);
    setDetail(await docDetail(row.id));
  }, [openId, docDetail]);

  const filtered = Boolean(query || from || to);
  const total = (rows || []).reduce((sum, row) => (row.voided ? sum : sum + row.gross), 0);

  /**
   * The search that is on the screen, taken away on paper or in a spreadsheet.
   *
   * Neither of these sends the rows anywhere: the CSV is written by the main
   * process from the same search, and the PDF is built there too — only the
   * numbers as words cross the bridge. A voided invoice is printed and marked
   * rather than dropped, because it is a record of something that happened,
   * and it is left out of the totals for the same reason.
   */
  async function print() {
    const list = rows || [];
    const money = (value: number) => formatMoney(value, currency, locale);
    const kept = list.filter((row) => !row.voided);
    await printPdf({
      kind: 'documents',
      fileName: 'sales',
      payload: {
        title: t('sales.sheetTitle'),
        shop: db.settings.shopName,
        when: formatDate(new Date().toISOString(), locale),
        labels: {
          date: t('sales.colDate'),
          number: t('sales.colNumber'),
          who: t('sales.colWho'),
          lines: t('sales.colLines'),
          net: t('sales.colNet'),
          vat: t('sales.colVat'),
          total: t('sales.colTotal'),
          count: t('sales.colCount'),
          nothing: t('sales.sheetNothing'),
        },
        totals: {
          count: String(list.length),
          net: money(kept.reduce((sum, row) => sum + row.net, 0)),
          vat: money(kept.reduce((sum, row) => sum + row.vat, 0)),
          gross: money(total),
          range: [from, to].filter(Boolean).join(' — '),
        },
        lines: list.map((row) => ({
          date: formatDate(row.date || row.postedAt, locale),
          number: row.number || '—',
          who: row.clientName,
          lines: String(row.lines),
          net: money(row.net),
          vat: money(row.vat),
          total: money(row.gross),
          mark: row.voided ? t('sales.voided') : (row.voids ? t('sales.reversal') : ''),
        })),
      },
    });
  }

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('sales.title')}</h1>
          <p className="view-sub">{t('sales.sub')}</p>
        </header>

        <div className="toolbar">
          <div className="field search-field" style={{ flex: 1, minWidth: 200 }}>
            <Icon name="search" size={16} />
            <label className="visually-hidden" htmlFor="sales-search">{t('sales.searchLabel')}</label>
            <input
              id="sales-search"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sales.searchPlaceholder')}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sales-from">{t('sales.from')}</label>
            <input
              id="sales-from"
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sales-to">{t('sales.to')}</label>
            <input
              id="sales-to"
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {filtered && (
            <button
              type="button"
              className="btn"
              onClick={() => { setQuery(''); setFrom(''); setTo(''); }}
            >
              {t('sales.clear')}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void exportDocsCsv({ kind: 'out', query, from, to })}
            disabled={!rows || rows.length === 0}
          >
            <Icon name="download" size={16} />
            {t('sales.exportCsv')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void print()}
            disabled={!rows || rows.length === 0}
          >
            <Icon name="file" size={16} />
            {t('sales.printPdf')}
          </button>
        </div>

        {searching && !rows && <p className="panel-empty">{t('sales.searching')}</p>}

        {rows && rows.length === 0 && (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="receipt" size={26} /></div>
              <h3>{filtered ? t('sales.noMatch') : t('sales.emptyTitle')}</h3>
              {!filtered && <p>{t('sales.emptyBody')}</p>}
            </div>
          </div>
        )}

        {rows && rows.length > 0 && (
          <>
            <p className="panel-sub">
              {t('sales.total', {
                count: rows.length,
                money: formatMoney(total, currency, locale),
              })}
            </p>

            <div className="record-list">
              {rows.map((row) => (
                <div className="record client-record" key={row.id}>
                  <div className="record-head">
                    <div className="record-main">
                      <div className="record-title">
                        {row.number || '—'}
                        {row.voided && <span className="badge badge-out">{t('sales.voided')}</span>}
                        {row.voids && <span className="badge badge-neutral">{t('sales.reversal')}</span>}
                      </div>
                      <div className="record-sub">
                        {formatDate(row.date || row.postedAt, locale)}
                        {' · '}
                        {row.clientName
                          ? t('sales.toCustomer', { name: row.clientName })
                          : t('sales.noCustomer')}
                      </div>
                    </div>
                    <div className="record-actions">
                      <span className="cell-strong">{formatMoney(row.gross, currency, locale)}</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void open(row)}
                        aria-expanded={openId === row.id}
                      >
                        {openId === row.id ? t('sales.close') : t('sales.open')}
                      </button>
                    </div>
                  </div>

                  {openId === row.id && (
                    <div className="client-history">
                      {!detail && <p className="panel-empty">{t('sales.searching')}</p>}
                      {detail && (
                        <div className="table-scroll">
                          <table className="table">
                            <thead>
                              <tr>
                                <th scope="col">{t('docs.product')}</th>
                                <th scope="col" className="num">{t('docs.quantity')}</th>
                                <th scope="col" className="num">{t('docs.unitPrice')}</th>
                                <th scope="col" className="num">{t('sales.colTotal')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines.map((line, index) => (
                                <tr key={`${line.itemId}-${index}`}>
                                  <td>{line.name}</td>
                                  <td className="num">{line.quantity}</td>
                                  <td className="num">{formatMoney(line.unitPrice, currency, locale)}</td>
                                  <td className="num">
                                    {formatMoney(
                                      line.quantity * line.unitPrice * (1 - (line.discount || 0) / 100),
                                      currency,
                                      locale,
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
