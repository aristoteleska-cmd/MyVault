import { useVault } from '../state/vault';
import type { ThemeChoice } from '../types';
import { Icon, type IconName } from './Icon';

const CURRENCIES = ['€', '$', '£', 'CHF', '¥', 'zł', 'lei', 'kr'];

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'Match Windows', icon: 'monitor' },
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

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">Appearance</div>
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
