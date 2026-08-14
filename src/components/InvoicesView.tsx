import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { DraftDocument, PostedDocument } from '../types';
import { Icon } from './Icon';

/**
 * Invoices and delivery notes.
 *
 * The point of this screen is that a delivery is one action rather than thirty.
 * Lines are collected first — by scanning, searching or reading the supplier's
 * own CSV — the totals are shown while there is still time to disagree with
 * them, and only then does any stock move.
 *
 * A posted document is not editable. If it was wrong it is voided, which posts
 * the opposite; the original stays visible, because the stock really did move.
 */
export function InvoicesView() {
  const {
    db, drafts, refreshDrafts, startDoc, updateDoc, setDocLine, removeDocLine,
    discardDoc, postDoc, voidDoc, listDocs, importDocCsv,
  } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<PostedDocument[]>([]);
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const currency = db.settings.currency;
  const vatOn = db.settings.vatEnabled;

  const refreshHistory = useCallback(async () => {
    const list = await listDocs({ limit: 50 });
    if (list) setHistory(list);
  }, [listDocs]);

  useEffect(() => { void refreshDrafts(); void refreshHistory(); }, [refreshDrafts, refreshHistory]);

  const draft: DraftDocument | undefined = drafts.find((d) => d.id === openId) ?? drafts[0];
  useEffect(() => { if (draft && openId !== draft.id) setOpenId(draft.id); }, [draft, openId]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return db.items
      .filter((item) => item.name.toLowerCase().includes(needle) || item.barcode.includes(needle))
      .slice(0, 6);
  }, [db.items, search]);

  async function addLine(itemId: string) {
    if (!draft) return;
    await setDocLine(draft.id, { itemId, quantity: Math.max(1, Number(quantity) || 1) });
    setSearch('');
    setQuantity('1');
  }

  async function post() {
    if (!draft) return;
    setBusy(true);
    const done = await postDoc(draft.id);
    setBusy(false);
    setConfirming(false);
    if (done) { setOpenId(null); void refreshHistory(); }
  }

  const clientName = (id: string) => db.clients.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('docs.title')}</h1>
        <p className="view-sub">{t('docs.sub')}</p>
      </header>

      {!draft && (
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => void startDoc('in')}>
            <Icon name="download" size={16} />
            {t('docs.newIn')}
          </button>
          <button type="button" className="btn" onClick={() => void startDoc('out')}>
            <Icon name="upload" size={16} />
            {t('docs.newOut')}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------ the draft */}
      {draft && (
        <div className="panel form-panel">
          <h3 className="panel-title">
            {draft.kind === 'in' ? t('docs.incoming') : t('docs.outgoing')}
          </h3>
          <p className="panel-sub">{t('docs.draftNote')}</p>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="doc-number">{t('docs.number')}</label>
              <input
                id="doc-number"
                className="input"
                value={draft.number}
                onChange={(e) => void updateDoc(draft.id, { number: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="doc-date">{t('docs.date')}</label>
              <input
                id="doc-date"
                className="input"
                type="date"
                value={draft.date}
                onChange={(e) => void updateDoc(draft.id, { date: e.target.value })}
              />
            </div>
            {draft.kind === 'in' ? (
              <div className="field">
                <label className="field-label" htmlFor="doc-supplier">{t('docs.supplier')}</label>
                <input
                  id="doc-supplier"
                  className="input"
                  value={draft.supplier}
                  onChange={(e) => void updateDoc(draft.id, { supplier: e.target.value })}
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="field">
                <label className="field-label" htmlFor="doc-client">{t('docs.customer')}</label>
                <select
                  id="doc-client"
                  className="select"
                  value={draft.clientId}
                  onChange={(e) => void updateDoc(draft.id, { clientId: e.target.value })}
                >
                  <option value="">{t('docs.noCustomer')}</option>
                  {db.clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Adding a line: scan, or type a name. */}
          <div className="toolbar">
            <div className="field search-field" style={{ flex: 1 }}>
              <Icon name="search" size={16} />
              <label className="visually-hidden" htmlFor="doc-search">{t('docs.findLabel')}</label>
              <input
                id="doc-search"
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('docs.findPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="field" style={{ width: 90 }}>
              <label className="visually-hidden" htmlFor="doc-qty">{t('docs.quantity')}</label>
              <input
                id="doc-qty"
                className="input"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                aria-label={t('docs.quantity')}
              />
            </div>
            <button type="button" className="btn" onClick={() => void importDocCsv(draft.id)}>
              <Icon name="upload" size={16} />
              {t('docs.importCsv')}
            </button>
          </div>

          {matches.length > 0 && (
            <div className="record-list">
              {matches.map((item) => (
                <button
                  type="button"
                  className="record match-row"
                  key={item.id}
                  onClick={() => void addLine(item.id)}
                >
                  <span className="record-title">{item.name}</span>
                  <span className="record-sub">
                    {item.barcode || '—'} · {t('docs.inStockNow', { count: item.quantity })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {draft.lines.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('docs.product')}</th>
                  <th className="num">{t('docs.quantity')}</th>
                  <th className="num">{t('docs.unitPrice')}</th>
                  {vatOn && <th className="num">{t('vat.rate')}</th>}
                  <th className="num">{t('docs.lineTotal')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  // Lines have no id of their own — the same product can appear
                  // twice at two prices, which is a real thing on an invoice.
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={`${line.itemId}-${index}`}>
                    <td>{line.name}</td>
                    <td className="num">
                      <input
                        className="input count-input"
                        inputMode="numeric"
                        value={String(line.quantity)}
                        onChange={(e) => void setDocLine(draft.id, {
                          itemId: line.itemId,
                          quantity: Number(e.target.value.replace(/[^0-9]/g, '')) || 0,
                          unitPrice: line.unitPrice,
                          vatRate: line.vatRate,
                          lineId: index,
                        })}
                        aria-label={t('docs.quantityFor', { name: line.name })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input count-input"
                        inputMode="decimal"
                        value={String(line.unitPrice)}
                        onChange={(e) => void setDocLine(draft.id, {
                          itemId: line.itemId,
                          quantity: line.quantity,
                          unitPrice: e.target.value,
                          vatRate: line.vatRate,
                          lineId: index,
                        })}
                        aria-label={t('docs.priceFor', { name: line.name })}
                      />
                    </td>
                    {vatOn && <td className="num">{line.vatRate}%</td>}
                    <td className="num">
                      {formatMoney(line.quantity * line.unitPrice, currency, locale)}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => void removeDocLine(draft.id, index)}
                        aria-label={t('docs.removeLine', { name: line.name })}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="doc-totals">
            <span>{t('docs.lines', { count: draft.totals.lines })}</span>
            <span>{t('docs.units', { count: formatNumber(draft.totals.units, locale) })}</span>
            {vatOn && (
              <>
                <span>{t('vat.net')}: {formatMoney(draft.totals.net, currency, locale)}</span>
                <span>{t('vat.vat')}: {formatMoney(draft.totals.vat, currency, locale)}</span>
              </>
            )}
            <strong>{t('docs.total')}: {formatMoney(draft.totals.gross, currency, locale)}</strong>
          </div>

          {confirming ? (
            <div className="callout warn">
              <Icon name="alert" size={18} />
              <div>
                <div>
                  {draft.kind === 'in'
                    ? t('docs.confirmIn', { count: formatNumber(draft.totals.units, locale) })
                    : t('docs.confirmOut', { count: formatNumber(draft.totals.units, locale) })}
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => setConfirming(false)}>
                    {t('dialog.cancel')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void post()} disabled={busy}>
                    {t('docs.confirmBtn')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="form-actions">
              <button type="button" className="btn danger" onClick={() => void discardDoc(draft.id)}>
                {t('docs.discard')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConfirming(true)}
                disabled={busy || draft.lines.length === 0}
              >
                <Icon name="check" size={16} />
                {t('docs.post')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------- what was posted */}
      <section className="stat-section">
        <h2 className="stat-heading">{t('docs.historyTitle')}</h2>
        {history.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="receipt" size={26} /></div>
              <h3>{t('docs.emptyTitle')}</h3>
              <p>{t('docs.emptyBody')}</p>
            </div>
          </div>
        ) : (
          <div className="record-list">
            {history.map((document) => (
              <div className={document.voided ? 'record is-voided' : 'record'} key={document.id}>
                <div className="record-main">
                  <div className="record-title">
                    {document.kind === 'in' ? t('docs.incoming') : t('docs.outgoing')}
                    {document.number ? ` · ${document.number}` : ''}
                    {document.voided && <span className="badge badge-out">{t('docs.voided')}</span>}
                    {document.voids && <span className="badge badge-neutral">{t('docs.reversal')}</span>}
                  </div>
                  <div className="record-sub">
                    {formatDateTime(document.postedAt, locale)}
                    {document.supplier ? ` · ${document.supplier}` : ''}
                    {document.clientId ? ` · ${clientName(document.clientId)}` : ''}
                    {' · '}
                    {t('docs.summary', {
                      lines: document.totals.lines,
                      units: formatNumber(document.totals.units, locale),
                      money: formatMoney(document.totals.gross, currency, locale),
                    })}
                    {document.date ? ` · ${formatDate(document.date, locale)}` : ''}
                  </div>
                </div>
                <div className="record-actions">
                  {!document.voided && !document.voids && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => { await voidDoc(document.id); void refreshHistory(); }}
                    >
                      {t('docs.void')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="callout">
        <Icon name="info" size={18} />
        <div>{t('docs.note')}</div>
      </div>
    </div>
  );
}
