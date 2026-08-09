import { useState, type FormEvent } from 'react';
import { useVault } from '../state/vault';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/**
 * The screen a shop sees when staff roles are switched on.
 *
 * A keypad rather than a text box, because this is a till: the person using it
 * may be standing, may have a touchscreen, and is holding something in the
 * other hand. The digits never appear on screen.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MIN_PIN = 4;
const MAX_PIN = 12;

export function SignInView() {
  const { db, signIn, auth, createFirstAdmin } = useVault();

  // Nobody has set roles up yet: the first thing to make is the manager.
  if (!auth.locked) return <FirstAdminForm onCreate={createFirstAdmin} />;

  return <PinPad onSubmit={signIn} shopName={db.settings.shopName} />;
}

function PinPad({
  onSubmit,
  shopName,
}: {
  onSubmit: (pin: string) => Promise<boolean>;
  shopName: string;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const press = (digit: string) => {
    setWrong(false);
    setPin((current) => (current.length >= MAX_PIN ? current : current + digit));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pin.length < MIN_PIN || busy) return;
    setBusy(true);
    const worked = await onSubmit(pin);
    setBusy(false);
    if (!worked) {
      setWrong(true);
      setPin('');
    }
  };

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-brand"><Icon name="vault" size={34} /></div>
        <h1 className="signin-title">{t('signIn.title')}</h1>
        <p className="signin-sub">
          {t('signIn.sub', { shop: shopName || t('signIn.shopFallback') })}
        </p>

        {/* Dots, not digits: somebody standing at the counter can see this screen. */}
        <div className="pin-dots" aria-label={t('signIn.pin')} aria-live="polite">
          {Array.from({ length: Math.max(MIN_PIN, pin.length) }, (_, index) => (
            <span key={index} className={index < pin.length ? 'pin-dot filled' : 'pin-dot'} />
          ))}
        </div>

        {wrong && <div className="signin-error" role="alert">{t('signIn.wrong')}</div>}

        <div className="pin-pad">
          {KEYS.map((digit) => (
            <button key={digit} type="button" className="pin-key" onClick={() => press(digit)}>
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="pin-key subtle"
            onClick={() => { setPin(''); setWrong(false); }}
            aria-label={t('signIn.clear')}
          >
            {t('signIn.clear')}
          </button>
          <button type="button" className="pin-key" onClick={() => press('0')}>0</button>
          <button
            type="button"
            className="pin-key subtle"
            onClick={() => setPin((current) => current.slice(0, -1))}
            aria-label={t('signIn.back')}
          >
            <Icon name="chevronLeft" size={18} />
          </button>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-lg signin-go"
          disabled={pin.length < MIN_PIN || busy}
        >
          {t('signIn.go')}
        </button>

        <p className="signin-foot">{t('signIn.forgot')}</p>
      </form>
    </div>
  );
}

/**
 * First run of the staff feature. Deliberately a form rather than a keypad —
 * this PIN is being chosen, not recalled, and it is worth typing carefully.
 */
function FirstAdminForm({
  onCreate,
}: {
  onCreate: (input: { name: string; pin: string }) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, MAX_PIN);
  const mismatch = confirm.length > 0 && pin !== confirm;
  const ready = name.trim().length > 0 && pin.length >= MIN_PIN && pin === confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    await onCreate({ name: name.trim(), pin });
    setBusy(false);
  };

  return (
    <div className="signin">
      <form className="signin-card wide" onSubmit={submit}>
        <div className="signin-brand"><Icon name="vault" size={34} /></div>
        <h1 className="signin-title">{t('firstAdmin.title')}</h1>
        <p className="signin-sub">{t('firstAdmin.sub')}</p>

        <div className="field">
          <label htmlFor="admin-name">{t('firstAdmin.name')}</label>
          <input
            id="admin-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('firstAdmin.namePlaceholder')}
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="admin-pin">{t('firstAdmin.pin')}</label>
          <input
            id="admin-pin"
            className="input mono"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(digitsOnly(event.target.value))}
          />
          <span className="field-hint">{t('firstAdmin.pinHint')}</span>
        </div>

        <div className="field">
          <label htmlFor="admin-confirm">{t('firstAdmin.confirm')}</label>
          <input
            id="admin-confirm"
            className="input mono"
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(event) => setConfirm(digitsOnly(event.target.value))}
            aria-invalid={mismatch}
          />
          {mismatch && <span className="field-error">{t('firstAdmin.mismatch')}</span>}
        </div>

        <div className="callout">
          <Icon name="alert" size={18} />
          <div>{t('firstAdmin.warning')}</div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={!ready || busy}>
          {t('firstAdmin.create')}
        </button>
      </form>
    </div>
  );
}
