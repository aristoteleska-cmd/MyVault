import { useEffect } from 'react';
import { useVault } from '../state/vault';
import type { AccentChoice, DensityChoice, ThemeChoice } from '../types';
import { LANGUAGES, resolveLanguage, useI18n, type TranslationKey } from '../i18n';
import { TRANSLATED_LANGUAGES } from '../i18n/catalogues';
import { Icon, type IconName } from './Icon';

const CURRENCIES = ['€', '$', '£', 'CHF', '¥', 'zł', 'lei', 'kr'];

const THEMES: { value: ThemeChoice; labelKey: TranslationKey; icon: IconName }[] = [
  { value: 'light', labelKey: 'theme.light', icon: 'sun' },
  { value: 'dark', labelKey: 'theme.dark', icon: 'moon' },
  { value: 'system', labelKey: 'theme.system', icon: 'monitor' },
];

// The swatch colours here are only for the buttons; the real values live in
// styles.css so each accent can differ between the light and dark themes.
const ACCENTS: { value: AccentChoice; labelKey: TranslationKey; swatch: string }[] = [
  { value: 'blue', labelKey: 'accent.blue', swatch: '#2f5fdb' },
  { value: 'teal', labelKey: 'accent.teal', swatch: '#0d7d76' },
  { value: 'green', labelKey: 'accent.green', swatch: '#1a7f45' },
  { value: 'purple', labelKey: 'accent.purple', swatch: '#6b3fc4' },
  { value: 'orange', labelKey: 'accent.orange', swatch: '#b45309' },
  { value: 'graphite', labelKey: 'accent.graphite', swatch: '#3f4756' },
];

const DENSITIES: { value: DensityChoice; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  { value: 'comfortable', labelKey: 'density.comfortable', hintKey: 'density.comfortableHint' },
  { value: 'compact', labelKey: 'density.compact', hintKey: 'density.compactHint' },
];

const TEXT_SIZES: { value: number; labelKey: TranslationKey }[] = [
  { value: 0.9, labelKey: 'size.small' },
  { value: 1, labelKey: 'size.normal' },
  { value: 1.15, labelKey: 'size.large' },
  { value: 1.3, labelKey: 'size.xlarge' },
];

