import { useState } from 'react';
import { useVault } from '../state/vault';
import type { FieldType } from '../types';
import { useT, type TranslationKey } from '../i18n';
import { Icon } from './Icon';
import { NewFieldForm } from './ItemDialog';

/**
 * Ready-made details for the shop types people ask about most. Both the button
 * label and the name the detail gets are translated, so a Greek shop ends up
 * with a detail actually called "Μέγεθος".
 */
const PRESETS: {
  labelKey: TranslationKey;
  nameKey: TranslationKey;
  type: FieldType;
  options: string[];
}[] = [
  { labelKey: 'preset.clothesSize', nameKey: 'presetName.size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { labelKey: 'preset.clothesColour', nameKey: 'presetName.colour', type: 'text', options: [] },
  { labelKey: 'preset.toyAge', nameKey: 'presetName.ageRange', type: 'select', options: ['0-2', '3-5', '6-8', '9-12', '12+'] },
  { labelKey: 'preset.shoeSize', nameKey: 'presetName.shoeSize', type: 'number', options: [] },
  { labelKey: 'preset.foodExpiry', nameKey: 'presetName.expiryDate', type: 'date', options: [] },
  { labelKey: 'preset.brand', nameKey: 'presetName.brand', type: 'text', options: [] },
  { labelKey: 'preset.shelf', nameKey: 'presetName.shelf', type: 'text', options: [] },
];

export function FieldsView() {
  const { db, info, addField, updateField, deleteField, moveField } = useVault();
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const fields = [...db.customFields].sort((a, b) => a.order - b.order);
  const existing = new Set(fields.map((field) => field.name.toLowerCase()));

  const standard = info?.standardFields ?? ['Name', 'Price', 'Quantity', 'Barcode'];
  const max = info?.maxCustomFields ?? 5;
  const remaining = Math.max(0, max - fields.length);
  const isFull = remaining === 0;

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('details.title')}</h1>
          <p className="view-sub">{t('details.sub')}</p>
        </header>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            {t('details.standardNote', {
              fields: standard.join(', '),
              button: t('details.add'),
              max,
            })}
          </div>
        </div>

        {showForm ? (
          <NewFieldForm
            onCancel={() => setShowForm(false)}
            onCreate={async (input) => {
              const created = await addField(input);
              if (created) setShowForm(false);
            }}
          />
        ) : (
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowForm(true)}
              disabled={isFull}
              title={isFull ? t('details.fullTitle', { max }) : undefined}
            >
              <Icon name="plus" size={16} />
              {t('details.add')}
            </button>
            <span className="counter-pill" aria-live="polite">
              {t('details.counter', { used: fields.length, max })}
            </span>
            <span className="field-hint">
              {isFull ? t('details.full') : t('details.orPreset')}
            </span>
          </div>
        )}

        {fields.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="fields" size={26} /></div>
              <h3>{t('details.emptyTitle')}</h3>
              <p>{t('details.emptyBody', { fields: standard.join(', ') })}</p>
            </div>
          </div>
        ) : (
          <div className="record-list">
            {fields.map((field, index) => (
              <div className="record" key={field.id}>
                <div className="record-main">
                  <div className="record-title">{field.name}</div>
                  <div className="record-sub">
                    {t(`fieldTypeShort.${field.type}` as TranslationKey)}
                    {field.type === 'select' && field.options.length > 0 && ` · ${field.options.join(', ')}`}
                  </div>
                </div>

                <label className="checkbox-row" title={t('details.columnTitle')}>
                  <input
                    type="checkbox"
                    checked={field.showInTable}
                    onChange={(e) => void updateField(field.id, { showInTable: e.target.checked })}
                  />
                  {t('details.column')}
                </label>

                <div className="record-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void moveField(field.id, 'up')}
                    disabled={index === 0}
                    aria-label={t('details.moveUpAria', { name: field.name })}
                    title={t('details.moveUp')}
                  >
                    <Icon name="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void moveField(field.id, 'down')}
                    disabled={index === fields.length - 1}
                    aria-label={t('details.moveDownAria', { name: field.name })}
                    title={t('details.moveDown')}
                  >
                    <Icon name="arrowDown" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => void deleteField(field.id)}
                    aria-label={t('details.deleteAria', { name: field.name })}
                    title={t('details.deleteTitle')}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <div className="panel-head">{t('details.presets')}</div>
          <div style={{ padding: 'var(--space-4)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.labelKey}
                type="button"
                className="chip"
                disabled={isFull || existing.has(t(preset.nameKey).toLowerCase())}
                onClick={() =>
                  void addField({
                    name: t(preset.nameKey),
                    type: preset.type,
                    options: preset.options,
                    showInTable: true,
                  })
                }
                title={
                  existing.has(t(preset.nameKey).toLowerCase())
                    ? t('details.presetAdded')
                    : isFull
                      ? t('details.fullTitle', { max })
                      : t('details.presetAdd', { name: t(preset.nameKey) })
                }
              >
                <Icon name="plus" size={14} />
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>{t('details.warning')}</div>
        </div>
      </div>
    </div>
  );
}
