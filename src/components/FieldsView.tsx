import { useState } from 'react';
import { useVault } from '../state/vault';
import type { FieldType } from '../types';
import { Icon } from './Icon';
import { NewFieldForm } from './ItemDialog';

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Choice list',
  date: 'Date',
  boolean: 'Yes / No',
};

/** Ready-made details for the shop types people ask about most. */
const PRESETS: { label: string; name: string; type: FieldType; options: string[] }[] = [
  { label: 'Clothes shop — Size', name: 'Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { label: 'Clothes shop — Colour', name: 'Colour', type: 'text', options: [] },
  { label: 'Toy shop — Age range', name: 'Age range', type: 'select', options: ['0-2', '3-5', '6-8', '9-12', '12+'] },
  { label: 'Shoe shop — Shoe size', name: 'Shoe size', type: 'number', options: [] },
  { label: 'Food shop — Expiry date', name: 'Expiry date', type: 'date', options: [] },
  { label: 'Any shop — Brand', name: 'Brand', type: 'text', options: [] },
  { label: 'Any shop — Shelf location', name: 'Shelf', type: 'text', options: [] },
];

export function FieldsView() {
  const { db, info, addField, updateField, deleteField, moveField } = useVault();
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
          <h1 className="view-title">Extra details</h1>
          <p className="view-sub">
            Every shop tracks something different. Add your own details here and they show up on
            every item — a size for a clothes shop, an age range for a toy shop, an expiry date for
            a mini-market. You can search, filter and sort by all of them.
          </p>
        </header>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            Every item always has these four: {standard.map((name, index) => (
              <span key={name}>
                <strong>{name}</strong>{index < standard.length - 1 ? ', ' : ''}
              </span>
            ))}. If your shop needs more, press <strong>Add a detail</strong> and create your own —
            up to {max} of them.
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
              title={isFull ? `You already have all ${max} extra details` : undefined}
            >
              <Icon name="plus" size={16} />
              Add a detail
            </button>
            <span className="counter-pill" aria-live="polite">
              {fields.length} of {max} used
            </span>
            <span className="field-hint">
              {isFull
                ? 'Delete one below to make room for another.'
                : 'Or start from one of the ready-made ones below.'}
            </span>
          </div>
        )}

        {fields.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="fields" size={26} /></div>
              <h3>No extra details yet</h3>
              <p>
                Items already have {standard.join(', ')} as standard. Anything else your shop
                needs — size, age range, colour, expiry date — you add here.
              </p>
            </div>
          </div>
        ) : (
          <div className="record-list">
            {fields.map((field, index) => (
              <div className="record" key={field.id}>
                <div className="record-main">
                  <div className="record-title">{field.name}</div>
                  <div className="record-sub">
                    {TYPE_LABEL[field.type]}
                    {field.type === 'select' && field.options.length > 0 && ` · ${field.options.join(', ')}`}
                    {field.required && ' · required'}
                  </div>
                </div>

                <label className="checkbox-row" title="Show as a column in the stock list">
                  <input
                    type="checkbox"
                    checked={field.showInTable}
                    onChange={(e) => void updateField(field.id, { showInTable: e.target.checked })}
                  />
                  Column
                </label>

                <label className="checkbox-row" title="Must be filled in when adding an item">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => void updateField(field.id, { required: e.target.checked })}
                  />
                  Required
                </label>

                <div className="record-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void moveField(field.id, 'up')}
                    disabled={index === 0}
                    aria-label={`Move ${field.name} up`}
                    title="Move up"
                  >
                    <Icon name="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void moveField(field.id, 'down')}
                    disabled={index === fields.length - 1}
                    aria-label={`Move ${field.name} down`}
                    title="Move down"
                  >
                    <Icon name="arrowDown" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => void deleteField(field.id)}
                    aria-label={`Delete ${field.name}`}
                    title="Delete detail"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <div className="panel-head">Ready-made details</div>
          <div style={{ padding: 'var(--space-4)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="chip"
                disabled={isFull || existing.has(preset.name.toLowerCase())}
                onClick={() =>
                  void addField({
                    name: preset.name,
                    type: preset.type,
                    options: preset.options,
                    showInTable: true,
                  })
                }
                title={
                  existing.has(preset.name.toLowerCase())
                    ? 'Already added'
                    : isFull
                      ? `You already have all ${max} extra details`
                      : `Add "${preset.name}" to every item`
                }
              >
                <Icon name="plus" size={14} />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            Deleting a detail removes that information from every item and cannot be undone —
            export a CSV first if you might want it back.
          </div>
        </div>
      </div>
    </div>
  );
}
