import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useVault } from '../state/vault';
import type { CustomField, CustomFieldValue, FieldType, Item } from '../types';
import { nextCategoryColor, normalizeNumberInput } from '../lib/input';
import { useT, type TranslationKey } from '../i18n';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface ItemDialogProps {
  item: Item | null;
  /** A barcode already read from a photo or a scanner, for a brand-new item. */
  prefillBarcode?: string;
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

function draftFromItem(item: Item | null, prefillBarcode = ''): Draft {
  return {
    name: item?.name ?? '',
    barcode: item?.barcode ?? prefillBarcode,
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

export function ItemDialog({ item, prefillBarcode = '', onClose }: ItemDialogProps) {
  const { db, info, addItem, updateItem, addCategory, addField, scanBarcodePhoto } = useVault();
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => draftFromItem(item, prefillBarcode));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showFieldForm, setShowFieldForm] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  /**
   * Reading the code out of a picture takes a moment, so the button says so
   * and stays disabled — pressing it twice would open two file dialogs.
   */
  const scanFromPhoto = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const code = await scanBarcodePhoto();
      if (code) {
        set('barcode', code);
        barcodeRef.current?.focus();
      }
    } finally {
      setScanning(false);
    }
  };

  const isEdit = Boolean(item);
  const fields = useMemo(
    () => [...db.customFields].sort((a, b) => a.order - b.order),
    [db.customFields],
  );
  const maxFields = info?.maxCustomFields ?? 5;
  const fieldsAreFull = fields.length >= maxFields;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setCustom = (fieldId: string, value: CustomFieldValue) =>
    setDraft((current) => ({ ...current, custom: { ...current.custom, [fieldId]: value } }));

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};

    if (!draft.name.trim()) found.name = t('form.nameError');

    const quantity = Number(draft.quantity);
    if (draft.quantity !== '' && (!Number.isFinite(quantity) || quantity < 0)) {
      found.quantity = t('form.quantityError');
    }

    const price = normalizeNumberInput(draft.price);
    if (draft.price.trim() !== '' && (price === null || price < 0)) {
      found.price = t('form.priceError');
    }

    const cost = normalizeNumberInput(draft.cost);
    if (draft.cost.trim() !== '' && (cost === null || cost < 0)) {
      found.cost = t('form.costError');
    }

    const barcode = draft.barcode.trim();
    if (barcode) {
      const clash = db.items.find((i) => i.barcode === barcode && i.id !== item?.id);
      if (clash) found.barcode = t('form.barcodeDuplicate', { name: clash.name });
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
      title={isEdit ? t('dialog.editTitle') : t('dialog.addTitle')}
      description={isEdit ? t('dialog.editSub') : t('dialog.addSub')}
      onClose={onClose}
      disableBackdropClose
      footer={
        <>
          <span className="field-hint">
            {isEdit ? t('dialog.footEdit') : t('dialog.footNew')}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={saving}>
            <Icon name="save" size={16} />
            {saving ? t('dialog.saving') : isEdit ? t('dialog.save') : t('action.addItem')}
          </button>
        </>
      }
    >
      <form id="item-form" className="modal-body" onSubmit={onSubmit} noValidate>
        <div className="fieldset">
          <div className="fieldset-title">
            <Icon name="box" size={16} />
            {t('dialog.standardTitle')}
          </div>
          <p className="fieldset-hint">{t('dialog.standardHint')}</p>

          <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="field-name">{t('form.name')}</label>
            <input
              id="field-name"
              className="input"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('form.namePlaceholder')}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'error-name' : undefined}
            />
            {errors.name && <span className="field-error" id="error-name">{errors.name}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-barcode">{t('form.barcode')}</label>
            <div className="input-row">
              <input
                id="field-barcode"
                ref={barcodeRef}
                className="input mono"
                value={draft.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                placeholder={t('form.barcodePlaceholder')}
                autoComplete="off"
                aria-invalid={Boolean(errors.barcode)}
              />
              {/* For a shop with no scanner: photograph the barcode and let the
                  app read it, rather than typing thirteen digits correctly. */}
              <button
                type="button"
                className="btn"
                disabled={scanning}
                onClick={() => void scanFromPhoto()}
                title={t('form.barcodePhotoHint')}
              >
                <Icon name="image" size={16} />
                {scanning ? t('form.barcodeReading') : t('form.barcodePhoto')}
              </button>
            </div>
            {errors.barcode
              ? <span className="field-error">{errors.barcode}</span>
              : <span className="field-hint">{t('form.barcodeHint')}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-quantity">{t('form.quantity')}</label>
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
            <label htmlFor="field-price">{t('form.price', { currency: db.settings.currency })}</label>
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
          </div>
        </div>

        <div className="fieldset">
          <div className="fieldset-title">
            <Icon name="tag" size={16} />
            {t('dialog.optionalTitle')}
          </div>
          <p className="fieldset-hint">{t('dialog.optionalHint')}</p>

          <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="field-category">{t('form.category')}</label>
            <select
              id="field-category"
              className="select"
              value={draft.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">{t('form.noCategory')}</option>
              {db.categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <div className="inline-add" style={{ marginTop: 4 }}>
              <div className="field">
                <input
                  className="input"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void onAddCategory(); }
                  }}
                  placeholder={t('form.newCategory')}
                  aria-label={t('form.newCategoryAria')}
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
                {t('form.addCategory')}
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="field-sku">{t('form.sku')}</label>
            <input
              id="field-sku"
              className="input"
              value={draft.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder={t('form.skuPlaceholder')}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="field-cost">{t('form.cost', { currency: db.settings.currency })}</label>
            <input
              id="field-cost"
              className="input"
              inputMode="decimal"
              value={draft.cost}
              onChange={(e) => set('cost', e.target.value)}
              placeholder={t('form.optional')}
              aria-invalid={Boolean(errors.cost)}
            />
            {errors.cost
              ? <span className="field-error">{errors.cost}</span>
              : <span className="field-hint">{t('form.costHint')}</span>}
          </div>

          <div className="field">
            <label htmlFor="field-lowStockThreshold">{t('form.lowStock')}</label>
            <input
              id="field-lowStockThreshold"
              className="input"
              type="number"
              min={0}
              step={1}
              value={draft.lowStockThreshold}
              onChange={(e) => set('lowStockThreshold', e.target.value)}
              placeholder={t('form.lowStockPlaceholder', { count: db.settings.defaultLowStockThreshold })}
            />
          </div>

          <div className="field">
            <label htmlFor="field-supplier">{t('form.supplier')}</label>
            <input
              id="field-supplier"
              className="input"
              value={draft.supplier}
              onChange={(e) => set('supplier', e.target.value)}
              placeholder={t('form.optional')}
              autoComplete="off"
            />
          </div>
          <div className="field span-2">
            <label htmlFor="field-notes">{t('form.notes')}</label>
            <textarea
              id="field-notes"
              className="textarea"
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={t('form.notesPlaceholder')}
            />
          </div>
          </div>
        </div>

        <div className="fieldset">
          <div className="fieldset-title">
            <Icon name="fields" size={16} />
            {t('dialog.customTitle')}
            <span className="counter-pill">
              {t('details.counter', { used: fields.length, max: maxFields })}
            </span>
          </div>
          <p className="fieldset-hint">{t('dialog.customHint', { max: maxFields })}</p>

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
            <button
              type="button"
              className="btn"
              onClick={() => setShowFieldForm(true)}
              disabled={fieldsAreFull}
              title={fieldsAreFull ? t('details.fullTitle', { max: maxFields }) : undefined}
            >
              <Icon name="plus" size={16} />
              {fieldsAreFull ? t('dialog.customFull', { max: maxFields }) : t('dialog.customAdd')}
            </button>
          )}
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
  const t = useT();
  const id = `field-custom:${field.id}`;

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
          {t('common.yes')}
        </label>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{field.name}</label>
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
  const t = useT();
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
          <label htmlFor="new-field-name">{t('newField.name')}</label>
          <input
            id="new-field-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newField.namePlaceholder')}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="new-field-type">{t('newField.type')}</label>
          <select
            id="new-field-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {(['text', 'select', 'number', 'date', 'boolean'] as const).map((option) => (
              <option key={option} value={option}>
                {t(`fieldType.${option}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        {type === 'select' && (
          <div className="field span-2">
            <label htmlFor="new-field-options">{t('newField.options')}</label>
            <textarea
              id="new-field-options"
              className="textarea"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={t('newField.optionsPlaceholder')}
            />
            <span className="field-hint">{t('newField.optionsHint')}</span>
          </div>
        )}
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={showInTable}
          onChange={(e) => setShowInTable(e.target.checked)}
        />
        {t('newField.showColumn')}
      </label>

      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || (type === 'select' && options.length === 0)}
          onClick={() => void onCreate({ name: name.trim(), type, options, showInTable })}
        >
          <Icon name="check" size={16} />
          {t('newField.create')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>{t('newField.cancel')}</button>
      </div>
    </div>
  );
}
