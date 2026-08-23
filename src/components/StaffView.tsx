import { useEffect, useState, type FormEvent } from 'react';
import { useVault } from '../state/vault';
import type { Role, StaffMember } from '../types';
import { useI18n, type TranslationKey } from '../i18n';
import { Icon } from './Icon';
import { Modal } from './Modal';

const ROLE_LABEL: Record<Role, TranslationKey> = {
  admin: 'role.admin',
  senior: 'role.senior',
  junior: 'role.junior',
};

const ROLE_WHAT: Record<Role, TranslationKey> = {
  admin: 'role.adminWhat',
  senior: 'role.seniorWhat',
  junior: 'role.juniorWhat',
};

const MIN_PIN = 4;
const MAX_PIN = 12;

/**
 * Staff and what each of them may do.
 *
 * Only a manager ever reaches this screen, and the main process refuses these
 * changes to anyone else regardless of what the interface shows.
 */
export function StaffView() {
  const {
    staff, refreshStaff, auth, removeStaff, signOut, newRecoveryCode, disableStaff,
  } = useVault();
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);
  const [recoveryIssued, setRecoveryIssued] = useState('');

  useEffect(() => { void refreshStaff(); }, [refreshStaff]);

  // Only when the code was minted, never the code itself — there is no readable
  // copy of it to ask for.
  useEffect(() => {
    void window.myvault?.auth.recoveryStatus().then((result) => {
      if (result.ok && result.data) setRecoveryIssued(result.data.createdAt);
    });
  }, [auth.hasRecoveryCode]);

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('staff.title')}</h1>
          <p className="view-sub">{t('staff.sub')}</p>
        </header>

        <div className="panel">
          <div className="panel-head">{t('staff.title')}</div>

          {staff.length === 0 && (
            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-title">{t('staff.none')}</div>
                <div className="setting-desc">{t('staff.setUpWhy')}</div>
              </div>
            </div>
          )}

          {staff.map((person) => (
            <div className="setting-row" key={person.id}>
              <div className="setting-text">
                <div className="setting-title">
                  {person.name}
                  {person.id === auth.user?.id && <span className="chip-inline"> — {t('staff.you')}</span>}
                </div>
                <div className="setting-desc">
                  <strong>{t(ROLE_LABEL[person.role])}</strong> — {t(ROLE_WHAT[person.role])}
                  <span className="path">
                    {t('staff.since', {
                      date: new Date(person.createdAt).toLocaleDateString(locale || undefined),
                    })}
                  </span>
                </div>
              </div>
              <div className="setting-control">
                <button type="button" className="btn" onClick={() => setEditing(person)}>
                  <Icon name="pencil" size={15} />
                  {t('table.edit')}
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm(t('staff.removeConfirm', { name: person.name }))) {
                      void removeStaff(person.id);
                    }
                  }}
                >
                  <Icon name="trash" size={15} />
                  {t('staff.remove')}
                </button>
              </div>
            </div>
          ))}

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-desc">{t('staff.notSecurity')}</div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                <Icon name="plus" size={16} />
                {t('staff.add')}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">{t('recovery.panel')}</div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-desc">
                {auth.hasRecoveryCode
                  ? t('recovery.have', {
                    date: recoveryIssued
                      ? new Date(recoveryIssued).toLocaleDateString(locale || undefined)
                      : '—',
                  })
                  : t('recovery.missing')}
                <span className="path">{t('recovery.newWarns')}</span>
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void newRecoveryCode()}>
                <Icon name="save" size={15} />
                {t('recovery.new')}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">{t('staff.off')}</div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-desc">{t('staff.offConfirm')}</div>
            </div>
            <div className="setting-control">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (window.confirm(t('staff.offConfirm'))) void disableStaff();
                }}
              >
                {t('staff.off')}
              </button>
            </div>
          </div>
        </div>

        {auth.user && (
          <div className="callout">
            <Icon name="info" size={18} />
            <div>
              {t('staff.signedInAs', { name: auth.user.name })}
              {' — '}
              {t(ROLE_LABEL[auth.user.role])}
              <br />
              <button type="button" className="btn btn-sm" onClick={() => void signOut()}>
                {t('staff.signOut')}
              </button>
            </div>
          </div>
        )}
      </div>

      {(adding || editing) && (
        <StaffDialog
          person={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function StaffDialog({ person, onClose }: { person: StaffMember | null; onClose: () => void }) {
  const { addStaff, updateStaff, auth } = useVault();
  const { t } = useI18n();
  const { staff } = useVault();
  const [name, setName] = useState(person?.name ?? '');
  // The very first person must be a manager — see the store — so do not offer
  // a choice that would be refused.
  const [role, setRole] = useState<Role>(
    person?.role ?? (staff.length === 0 ? 'admin' : 'junior'),
  );
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const isEdit = Boolean(person);
  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, MAX_PIN);
  // On an edit, a blank PIN means "leave it alone"; on a new person it is required.
  const pinReady = isEdit ? pin === '' || pin.length >= MIN_PIN : pin.length >= MIN_PIN;
  const ready = name.trim().length > 0 && pinReady;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const done = person
      ? await updateStaff(person.id, { name: name.trim(), role, ...(pin ? { pin } : {}) })
      : await addStaff({ name: name.trim(), role, pin });
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Modal
      title={person ? t('staff.editTitle', { name: person.name }) : t('staff.addTitle')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
          <button type="submit" form="staff-form" className="btn btn-primary" disabled={!ready || busy}>
            <Icon name="save" size={16} />
            {t('staff.save')}
          </button>
        </>
      }
    >
      <form id="staff-form" className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="staff-name">{t('staff.name')}</label>
          <input
            id="staff-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="staff-role">{t('staff.role')}</label>
          <select
            id="staff-role"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {auth.roles
              .filter((choice) => staff.length > 0 || choice === 'admin')
              .map((choice) => (
                <option key={choice} value={choice}>{t(ROLE_LABEL[choice])}</option>
              ))}
          </select>
          <span className="field-hint">{t(ROLE_WHAT[role])}</span>
        </div>

        <div className="field">
          <label htmlFor="staff-pin">{t('staff.pin')}</label>
          <input
            id="staff-pin"
            className="input mono"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(digitsOnly(event.target.value))}
          />
          <span className="field-hint">
            {isEdit ? t('staff.pinKeep') : t('firstAdmin.pinHint')}
          </span>
        </div>
      </form>
    </Modal>
  );
}
