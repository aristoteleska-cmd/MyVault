import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';
import type { DocumentSummary, SupplierBookEntry } from '../types';
import { Icon } from './Icon';

const blank = {
  id: '', name: '', vatNumber: '', phone: '', email: '', note: '',
};

/**
 * Who the shop buys from, and everything they have ever sent.
 *
 * The list of names is kept in the data file; what each supplier has sent is
 * read out of the invoice files when somebody opens them. That is the same
 * arrangement the customers screen uses, and for the same reason: a shop with
 * ten years of deliveries behind it opens this screen as fast as a shop with
 * none, and nothing here can ever disagree with the invoices it came from.
 */
export function SuppliersView() {
  const { supplierBook, saveSupplier, removeSupplier, searchDocs, db } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [query, setQuery] = useState('');
  const [book, setBook] = useState<SupplierBookEntry[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<DocumentSummary[] | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...blank });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const currency = db.settings.currency;

  const refresh = useCallback(async () => {
    setBook(await supplierBook());
  }, [supplierBook]);

  useEffect(() => { void refresh(); }, [refresh, db.suppliers]);

  // Searching is done here rather than in the main process: the book is a page
  // of names, already in hand, and a round trip per keystroke would be slower
  // than the filter it was asking for. The invoices behind each name are the
  // part that lives on disk, and those are fetched only when one is opened.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !book) return book ?? [];
    return book.filter((supplier) => [
      supplier.name, supplier.vatNumber, supplier.phone, supplier.email, supplier.note,
    ].some((field) => String(field || '').toLowerCase().includes(needle)));
  }, [book, query]);

  const openSupplier = useCallback(async (supplier: SupplierBookEntry) => {
    if (openKey === supplier.key) {
      setOpenKey(null);
      setInvoices(null);
      return;
    }
    setOpenKey(supplier.key);
    setInvoices(null);
    setLoadingInvoices(true);
    setInvoices(await searchDocs({ kind: 'in', supplier: supplier.name, limit: 200 }));
    setLoadingInvoices(false);
  }, [openKey, searchDocs]);

  async function commit() {
    if (!draft.name.trim()) return;
    const saved = await saveSupplier(draft);
    if (!saved) return;
    setAdding(false);
    setEditingId(null);
    setDraft({ ...blank });
    await refresh();
  }

  async function remove(id: string) {
    if (!await removeSupplier(id)) return;
    setConfirmingId(null);
    await refresh();
  }

  const fields = (
    <>
      <div className="field">
        <label className="field-label" htmlFor="supplier-name">{t('suppliers.name')}</label>
        <input
          id="supplier-name"
          className="input"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor="supplier-vat">{t('suppliers.vatNumber')}</label>
          <input
            id="supplier-vat"
            className="input"
            value={draft.vatNumber}
            onChange={(e) => setDraft({ ...draft, vatNumber: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="supplier-phone">{t('suppliers.phone')}</label>
          <input
            id="supplier-phone"
            className="input"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="supplier-email">{t('suppliers.email')}</label>
        <input
          id="supplier-email"
          className="input"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="supplier-note">{t('suppliers.note')}</label>
        <textarea
          id="supplier-note"
          className="input"
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </div>
    </>
  );

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('suppliers.title')}</h1>
          <p className="view-sub">{t('suppliers.sub')}</p>
        </header>

        <div className="toolbar">
          <div className="field search-field" style={{ flex: 1 }}>
            <Icon name="search" size={16} />
            <label className="visually-hidden" htmlFor="supplier-search">
              {t('suppliers.searchLabel')}
            </label>
            <input
              id="supplier-search"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('suppliers.searchPlaceholder')}
              autoComplete="off"
            />
          </div>
          {!adding && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { setAdding(true); setDraft({ ...blank }); setEditingId(null); }}
            >
              <Icon name="plus" size={16} />
              {t('suppliers.add')}
            </button>
          )}
        </div>

        {adding && (
          <div className="panel form-panel">
            <h3 className="panel-title">{t('suppliers.addTitle')}</h3>
            {fields}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => { setAdding(false); setDraft({ ...blank }); }}>
                {t('dialog.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void commit()}
                disabled={!draft.name.trim()}
              >
                {t('suppliers.save')}
              </button>
            </div>
          </div>
        )}

        {book && book.length === 0 && !adding && (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="people" size={26} /></div>
              <h3>{t('suppliers.emptyTitle')}</h3>
              <p>{t('suppliers.emptyBody')}</p>
            </div>
          </div>
        )}

        {book && book.length > 0 && shown.length === 0 && (
          <p className="panel-empty">{t('suppliers.noMatch')}</p>
        )}

        {shown.length > 0 && (
          <div className="record-list">
            {shown.map((supplier) => (
              <div className="record client-record" key={supplier.key}>
                {editingId && editingId === supplier.id ? (
                  <div className="record-main">
                    {fields}
                    <div className="form-actions">
                      <button type="button" className="btn" onClick={() => setEditingId(null)}>
                        {t('dialog.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void commit()}
                        disabled={!draft.name.trim()}
                      >
                        {t('suppliers.save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="record-head">
                      <div className="record-main">
                        <div className="record-title">{supplier.name}</div>
                        <div className="record-sub">
                          {[supplier.vatNumber, supplier.phone, supplier.email]
                            .filter(Boolean).join(' · ') || t('suppliers.noContact')}
                        </div>
                        <div className="record-sub">
                          {supplier.invoices > 0
                            ? t('suppliers.summary', {
                              count: supplier.invoices,
                              money: formatMoney(supplier.spent, currency, locale),
                              date: formatDate(supplier.last, locale),
                            })
                            : t('suppliers.nothingYet')}
                        </div>
                      </div>

                      <div className="record-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void openSupplier(supplier)}
                          aria-expanded={openKey === supplier.key}
                        >
                          {t('suppliers.invoices')}
                        </button>
                        {/* A supplier known only from old invoices has no entry
                            to edit or remove — there is nothing of theirs in the
                            list yet. Saving them from the Add button gives them
                            one, and their history is waiting under the name. */}
                        {supplier.id && (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => {
                                setAdding(false);
                                setEditingId(supplier.id);
                                setDraft({
                                  id: supplier.id,
                                  name: supplier.name,
                                  vatNumber: supplier.vatNumber,
                                  phone: supplier.phone,
                                  email: supplier.email,
                                  note: supplier.note,
                                });
                              }}
                              aria-label={t('suppliers.editAria', { name: supplier.name })}
                              title={t('suppliers.edit')}
                            >
                              <Icon name="pencil" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => setConfirmingId(supplier.id)}
                              aria-label={t('suppliers.deleteAria', { name: supplier.name })}
                              title={t('suppliers.delete')}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {supplier.note && <div className="record-notes">{supplier.note}</div>}

                    {confirmingId === supplier.id && (
                      <div className="callout warn" role="alert">
                        <Icon name="alert" size={16} />
                        <div>
                          <p>{t('suppliers.deleteWarn')}</p>
                          <div className="form-actions">
                            <button type="button" className="btn" onClick={() => setConfirmingId(null)}>
                              {t('dialog.cancel')}
                            </button>
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => void remove(supplier.id)}
                            >
                              {t('suppliers.delete')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {openKey === supplier.key && (
                      <div className="client-history">
                        {loadingInvoices && <p className="panel-empty">{t('sales.searching')}</p>}
                        {!loadingInvoices && invoices && invoices.length === 0 && (
                          <p className="panel-empty">{t('suppliers.nothingYet')}</p>
                        )}
                        {!loadingInvoices && invoices && invoices.length > 0 && (
                          <>
                            {supplier.first && (
                              <p className="panel-sub">
                                {t('suppliers.since', { date: formatDate(supplier.first, locale) })}
                              </p>
                            )}
                            <div className="table-scroll">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th scope="col">{t('sales.colDate')}</th>
                                    <th scope="col">{t('sales.colNumber')}</th>
                                    <th scope="col" className="num">{t('sales.colLines')}</th>
                                    <th scope="col" className="num">{t('sales.colNet')}</th>
                                    <th scope="col" className="num">{t('sales.colVat')}</th>
                                    <th scope="col" className="num">{t('sales.colTotal')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {invoices.map((invoice) => (
                                    <tr key={invoice.id} className={invoice.voided ? 'is-warn' : undefined}>
                                      <td>{formatDate(invoice.date || invoice.postedAt, locale)}</td>
                                      <td>
                                        {invoice.number || '—'}
                                        {invoice.voided && (
                                          <span className="badge">{t('sales.voided')}</span>
                                        )}
                                        {invoice.voids && (
                                          <span className="badge">{t('sales.reversal')}</span>
                                        )}
                                      </td>
                                      <td className="num">{invoice.lines}</td>
                                      <td className="num">{formatMoney(invoice.net, currency, locale)}</td>
                                      <td className="num">{formatMoney(invoice.vat, currency, locale)}</td>
                                      <td className="num">{formatMoney(invoice.gross, currency, locale)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
