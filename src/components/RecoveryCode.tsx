import { useState } from 'react';
import { useVault } from '../state/vault';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/**
 * The one and only showing of a recovery code.
 *
 * MyVault keeps a scrypt hash of this code and nothing else, so this screen is
 * genuinely the last time it exists in a readable form. It therefore refuses to
 * be dismissed by a stray click — the only way past is the button that says the
 * code has been written down.
 */
export function RecoveryCode() {
  const { recoveryCode, clearRecoveryCode } = useVault();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!recoveryCode) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // A clipboard the browser will not give up is not worth an error message:
      // the code is on screen and can be read off it.
    }
  };

  return (
    <div className="signin">
      <div className="signin-card wide">
        <div className="signin-brand"><Icon name="alert" size={34} /></div>
        <h1 className="signin-title">{t('recovery.showTitle')}</h1>
        <p className="signin-sub">{t('recovery.showBody')}</p>

        <div className="recovery-code" aria-label={t('recovery.code')}>{recoveryCode}</div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void copy()}>
            <Icon name="save" size={16} />
            {copied ? t('recovery.copied') : t('recovery.copy')}
          </button>
        </div>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>{t('recovery.showWhere')}</div>
        </div>

        <button type="button" className="btn btn-primary btn-lg" onClick={clearRecoveryCode}>
          {t('recovery.confirm')}
        </button>
      </div>
    </div>
  );
}

/**
 * The way back in, reached from the sign-in screen.
 *
 * Open to anyone standing at the machine, which is the honest position: whoever
 * holds the code is the owner, and whoever holds the computer could edit the
 * data file anyway. The code is the credential, and it is long enough that
 * guessing it is not a route in.
 */
export function RecoverForm({ onCancel }: { onCancel: () => void }) {
  const { recoverWithCode, auth } = useVault();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 12);
  const ready = code.trim().length >= 20 && pin.length >= 4;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    await recoverWithCode(code, pin);
    setBusy(false);
  };

  return (
    <div className="signin">
      <form className="signin-card wide" onSubmit={submit}>
        <div className="signin-brand"><Icon name="vault" size={34} /></div>
        <h1 className="signin-title">{t('recovery.forgotTitle')}</h1>

        {auth.hasRecoveryCode ? (
          <>
            <p className="signin-sub">{t('recovery.forgotBody')}</p>

            <div className="field">
              <label htmlFor="recovery-code">{t('recovery.code')}</label>
              <input
                id="recovery-code"
                className="input mono"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABCDE-FGHJK-MNPQR-STUVW"
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="field">
              <label htmlFor="recovery-pin">{t('recovery.newPin')}</label>
              <input
                id="recovery-pin"
                className="input mono"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(digitsOnly(event.target.value))}
              />
              <span className="field-hint">{t('firstAdmin.pinHint')}</span>
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={!ready || busy}>
              {t('recovery.go')}
            </button>
          </>
        ) : (
          <div className="callout">
            <Icon name="alert" size={18} />
            <div>{t('recovery.none')}</div>
          </div>
        )}

        <button type="button" className="btn" onClick={onCancel}>{t('recovery.cancel')}</button>
      </form>
    </div>
  );
}
