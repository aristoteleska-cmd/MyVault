import { useMemo, useState } from 'react';
import { useVault } from '../state/vault';
import { nextCategoryColor } from '../lib/format';
import { useT } from '../i18n';
import { Icon } from './Icon';

export function CategoriesView({ onBrowse }: { onBrowse: (categoryId: string) => void }) {
  const { db, addCategory, updateCategory, deleteCategory } = useVault();
  const t = useT();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of db.items) {
      map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    }
    return map;
  }, [db.items]);

  async function onAdd() {
    const clean = name.trim();
    if (!clean) return;
    const created = await addCategory(clean, nextCategoryColor(db.categories.length));
    if (created) setName('');
  }

  function startRename(id: string, current: string) {
    setEditingId(id);
    setEditingName(current);
  }

  async function commitRename(id: string) {
    const clean = editingName.trim();
    if (clean) await updateCategory(id, { name: clean });
    setEditingId(null);
  }

  return (
    <div className="view">
      <div className="view-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header className="view-header">
          <h1 className="view-title">{t('categories.title')}</h1>
          <p className="view-sub">{t('categories.sub')}</p>
        </header>

        <div className="toolbar">
          <div className="field" style={{ flex: 1 }}>
            <label className="visually-hidden" htmlFor="new-category">{t('categories.newLabel')}</label>
            <input
              id="new-category"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd(); } }}
              placeholder={t('categories.placeholder')}
              autoComplete="off"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void onAdd()} disabled={!name.trim()}>
            <Icon name="plus" size={16} />
            {t('categories.add')}
          </button>
        </div>

        {db.categories.length === 0 ? (
          <div className="panel">
            <div className="empty">
              <div className="empty-art"><Icon name="tag" size={26} /></div>
              <h3>{t('categories.emptyTitle')}</h3>
              <p>{t('categories.emptyBody')}</p>
            </div>
          </div>
        ) : (
          <div className="record-list">
            {db.categories.map((category) => {
              const count = counts.get(category.id) ?? 0;
              return (
                <div className="record" key={category.id}>
                  <input
                    type="color"
                    className="swatch"
                    value={category.color}
                    onChange={(e) => void updateCategory(category.id, { color: e.target.value })}
                    aria-label={t('categories.colourAria', { name: category.name })}
                    title={t('categories.colourTitle')}
                  />

                  <div className="record-main">
                    {editingId === category.id ? (
                      <input
                        className="input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => void commitRename(category.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void commitRename(category.id); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        aria-label={t('categories.nameLabel')}
                        autoFocus
                      />
                    ) : (
                      <>
                        <div className="record-title">{category.name}</div>
                        <div className="record-sub">
                          {count === 0
                            ? t('categories.noItems')
                            : count === 1
                              ? t('categories.oneItem')
                              : t('categories.manyItems', { count })}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="record-actions">
                    {count > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onBrowse(category.id)}
                      >
                        {t('categories.view')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startRename(category.id, category.name)}
                      aria-label={t('categories.renameAria', { name: category.name })}
                      title={t('categories.rename')}
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => void deleteCategory(category.id)}
                      aria-label={t('categories.deleteAria', { name: category.name })}
                      title={t('categories.deleteTitle')}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="callout">
          <Icon name="info" size={18} />
          <div>{t('categories.note')}</div>
        </div>
      </div>
    </div>
  );
}
