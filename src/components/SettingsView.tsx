import { useVault } from '../state/vault';
import type { AccentChoice, DensityChoice, ThemeChoice } from '../types';
import { Icon, type IconName } from './Icon';

const CURRENCIES = ['€', '$', '£', 'CHF', '¥', 'zł', 'lei', 'kr'];

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'Match Windows', icon: 'monitor' },
];

// The swatch colours here are only for the buttons; the real values live in
// styles.css so each accent can differ between the light and dark themes.
const ACCENTS: { value: AccentChoice; label: string; swatch: string }[] = [
  { value: 'blue', label: 'Blue', swatch: '#2f5fdb' },
  { value: 'teal', label: 'Teal', swatch: '#0d7d76' },
  { value: 'green', label: 'Green', swatch: '#1a7f45' },
  { value: 'purple', label: 'Purple', swatch: '#6b3fc4' },
  { value: 'orange', label: 'Amber', swatch: '#b45309' },
  { value: 'graphite', label: 'Graphite', swatch: '#3f4756' },
];

const DENSITIES: { value: DensityChoice; label: string; hint: string }[] = [
  { value: 'comfortable', label: 'Comfortable', hint: 'Roomy rows, easier to tap' },
  { value: 'compact', label: 'Compact', hint: 'More products on screen at once' },
];

const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Extra large' },
];

export function SettingsView() {
  const { db, info, updateSettings, exportCsv, importCsv, backup, restore, openDataFolder } = useVault();
  const { settings } = db;

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">Make MyVault match your shop, and look after your data.</p>
        </header>

        <div className="panel">
          <div className="panel-head">Your shop</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Shop name</div>
              <div className="setting-desc">Shown in the corner of the app. Optional.</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                value={settings.shopName}
                onChange={(e) => void updateSettings({ shopName: e.target.value })}
                placeholder="e.g. Maria's Boutique"
                aria-label="Shop name"
              />
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Currency symbol</div>
              <div className="setting-desc">Used everywhere prices and stock value are shown.</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                style={{ flex: 'none', width: 76 }}
                value={settings.currency}
                maxLength={4}
                onChange={(e) => void updateSettings({ currency: e.target.value })}
                aria-label="Currency symbol"
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
              <div className="setting-title">Low stock warning</div>
              <div className="setting-desc">
                Items at or below this quantity are flagged as running low. You can set a different
                limit on any single item.
              </div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={settings.defaultLowStockThreshold}
                onChange={(e) => void updateSettings({ defaultLowStockThreshold: Number(e.target.value) })}
                aria-label="Default low stock quantity"
              />
            </div>
          </div>

        </div>

        <div className="panel">
          <div className="panel-head">Styling</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Theme</div>
              <div className="setting-desc">Dark mode is easier on the eyes in a dim stockroom.</div>
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
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Colour</div>
              <div className="setting-desc">
                Sets the buttons, highlights and selected rows. Pick the one closest to your shop's
                own colours.
              </div>
            </div>
            <div className="setting-control">
              <div className="swatch-row" role="radiogroup" aria-label="Accent colour">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.value}
                    type="button"
                    className="swatch-option"
                    role="radio"
                    aria-checked={settings.accent === accent.value}
                    aria-label={accent.label}
                    title={accent.label}
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
              <div className="setting-title">Row spacing</div>
              <div className="setting-desc">
                {DENSITIES.find((d) => d.value === settings.density)?.hint}
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
                    {density.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Text size</div>
              <div className="setting-desc">
                Scales the whole app. Useful on a small till screen or a large monitor.
              </div>
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
                    {size.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">Your data</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Spreadsheets</div>
              <div className="setting-desc">
                Bring in a product list from Excel, or send your stock out to one. Columns MyVault
                does not recognise become extra details automatically.
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void importCsv()}>
                <Icon name="upload" size={16} />
                Import
              </button>
              <button type="button" className="btn" onClick={() => void exportCsv()}>
                <Icon name="download" size={16} />
                Export
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Backup and restore</div>
              <div className="setting-desc">
                Save a copy of everything to a USB stick or another folder. MyVault also keeps
                automatic backups in its own folder.
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void backup()}>
                <Icon name="save" size={16} />
                Backup
              </button>
              <button type="button" className="btn" onClick={() => void restore()}>
                <Icon name="folder" size={16} />
                Restore
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Where your data is kept</div>
              <div className="setting-desc">
                MyVault has no account, no cloud and no internet connection. Everything lives in
                this one file on this computer.
                {info?.dataFile && <span className="path">{info.dataFile}</span>}
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn" onClick={() => void openDataFolder()}>
                <Icon name="folder" size={16} />
                Open folder
              </button>
            </div>
          </div>
        </div>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            <strong>MyVault {info?.version ? `v${info.version}` : ''}</strong>
            {info?.portable && ' — running in portable mode, data travels with the app.'}
            <br />
            {db.items.length} items · {db.categories.length} categories · {db.customFields.length} extra details.
          </div>
        </div>
      </div>
    </div>
  );
}
