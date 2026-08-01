import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useVault } from '../state/vault';
import type { CustomField, CustomFieldValue, FieldType, Item } from '../types';
import { nextCategoryColor, normalizeNumberInput } from '../lib/input';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface ItemDialogProps {
  item: Item | null;
  onClose: () => void;
}

interface Draft {
  name: string;
  barcode: string;
  sku: string;
  categoryId: string;
  quantity: string;
  price: string;
  cost: string;
  lowStockThreshold: string;
  supplier: string;
  notes: string;
  custom: Record<string, CustomFieldValue>;
}

function draftFromItem(item: Item | null): Draft {
  return {
    name: item?.name ?? '',
    barcode: item?.barcode ?? '',
    sku: item?.sku ?? '',
    categoryId: item?.categoryId ?? '',
    quantity: item ? String(item.quantity) : '0',
    price: item ? String(item.price) : '',
    cost: item ? String(item.cost) : '',
    lowStockThreshold: item?.lowStockThreshold != null ? String(item.lowStockThreshold) : '',
    supplier: item?.supplier ?? '',
    notes: item?.notes ?? '',
    custom: { ...(item?.custom ?? {}) },
  };
}

export function ItemDialog({ item, onClose }: ItemDialogProps) {
  const { db, addItem, updateItem, addCategory, addField } = useVault();
  const [draft, setDraft] = useState<Draft>(() => draftFromItem(item));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showFieldForm, setShowFieldForm] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(item);
  const fields = useMemo(
    () => [...db.customFields].sort((a, b) => a.order - b.order),
    [db.customFields],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setCustom = (fieldId: string, value: CustomFieldValue) =>
    setDraft((current) => ({ ...current, custom: { ...current.custom, [fieldId]: value } }));

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};

    if (!draft.name.trim()) found.name = 'Give the item a name so you can find it later.';

    const quantity = Number(draft.quantity);
    if (draft.quantity !== '' && (!Number.isFinite(quantity) || quantity < 0)) {
      found.quantity = 'Quantity must be 0 or more.';
    }

    const price = normalizeNumberInput(draft.price);
    if (draft.price.trim() !== '' && (price === null || price < 0)) {
      found.price = 'Enter a price like 12.50';
    }

    const cost = normalizeNumberInput(draft.cost);
    if (draft.cost.trim() !== '' && (cost === null || cost < 0)) {
      found.cost = 'Enter a cost like 8.00';
    }

    const barcode = draft.barcode.trim();
    if (barcode) {
      const clash = db.items.find((i) => i.barcode === barcode && i.id !== item?.id);
      if (clash) found.barcode = `"${clash.name}" already uses this barcode.`;
    }

    for (const field of fields) {
      if (!field.required) continue;
      const value = draft.custom[field.id];
      if (value === undefined || value === '' || value === null) {
        found[`custom:${field.id}`] = `${field.name} is required.`;
      }
    }

    return found;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      const firstKey = Object.keys(found)[0];
      document.getElementById(`field-${firstKey}`)?.focus();
      return;
    }

    const payload: Partial<Item> = {
      name: draft.name.trim(),
      barcode: draft.barcode.trim(),
      sku: draft.sku.trim(),
      categoryId: draft.categoryId,
      quantity: draft.quantity === '' ? 0 : Number(draft.quantity),
      price: normalizeNumberInput(draft.price) ?? 0,
      cost: normalizeNumberInput(draft.cost) ?? 0,
      lowStockThreshold:
        draft.lowStockThreshold.trim() === '' ? null : Number(draft.lowStockThreshold),
      supplier: draft.supplier.trim(),
      notes: draft.notes,
      custom: draft.custom,
    };

    setSaving(true);
    const saved = item ? await updateItem(item.id, payload) : await addItem(payload);
    setSaving(false);
    if (saved) onClose();
  }

  async function onAddCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const category = await addCategory(name, nextCategoryColor(db.categories.length));
    if (category) {
      set('categoryId', category.id);
      setNewCategory('');
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit item' : 'Add a new item'}
      description={
        isEdit
          ? 'Update the details and save. Nothing leaves this computer.'
          : 'Fill in what you know — you can always come back and add more later.'
      }
      onClose={onClose}
      disableBackdropClose
      footer={
        <>
          <span className="field-hint">
            {isEdit ? 'Changes are saved to your local file.' : 'Only the name is required.'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={saving}>
            <Icon name="save" size={16} />
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
          </button>
        </>
      }
    >
      <form id="item-form" className="modal-body" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="field-name">Item name</label>
            <input
              id="field-name"
              className="input"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Cotton T-shirt"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'error-name' : undefined}
            />
            {errors.name && <span className="field-error" id="error-name">{errors.name}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-barcode">Barcode</label>
            <input
              id="field-barcode"
              ref={barcodeRef}
              className="input mono"
              value={draft.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              placeholder="Scan or type"
              autoComplete="off"
              aria-invalid={Boolean(errors.barcode)}
            />
            {errors.barcode
              ? <span className="field-error">{errors.barcode}</span>
              : <span className="field-hint">Click here, then scan with your barcode reader.</span>}
          </div>

          <div className="field">
            <label htmlFor="field-sku">Item code / SKU</label>
            <input
              id="field-sku"
              className="input"
              value={draft.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder="Your own reference"
              autoComplete="off"
            />
          </div>

          <div className="field span-2">
            <label htmlFor="field-category">Category</label>
            <div className="inline-add">
              <select
                id="field-category"
                className="select"
                value={draft.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">No category</option>
                {db.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="inline-add" style={{ marginTop: 4 }}>
              <div className="field">
                <input
                  className="input"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void onAddCategory(); }
                  }}
                  placeholder="New category name…"
                  aria-label="New category name"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void onAddCategory()}
                disabled={!newCategory.trim()}
              >
                <Icon name="plus" size={16} />
                Add category
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="field-quantity">Stock quantity</label>
            <input
              id="field-quantity"
              className="input"
              type="number"
              min={0}
              step={1}
              value={draft.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              aria-invalid={Boolean(errors.quantity)}
            />
            {errors.quantity && <span className="field-error">{errors.quantity}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-price">Selling price ({db.settings.currency})</label>
            <input
              id="field-price"
              className="input"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="0.00"
              aria-invalid={Boolean(errors.price)}
            />
            {errors.price && <span className="field-error">{errors.price}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-cost">Cost price ({db.settings.currency})</label>
            <input
              id="field-cost"
              className="input"
              inputMode="decimal"
              value={draft.cost}
              onChange={(e) => set('cost', e.target.value)}
              placeholder="Optional"
              aria-invalid={Boolean(errors.cost)}
            />
            {errors.cost
              ? <span className="field-error">{errors.cost}</span>
              : <span className="field-hint">What you paid — used for profit totals.</span>}
          </div>

          <div className="field">
            <label htmlFor="field-lowStockThreshold">Warn me below</label>
            <input
              id="field-lowStockThreshold"
              className="input"
              type="number"
              min={0}
              step={1}
              value={draft.lowStockThreshold}
              onChange={(e) => set('lowStockThreshold', e.target.value)}
              placeholder={`Default (${db.settings.defaultLowStockThreshold})`}
            />
          </div>

          <div className="field">
            <label htmlFor="field-supplier">Supplier</label>
            <input
              id="field-supplier"
              className="input"
              value={draft.supplier}
              onChange={(e) => set('supplier', e.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="fieldset">
          <div className="fieldset-title">
            <Icon name="fields" size={16} />
            Extra details
          </div>
          <p className="fieldset-hint">
            Add your own details so MyVault fits your shop — size for clothes, age range for toys,
            colour, expiry date, anything. They appear on every item and you can search and sort by
            them.
          </p>

          {fields.length > 0 && (
            <div className="form-grid">
              {fields.map((field) => (
                <CustomFieldInput
                  key={field.id}
                  field={field}
                  value={draft.custom[field.id]}
                  error={errors[`custom:${field.id}`]}
                  onChange={(value) => setCustom(field.id, value)}
                />
              ))}
            </div>
          )}

          {showFieldForm ? (
            <NewFieldForm
              onCancel={() => setShowFieldForm(false)}
              onCreate={async (input) => {
                const created = await addField(input);
                if (created) setShowFieldForm(false);
              }}
            />
          ) : (
            <button type="button" className="btn" onClick={() => setShowFieldForm(true)}>
              <Icon name="plus" size={16} />
              Add a detail (Size, Age, Colour…)
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="field-notes">Notes</label>
          <textarea
            id="field-notes"
            className="textarea"
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Anything you want to remember about this item"
          />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

interface CustomFieldInputProps {
  field: CustomField;
  value: CustomFieldValue | undefined;
  error?: string;
  onChange: (value: CustomFieldValue) => void;
}

export function CustomFieldInput({ field, value, error, onChange }: CustomFieldInputProps) {
  const id = `field-custom:${field.id}`;
  const label = field.required ? `${field.name} *` : field.name;

  if (field.type === 'boolean') {
    return (
      <div className="field">
        <span className="field-label">{field.name}</span>
        <label className="checkbox-row" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          Yes
        </label>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {field.type === 'select' ? (
        <select
          id={id}
          className="select"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          aria-invalid={Boolean(error)}
        />
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface NewFieldFormProps {
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    type: FieldType;
    options: string[];
    showInTable: boolean;
  }) => void | Promise<void>;
}

export function NewFieldForm({ onCancel, onCreate }: NewFieldFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [showInTable, setShowInTable] = useState(true);

  const options = optionsText
    .split(/[\n,]/)
    .map((option) => option.trim())
    .filter(Boolean);

  return (
    <div className="fieldset" style={{ background: 'var(--surface)' }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="new-field-name">Detail name</label>
          <input
            id="new-field-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Size"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="new-field-type">Kind of value</label>
          <select
            id="new-field-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            <option value="text">Text — free typing</option>
            <option value="select">Choice list — pick from options</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="boolean">Yes / No</option>
          </select>
        </div>
        {type === 'select' && (
          <div className="field span-2">
            <label htmlFor="new-field-options">Options</label>
            <textarea
              id="new-field-options"
              className="textarea"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="S, M, L, XL"
            />
            <span className="field-hint">Separate with commas or new lines.</span>
          </div>
        )}
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={showInTable}
          onChange={(e) => setShowInTable(e.target.checked)}
        />
        Show this as a column in the stock list
      </label>

      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || (type === 'select' && options.length === 0)}
          onClick={() => void onCreate({ name: name.trim(), type, options, showInTable })}
        >
          <Icon name="check" size={16} />
          Create detail
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
