import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT, type TranslationKey } from '../i18n';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { DeliveryReview, DraftDocument, PdfInvoiceResult, PostedDocument } from '../types';
import { useEscape } from '../lib/keys';
import { Icon } from './Icon';

/**
 * The columns MyVault actually takes off a supplier's invoice.
 *
 * Left to right in the order an invoice normally prints them, so the sentence
 * on the read panel reads the way the paper does. The columns the reader knows
 * about only so it can ignore them — the unit of measure, the VAT in money —
 * are deliberately not here: naming them would say MyVault used them.
 */
const PDF_COLUMNS = ['code', 'description', 'quantity', 'unitPrice', 'discount', 'vatRate', 'total'];

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
    discardDoc, postDoc, voidDoc, listDocs, importDocCsv, importDocPdf, importDocPdfFile,
    addMissingProduct, notify,
  } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<PostedDocument[]>([]);
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /**
   * Set only when a delivery just came in at prices the shop does not usually
   * pay. Shown as a panel rather than a toast: a cost that moved is worth a
   * decision, and a decision needs the figures to stay on the screen.
   */
  const [priceNews, setPriceNews] = useState<DeliveryReview | null>(null);
  /**
   * What the last PDF said about itself.
   *
   * Kept on screen rather than announced in a toast, for the same reason as the
   * prices above: a supplier, a number and a date that MyVault read off a
   * document are exactly the things a person needs to see while comparing the
   * draft with the paper in their hand — and anything that did not add up has to
   * stay visible until it has been dealt with.
   */
  const [pdfRead, setPdfRead] = useState<PdfInvoiceResult | null>(null);
  /** True while a file is being dragged over the drop area. */
  const [dragging, setDragging] = useState(false);

  // The step before money moves is a strip on the page, not a dialog, so
  // Escape has to be wired up for it. Backing out of a confirmation must
  // always be at least as easy as agreeing to it.
  useEscape(confirming, () => setConfirming(false));

  const currency = db.settings.currency;
  const vatOn = db.settings.vatEnabled;

  /** Column names as words, in the order the invoice printed them. */
  const columnWords = useCallback(
    (names: string[]) => (names || [])
      .filter((name) => PDF_COLUMNS.includes(name))
      .map((name) => t(`docs.pdfCol.${name}` as TranslationKey))
      .join(', '),
    [t],
  );
  /** The ones MyVault would have used and this invoice does not print. */
  const missingColumns = useCallback(
    (names: string[]) => PDF_COLUMNS.filter((name) => !(names || []).includes(name)),
    [],
  );

  const refreshHistory = useCallback(async () => {
    const list = await listDocs({ limit: 50 });
    if (list) setHistory(list);
  }, [listDocs]);

  useEffect(() => { void refreshDrafts(); void refreshHistory(); }, [refreshDrafts, refreshHistory]);

  const draft: DraftDocument | undefined = drafts.find((d) => d.id === openId) ?? drafts[0];
  useEffect(() => { if (draft && openId !== draft.id) setOpenId(draft.id); }, [draft, openId]);

  /**
   * A supplier's PDF, dropped onto the window.
   *
   * The button and the File menu both exist, and a person still arrives at this
   * screen holding a file and looking for somewhere to put it — because that is
   * what every other program has taught them to expect. So there is somewhere
   * to put it.
   */
  const readDroppedPdf = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      notify('docs.dropNotPdf', { name: file.name }, 'info');
      return;
    }
    const filePath = window.myvault?.pathForFile?.(file) || '';
    if (!filePath) {
      notify('docs.dropNoPath', undefined, 'info');
      return;
    }
    setBusy(true);
    try {
      const target = draft ?? await startDoc('in');
      if (!target) return;
      const result = await importDocPdfFile(target.id, filePath);
      if (result) setPdfRead(result);
    } finally {
      setBusy(false);
    }
  }, [draft, startDoc, importDocPdfFile, notify]);

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
    const prices = await postDoc(draft.id);
    setBusy(false);
    setConfirming(false);
    if (!prices) return;
    setOpenId(null);
    // What was read from the PDF described the draft that has just stopped
    // existing. Left on the screen it reads as a description of the next one.
    setPdfRead(null);
    void refreshHistory();
    // Only when something actually moved. A delivery at the usual prices is the
    // normal case and must not put a panel on the screen to be dismissed.
    setPriceNews(prices.lines.length > 0 ? prices : null);
  }

  const clientName = (id: string) => db.clients.find((c) => c.id === id)?.name ?? '';
  const money = (value: number) => formatMoney(value, currency, locale);

  return (
    <div className="view">
      <header className="view-header">
        <h1 className="view-title">{t('docs.title')}</h1>
        <p className="view-sub">{t('docs.sub')}</p>
      </header>

      {/* The one moment the shop is looking at what it paid and can act on it.
          Kept to the figures and a way through to the Prices screen — the
          decision itself belongs there, next to the suggestions. */}
      {priceNews && (
        <div className="panel panel-notice">
          <div className="panel-head">{t('docs.pricesTitle')}</div>
          <p className="panel-sub">
            {[
              priceNews.cheaper ? t('docs.pricesCheaper', { count: priceNews.cheaper }) : '',
              priceNews.dearer ? t('docs.pricesDearer', { count: priceNews.dearer }) : '',
            ].filter(Boolean).join(' · ')}
            {' '}
            {t('docs.pricesWorth', { money: money(Math.abs(priceNews.saving ?? 0)) })}
          </p>
          <ul className="notice-list">
            {priceNews.lines.map((line) => (
              <li key={line.id}>
                <span className="cell-strong">{line.name}</span>
                <span className="cell-note">
                  {t(
                    line.change?.kind === 'cheaper'
                      ? 'prices.changeCheaper'
                      : 'prices.changeDearer',
                    {
                      percent: formatNumber(line.change?.percent ?? 0, locale),
                      was: money(line.change?.from ?? 0),
                      now: money(line.change?.to ?? 0),
                    },
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => setPriceNews(null)}>
              {t('docs.pricesDismiss')}
            </button>
          </div>
        </div>
      )}

      {pdfRead?.invoice && (
        <div className="panel panel-notice">
          <div className="panel-head">{t('docs.pdfReadTitle')}</div>
          <p className="panel-sub">
            {t('docs.pdfReadFrom', {
              supplier: pdfRead.invoice.supplier || t('docs.pdfUnknownSupplier'),
              number: pdfRead.invoice.number || '—',
              date: pdfRead.invoice.date
                ? formatDate(pdfRead.invoice.date, locale)
                : '—',
            })}
          </p>
          <p className="panel-sub">
            {t('docs.pdfReadCounts', {
              read: pdfRead.invoice.read,
              added: pdfRead.added ?? 0,
              missed: pdfRead.unmatched?.length ?? 0,
            })}
            {pdfRead.invoice.totals.gross !== null && (
              <> · {t('docs.pdfPrintedTotal', { money: money(pdfRead.invoice.totals.gross) })}</>
            )}
          </p>

          {/* Which of this supplier's columns MyVault understood.
              Every supplier lays an invoice out differently, and until now the
              only sign that a column had been missed was a cost of nothing or a
              VAT rate that fell back to the shop's own. Saying it plainly turns
              an unfamiliar layout into something the shop can see and describe,
              instead of something only the code can explain. */}
          <p className="panel-sub">
            {t('docs.pdfColumnsFound', { list: columnWords(pdfRead.invoice.columns) })}
            {missingColumns(pdfRead.invoice.columns).length > 0 && (
              <> · {t('docs.pdfColumnsMissing', {
                list: columnWords(missingColumns(pdfRead.invoice.columns)),
              })}</>
            )}
          </p>

          {/* Anything the paper does not agree with itself about. A shop is far
              better served by "line 3 does not add up" than by a draft that is
              quietly wrong in a way nobody will notice until the VAT return. */}
          {pdfRead.invoice.warnings.length > 0 && (
            <ul className="notice-list">
              {pdfRead.invoice.warnings.map((warning) => (
                <li key={warning}>
                  <span className="cell-note">{warning}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Products the shop already stocks that are not costing what they
              cost last time. Shown before the delivery is posted, because that
              is when a shop can still ring the supplier and ask — and because a
              cost that goes up unnoticed is a margin sold away for a month. */}
          {(pdfRead.repriced?.length ?? 0) > 0 && (
            <>
              <p className="panel-sub">{t('docs.pdfRepricedTitle')}</p>
              <ul className="notice-list">
                {pdfRead.repriced?.map((line) => (
                  <li key={line.itemId}>
                    <span className="cell-strong">{line.name}</span>
                    <span className={line.kind === 'dearer' ? 'cell-warn' : 'cell-note'}>
                      {t(line.kind === 'dearer' ? 'docs.pdfDearer' : 'docs.pdfCheaper', {
                        was: money(line.was),
                        now: money(line.now),
                        percent: Math.abs(line.percent),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Products on the invoice that this shop does not stock. They are
              named rather than counted, because the next thing a person does is
              add them, and they need to know which. */}
          {(pdfRead.unmatched?.length ?? 0) > 0 && (
            <>
              <p className="panel-sub">{t('docs.pdfUnmatchedTitle')}</p>
              <ul className="notice-list">
                {pdfRead.unmatched?.map((line) => (
                  <li key={`${line.barcode}-${line.code}-${line.name}`}>
                    <span className="cell-strong">{line.name}</span>
                    <span className="cell-note">
                      {line.barcode || line.code || '—'} · {t('docs.pdfUnmatchedLine', {
                        count: line.quantity,
                        money: money(line.price),
                      })}
                    </span>
                    {/*
                      Without this the feature ends in the loop it was meant to
                      remove: read the PDF, write down what is missing, go to
                      Products, type it, come back, read the PDF again. The line
                      already carries the name, what was paid and the rate.
                    */}
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const done = await addMissingProduct(draft?.id ?? '', line);
                          if (done) {
                            setPdfRead((current) => (current ? {
                              ...current,
                              added: (current.added ?? 0) + 1,
                              unmatched: current.unmatched?.filter((other) => other !== line),
                            } : current));
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Icon name="plus" size={14} />
                      {t('docs.pdfAddMissing')}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="toolbar">
            <button type="button" className="btn" onClick={() => setPdfRead(null)}>
              {t('docs.pricesDismiss')}
            </button>
          </div>
        </div>
      )}

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
          {/*
            Reading a PDF used to live only inside an open delivery, which is
            where it does its work but not where anybody looks for it: a person
            holding an invoice wants to hand MyVault the invoice, not start a
            blank document first and find a button inside it. So the same job
            starts from here — the delivery is created underneath and the PDF
            fills it — and the button is where the task begins.
          */}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const fresh = await startDoc('in');
                if (!fresh) return;
                const result = await importDocPdf(fresh.id);
                if (result) setPdfRead(result);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="file" size={16} />
            {t('docs.importPdf')}
          </button>
        </div>
      )}

      {/*
        Somewhere to put the file.
        
        A button says "I will ask you for a file"; a marked-out area says "put it
        here", which is what a person holding an invoice is looking for. Both
        end in the same place, and dropping is the one that needs no explaining.
      */}
      {!draft && (
        <div
          className={`dropzone${dragging ? ' dropzone-over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void readDroppedPdf(event.dataTransfer?.files ?? null);
          }}
        >
          <Icon name="file" size={28} />
          <p className="dropzone-title">{t('docs.dropTitle')}</p>
          <p className="dropzone-sub">{t('docs.dropSub')}</p>
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
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await importDocPdf(draft.id);
                  if (result) setPdfRead(result);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="file" size={16} />
              {t('docs.importPdf')}
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
                  <th scope="col">{t('docs.product')}</th>
                  <th scope="col" className="num">{t('docs.quantity')}</th>
                  <th scope="col" className="num">{t('docs.unitPrice')}</th>
                  <th scope="col" className="num">{t('docs.discount')}</th>
                  {vatOn && <th scope="col" className="num">{t('vat.rate')}</th>}
                  <th scope="col" className="num">{t('docs.lineTotal')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  // Lines have no id of their own — the same product can appear
                  // twice at two prices, which is a real thing on an invoice.
                  // Keyed by position because an invoice line has no id of
                  // its own: the same product can appear twice on one paper,
                  // at two prices, and both rows are real.
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
                          discount: line.discount,
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
                          discount: line.discount,
                          vatRate: line.vatRate,
                          lineId: index,
                        })}
                        aria-label={t('docs.priceFor', { name: line.name })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input count-input"
                        inputMode="decimal"
                        value={String(line.discount ?? 0)}
                        onChange={(e) => void setDocLine(draft.id, {
                          itemId: line.itemId,
                          quantity: line.quantity,
                          unitPrice: line.unitPrice,
                          discount: e.target.value,
                          vatRate: line.vatRate,
                          lineId: index,
                        })}
                        aria-label={t('docs.discountFor', { name: line.name })}
                      />
                    </td>
                    {vatOn && <td className="num">{line.vatRate}%</td>}
                    <td className="num">
                      {/* The discounted unit price times the quantity, which is
                          exactly what posts and exactly what the VAT return will
                          say — never the list price, or the paper and the return
                          would show different money. */}
                      {formatMoney(
                        Math.round(line.unitPrice * (1 - (line.discount ?? 0) / 100) * 100)
                          / 100 * line.quantity,
                        currency,
                        locale,
                      )}
                      {(line.discount ?? 0) > 0 && (
                        <div className="cell-note">
                          {t('docs.wasBeforeDiscount', {
                            money: formatMoney(line.quantity * line.unitPrice, currency, locale),
                          })}
                        </div>
                      )}
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
            <span>{t('docs.units', { count: draft.totals.units })}</span>
            {vatOn && (
              <>
                <span>{t('vat.net')}: {formatMoney(draft.totals.net, currency, locale)}</span>
                <span>{t('vat.vat')}: {formatMoney(draft.totals.vat, currency, locale)}</span>
              </>
            )}
            <strong>{t('docs.total')}: {formatMoney(draft.totals.gross, currency, locale)}</strong>
          </div>

          {confirming ? (
            <div className="callout warn" role="alert">
              <Icon name="alert" size={18} />
              <div>
                <div>
                  {draft.kind === 'in'
                    ? t('docs.confirmIn', { count: draft.totals.units })
                    : t('docs.confirmOut', { count: draft.totals.units })}
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