export function SettingsView() {
  const {
    db, info, updateSettings, exportCsv, importCsv, backup, restore, openDataFolder,
    importSummary, clearImportSummary, notifyImport,
  } = useVault();
  const { t } = useI18n();
  const { settings } = db;

  // The import result comes back as counts; the wording belongs here, where the
  // translator is available.
  useEffect(() => {
    if (!importSummary) return;
    const parts = [
      t('toast.importAdded', { count: importSummary.added ?? 0 }),
      t('toast.importUpdated', { count: importSummary.updated ?? 0 }),
    ];
    if (importSummary.skipped) parts.push(t('toast.importSkipped', { count: importSummary.skipped }));
    if (importSummary.newFields) parts.push(t('toast.importNewFields', { count: importSummary.newFields }));
    if (importSummary.droppedColumns?.length) {
      parts.push(t('toast.importDropped', { names: importSummary.droppedColumns.join(', ') }));
    }
    notifyImport(parts.join(', '));
    clearImportSummary();
  }, [importSummary, t, notifyImport, clearImportSummary]);

  const autoLanguage = resolveLanguage(info?.systemLocale);
  const autoName = LANGUAGES.find((l) => l.code === autoLanguage)?.native ?? 'English';

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('settings.title')}</h1>
          <p className="view-sub">{t('settings.sub')}</p>
        </header>

        <div className="panel">
          <div className="panel-head">{t('settings.shopPanel')}</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.shopName')}</div>
              <div className="setting-desc">{t('settings.shopNameDesc')}</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                value={settings.shopName}
                onChange={(e) => void updateSettings({ shopName: e.target.value })}
                placeholder={t('settings.shopNamePlaceholder')}
                aria-label={t('settings.shopName')}
              />
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.currency')}</div>
              <div className="setting-desc">{t('settings.currencyDesc')}</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                style={{ flex: 'none', width: 76 }}
                value={settings.currency}
                maxLength={4}
                onChange={(e) => void updateSettings({ currency: e.target.value })}
                aria-label={t('settings.currency')}
              />
              {CURRENCIES.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  className="chip"
                  aria-pressed={settings.currency === symbol}
                  onClick={() => void updateSettings({ currency: symbol })}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.lowStock')}</div>
              <div className="setting-desc">{t('settings.lowStockDesc')}</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={settings.defaultLowStockThreshold}
                onChange={(e) => void updateSettings({ defaultLowStockThreshold: Number(e.target.value) })}
                aria-label={t('settings.lowStockAria')}
              />
            </div>
          </div>

        </div>

        <div className="panel">
          <div className="panel-head">{t('settings.stylingPanel')}</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.language')}</div>
              <div className="setting-desc">
                {t('settings.languageDesc', { count: LANGUAGES.length })}
              </div>
            </div>
            <div className="setting-control">
              <select
                className="select"
                value={settings.language}
                onChange={(e) => void updateSettings({ language: e.target.value })}
                aria-label={t('settings.language')}
              >
                <option value="">{t('settings.languageAuto', { name: autoName })}</option>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.native}
                    {language.native === language.english ? '' : ` — ${language.english}`}
                    {TRANSLATED_LANGUAGES.has(language.code) ? '' : ' *'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.theme')}</div>
              <div className="setting-desc">{t('settings.themeDesc')}</div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                {THEMES.map((theme) => (
                  <button
                    key={theme.value}
                    type="button"
                    aria-pressed={settings.theme === theme.value}
                    onClick={() => void updateSettings({ theme: theme.value })}
                  >
                    <Icon name={theme.icon} size={15} />
                    {t(theme.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.colour')}</div>
              <div className="setting-desc">{t('settings.colourDesc')}</div>
            </div>
            <div className="setting-control">
              <div className="swatch-row" role="radiogroup" aria-label={t('settings.colourAria')}>
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.value}
                    type="button"
                    className="swatch-option"
                    role="radio"
                    aria-checked={settings.accent === accent.value}
                    aria-label={t(accent.labelKey)}
                    title={t(accent.labelKey)}
                    style={{ '--swatch': accent.swatch } as React.CSSProperties}
                    onClick={() => void updateSettings({ accent: accent.value })}
                  >
                    {settings.accent === accent.value && <Icon name="check" size={15} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.density')}</div>
              <div className="setting-desc">
                {t(DENSITIES.find((d) => d.value === settings.density)?.hintKey ?? 'density.comfortableHint')}
              </div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                {DENSITIES.map((density) => (
                  <button
                    key={density.value}
                    type="button"
                    aria-pressed={settings.density === density.value}
                    onClick={() => void updateSettings({ density: density.value })}
                  >
                    {t(density.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.textSize')}</div>
              <div className="setting-desc">{t('settings.textSizeDesc')}</div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                {TEXT_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    aria-pressed={Math.abs(settings.zoom - size.value) < 0.01}
                    onClick={() => void updateSettings({ zoom: size.value })}
                  >
                    {t(size.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">{t('settings.dataPanel')}</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.spreadsheets')}</div>
              <div className="setting-desc">{t('settings.spreadsheetsDesc')}</div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void importCsv()}>
                <Icon name="upload" size={16} />
                {t('settings.import')}
              </button>
              <button type="button" className="btn" onClick={() => void exportCsv()}>
                <Icon name="download" size={16} />
                {t('settings.export')}
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.backup')}</div>
              <div className="setting-desc">{t('settings.backupDesc')}</div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void backup()}>
                <Icon name="save" size={16} />
                {t('settings.backupBtn')}
              </button>
              <button type="button" className="btn" onClick={() => void restore()}>
                <Icon name="folder" size={16} />
                {t('settings.restoreBtn')}
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.location')}</div>
              <div className="setting-desc">
                {t('settings.locationDesc')}
                {info?.dataFile && <span className="path">{info.dataFile}</span>}
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void openDataFolder()}>
                <Icon name="folder" size={16} />
                {t('settings.openFolder')}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">{t('settings.legalPanel')}</div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">{t('settings.legalTitle')}</div>
              <div className="setting-desc">{t('settings.legalBody')}</div>
            </div>
          </div>
        </div>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            <strong>MyVault {info?.version ? `v${info.version}` : ''}</strong>
            {info?.portable && ` — ${t('settings.portable')}`}
            <br />
            {t('settings.counts', {
              items: db.items.length,
              categories: db.categories.length,
              details: db.customFields.length,
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
