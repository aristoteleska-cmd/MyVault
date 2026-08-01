import { useVault } from '../state/vault';
import { useT } from '../i18n';
import { Icon } from './Icon';

export function Toasts() {
  const { toasts, dismissToast } = useVault();
  const t = useT();
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="region" aria-label={t('toast.aria')}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-message">{toast.raw ?? t(toast.key, toast.vars)}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              {t(toast.action.labelKey)}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => dismissToast(toast.id)}
            aria-label={t('toast.dismiss')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
