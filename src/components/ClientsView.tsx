import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n, useT } from '../i18n';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { useEscape } from '../lib/keys';
import type { Client, ClientHistory } from '../types';
import { Icon } from './Icon';

const blank = { name: '', phone: '', email: '', address: '', notes: '' };

/**
 * The shop's regulars, and what each of them has bought.
 *
 * The purchases are not stored against the customer — they are read out of the
 * movement log when somebody opens that customer, which is why adding a hundred
 * regulars costs nothing and selling something never has to rewrite this list.
 */
export function ClientsView() {
  const { db, addClient, updateClient, deleteClient, clientHistory, can, serving, setServing } = useVault();
  const { locale } = useI18n();
  const t = useT();

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<ClientHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...blank });
  const [adding, setAdding] = useState(false);

  const currency = db.settings.currency;
  const mayManage = can('clients.manage');

  // The add and edit panels are part of the page rather than dialogs, so
  // Escape has to be arranged for them by hand.
  useEscape(adding || editingId !== null, () => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ...blank });
  });

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = [...db.clients].sort((a, b) => a.name.localeCompare(b.name, locale));
    if (!needle) return list;
    return list.filter((client) =>
      [client.name, client.phone, client.email, client.address]
        .some((field) => field.toLowerCase().includes(needle)));
  }, [db.clients, query, locale]);

  const openClient = useCallback(async (client: Client) => {
    if (openId === client.id) {
      setOpenId(null);
      setHistory(null);
      return;
    }
    setOpenId(client.id);
    setHistory(null);
    setLoadingHistory(true);
    setHistory(await clientHistory(client.id));
    setLoadingHistory(false);
  }, [openId, clientHistory]);

  // A customer removed while their history was open should not leave it there.
  useEffect(() => {
    if (openId && !db.clients.some((client) => client.id === openId)) {
      setOpenId(null);
      setHistory(null);
    }
  }, [db.clients, openId]);

  async function commitNew() {
    if (!draft.name.trim()) return;
    const created = await addClient(draft);
    if (created) {
      setDraft({ ...blank });
      setAdding(false);
    }
  }

  async function commitEdit(id: string) {
    if (!draft.name.trim()) return;
    await updateClient(id, draft);
    setEditingId(null);
    setDraft({ ...blank });
  }

  function startEdit(client: Client) {
    setEditingId(client.id);
    setDraft({
      name: client.name,
      phone: client.phone,
      email: client.email,
      address: client.address,
      notes: client.notes,
    });
  }

  const fields = (
    <>
      <div className="field">
        <label className="field-label" htmlFor="client-name">{t('clients.name')}</label>
        <input
          id="client-name"
          className="input"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor="client-phone">{t('clients.phone')}</label>
          <input
            id="client-phone"
            className="input"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="client-email">{t('clients.email')}</label>
          <input
            id="client-email"
            className="input"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="client-address">{t('clients.address')}</label>
        <input
          id="client-address"
          className="input"
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="client-notes">{t('clients.notes')}</label>
        <textarea
          id="client-notes"
          className="input"
          rows={2}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>
    </>
  );

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('clients.title')}</h1>
          <p className="view-sub">{t('clients.sub')}</p>
        </header>

        <div className="toolbar">
          <div className="field search-field" style={{ flex: 1 }}>
            <Icon name="search" size={16} />
            <label className="visually-hidden" htmlFor="client-search">{t('clients.searchLabel')}</label>
            <input
              id="client-search"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('clients.searchPlaceholder')}
              autoComplete="off"
            />
          </div>
          {mayManage && !adding && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { setAdding(true); setDraft({ ...blank }); setEditingId(null); }}
            >
              <Icon name="plus" size={16} />
              {t('clients.add')}
            </button>
          )}
        </div>

        {/* A real form, so Enter in the name field saves the customer rather
            than doing nothing at all. */}
        {adding && (
          <form
            className="panel form-panel"
            onSubmit={(event) => { event.preventDefault(); void commitNew(); }}
          >
            <h3 className="panel-title">{t('clients.addTitle')}</h3>
            {fields}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => { setAdding(false); setDraft({ ...blank }); }}>
                {t('dialog.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!draft.name.trim()}
              >
                {t('clients.save')}
              </button>
            </div>
          </form>
        )}

        {db.clients.length === 0 && !adding ? (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="people" size={26} /></div>
              <h3>{t('clients.emptyTitle')}</h3>
              <p>{t('clients.emptyBody')}</p>
            </div>
          </div>
        ) : (
          <div className="record-list">
            {shown.map((client) => (
              <div className="record client-record" key={client.id}>
                {editingId === client.id ? (
                  <form
                    className="record-main"
                    onSubmit={(event) => { event.preventDefault(); void commitEdit(client.id); }}
                  >
                    {fields}
                    <div className="form-actions">
                      <button type="button" className="btn" onClick={() => setEditingId(null)}>
                        {t('dialog.cancel')}
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={!draft.name.trim()}
                      >
                        {t('clients.save')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="record-head">
                      <div className="record-main">
                        <div className="record-title">
                          {client.name}
                          {serving === client.id && (
                            <span className="badge accent">{t('clients.beingServed')}</span>
                          )}
                        </div>
                        <div className="record-sub">
                          {[client.phone, client.email, client.address].filter(Boolean).join(' · ')
                            || t('clients.noContact')}
                        </div>
                      </div>

                      <div className="record-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setServing(serving === client.id ? '' : client.id)}
                          title={t('clients.serveTitle')}
                        >
                          {serving === client.id ? t('clients.stopServing') : t('clients.serve')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void openClient(client)}
                          aria-expanded={openId === client.id}
                        >
                          {t('clients.purchases')}
                        </button>
                        {mayManage && (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => { setAdding(false); startEdit(client); }}
                              aria-label={t('clients.editAria', { name: client.name })}
                              title={t('clients.edit')}
                            >
                              <Icon name="pencil" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => void deleteClient(client.id)}
                              aria-label={t('clients.deleteAria', { name: client.name })}
                              title={t('clients.delete')}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {client.notes && <div className="record-notes">{client.notes}</div>}

                    {openId === client.id && (
                      <div className="client-history">
                        {loadingHistory && <p className="panel-empty">{t('clients.loading')}</p>}
                        {/* Gated on the lines rather than the order count: a
                            customer whose only record is a refund has a history,
                            and telling them there is nothing yet is a puzzle. */}
                        {!loadingHistory && history && history.lines.length === 0 && (
                          <p className="panel-empty">{t('clients.nothingYet')}</p>
                        )}
                        {!loadingHistory && history && history.lines.length > 0 && (
                          <>
                            <div className="client-totals">
                              <div>
                                <span className="stat-label">{t('clients.spent')}</span>
                                <strong>{formatMoney(history.spent, currency, locale)}</strong>
                              </div>
                              <div>
                                <span className="stat-label">{t('clients.itemsBought')}</span>
                                <strong>{formatNumber(history.units, locale)}</strong>
                              </div>
                              <div>
                                <span className="stat-label">{t('clients.since')}</span>
                                <strong>{formatDate(history.firstAt, locale)}</strong>
                              </div>
                            </div>
                            <ul className="history-list">
                              {history.lines.map((line) => (
                                <li key={line.id}>
                                  <span className="history-when">
                                    <Icon name="clock" size={13} />
                                    {formatDateTime(line.at, locale)}
                                  </span>
                                  <span className="history-what">{line.itemName}</span>
                                  <span className="history-count">×{formatNumber(-line.delta, locale)}</span>
                                  <span className="history-money">
                                    {formatMoney(-line.delta * line.price, currency, locale)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {history.orders > history.lines.length && (
                              <p className="panel-sub">
                                {t('clients.showingRecent', { count: history.lines.length })}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {shown.length === 0 && db.clients.length > 0 && (
              <div className="panel"><p className="panel-empty">{t('clients.noMatch')}</p></div>
            )}
          </div>
        )}

        <div className="callout">
          <Icon name="info" size={18} />
          <div>{t('clients.note')}</div>
        </div>
      </div>
    </div>
  );
}
