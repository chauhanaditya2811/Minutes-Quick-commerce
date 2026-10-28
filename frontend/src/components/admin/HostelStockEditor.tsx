import { useCallback, useEffect, useMemo, useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import { ApiError, api } from '../../services/api';
import { previewMode } from '../../services/config';
import { formatINR } from '../../utils/format';
import {
  MAX_STOCK_QUANTITY,
  type HostelStock,
  type HostelStockRow,
  type HostelStockUpdateEntry,
} from '../../types/product';
import Notice from '../ui/Notice';
import { SearchIcon } from '../ui/Icons';
import type { AdminCatalogue } from './adminCatalogue';

type Filter = 'all' | 'live' | 'out' | 'unavailable' | 'changed';

interface Draft {
  isAvailable: boolean;
  quantity: string; // raw input so admins can type freely; validated before saving
}

interface Props {
  hostelId: string;
  /** Shown while the hostel's stock loads. */
  hostelName: string;
  /** Preview mode only: builds stock from sample data instead of the API. */
  catalogue: AdminCatalogue | null;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onGoToProducts: () => void;
}

const parseQuantity = (text: string): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value <= MAX_STOCK_QUANTITY ? value : null;
};

const previewStock = (catalogue: AdminCatalogue, hostelId: string): HostelStock | null => {
  const hostel = catalogue.hostels.find((h) => h.id === hostelId);
  if (!hostel) return null;
  return {
    hostelId,
    hostelName: hostel.name,
    hostelActive: hostel.isActive,
    products: [...catalogue.products]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => {
        const row = product.inventories.find((inv) => inv.hostelId === hostelId);
        return {
          productId: product.id,
          name: product.name,
          imageUrl: product.imageUrl,
          unit: product.unit,
          price: product.price,
          isAvailable: row?.isAvailable ?? false,
          quantity: row?.quantity ?? 0,
          reserved: row?.reserved ?? 0,
          exists: Boolean(row),
          updatedAt: null,
        };
      }),
  };
};

/** Every product's stock at one hostel, edited together and saved in one atomic request. */
export default function HostelStockEditor({ hostelId, hostelName, catalogue, onBack, onDirtyChange, onSaved, onGoToProducts }: Props) {
  const [stock, setStock] = useState<HostelStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [bulkQuantity, setBulkQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const fresh = previewMode ? (catalogue ? previewStock(catalogue, hostelId) : null) : await api.getHostelStock(hostelId);
      if (!fresh) throw new Error('This hostel no longer exists.');
      setStock(fresh);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load stock for this hostel.');
    } finally {
      setLoading(false);
    }
  }, [catalogue, hostelId]);

  useEffect(() => {
    void load();
    // Load once per hostel; later refreshes are explicit (after saving or a conflict).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostelId]);

  const rows = stock?.products ?? [];
  const draftFor = (row: HostelStockRow): Draft =>
    drafts[row.productId] ?? { isAvailable: row.isAvailable, quantity: String(row.quantity) };
  const isDirty = (row: HostelStockRow) => {
    const draft = drafts[row.productId];
    return Boolean(draft && (draft.isAvailable !== row.isAvailable || draft.quantity.trim() !== String(row.quantity)));
  };
  const statusOf = (row: HostelStockRow) => {
    const draft = draftFor(row);
    if (!draft.isAvailable) return 'unavailable';
    return parseQuantity(draft.quantity) === 0 ? 'out' : 'live';
  };

  const dirtyRows = rows.filter(isDirty);
  const invalidRows = dirtyRows.filter((row) => parseQuantity(draftFor(row).quantity) === null);
  const dirty = dirtyRows.length > 0;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Warn before closing or reloading the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'changed') return isDirty(row);
      return statusOf(row) === filter;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filter, drafts]);

  const counts = useMemo(() => {
    const result = { live: 0, out: 0, unavailable: 0 };
    for (const row of rows) result[statusOf(row) as keyof typeof result] += 1;
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, drafts]);

  const update = (row: HostelStockRow, patch: Partial<Draft>) => {
    setNotice(null);
    setDrafts((prev) => ({ ...prev, [row.productId]: { ...draftFor(row), ...patch } }));
  };

  const step = (row: HostelStockRow, delta: number) => {
    const current = parseQuantity(draftFor(row).quantity) ?? 0;
    update(row, { quantity: String(Math.min(MAX_STOCK_QUANTITY, Math.max(0, current + delta))) });
  };

  const applyToVisible = (patch: Partial<Draft>) => {
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of visible) next[row.productId] = { ...(prev[row.productId] ?? { isAvailable: row.isAvailable, quantity: String(row.quantity) }), ...patch };
      return next;
    });
  };

  const back = () => {
    if (dirty && !window.confirm(`Discard ${dirtyRows.length} unsaved ${dirtyRows.length === 1 ? 'change' : 'changes'} for ${stock?.hostelName ?? hostelName}?`)) return;
    onBack();
  };

  const save = async () => {
    if (!dirty || invalidRows.length > 0) return;
    const entries: HostelStockUpdateEntry[] = dirtyRows.map((row) => {
      const draft = draftFor(row);
      return {
        productId: row.productId,
        isAvailable: draft.isAvailable,
        quantity: parseQuantity(draft.quantity) as number,
        expectedQuantity: row.quantity,
      };
    });
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.updateHostelStock(hostelId, entries);
      setStock(saved);
      setDrafts({});
      setNotice({ tone: 'success', text: `Saved stock for ${entries.length} ${entries.length === 1 ? 'product' : 'products'} at ${saved.hostelName}.` });
      onSaved();
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409;
      const message = e instanceof Error ? e.message : 'Could not save stock.';
      setNotice({
        tone: 'error',
        text: conflict
          ? `${message} Nothing was saved. The latest stock is now shown and your edits are kept — review them and save again.`
          : `${message} Nothing was saved.`,
      });
      // Someone else (or a customer's checkout) changed stock: show the latest values but keep the edits.
      if (conflict) {
        try {
          setStock(await api.getHostelStock(hostelId));
        } catch {
          /* the error notice already asks the admin to review and retry */
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const title = stock?.hostelName ?? hostelName;

  return (
    <div className="hostel-stock">
      <div className="hostel-stock__head">
        <button type="button" className="btn btn--outline btn--sm hostel-stock__back" onClick={back}>
          ← All hostels
        </button>
        <div className="hostel-stock__title">
          <p className="hostel-stock__crumbs muted small">Stock management / {title}</p>
          <h3>
            {title}{' '}
            {stock && <span className={`hostel-badge${stock.hostelActive ? '' : ' hostel-badge--inactive'}`}>{stock.hostelActive ? 'Active' : 'Inactive'}</span>}
          </h3>
        </div>
      </div>

      {stock && !stock.hostelActive && (
        <Notice tone="warning">
          {stock.hostelName} is inactive, so customers can’t choose it. You can still prepare its stock; it goes live when the hostel is activated.
        </Notice>
      )}

      {loading && !stock && (
        <div aria-busy="true" aria-label="Loading stock">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={56} borderRadius={8} style={{ marginBottom: 8 }} />)}
        </div>
      )}
      {loadError && !stock && (
        <Notice tone="error">
          {loadError} <button type="button" className="link-btn" onClick={() => void load()}>Try again</button>
        </Notice>
      )}

      {stock && rows.length === 0 && (
        <div className="stock-manager__empty">
          <p><strong>No products yet.</strong> Add products first, then set their stock here.</p>
          <button type="button" className="btn btn--yellow btn--sm" onClick={onGoToProducts}>Go to products</button>
        </div>
      )}

      {stock && rows.length > 0 && (
        <>
          <p className="muted small hostel-stock__help">
            <strong>Quantity</strong> is stock available to sell now. Untick <strong>Available</strong> to hide a product at this hostel;
            keep it ticked with 0 to show it as out of stock. Units held for payments in progress are shown separately and return
            automatically if a payment isn’t completed.
          </p>

          <div className="product-toolbar">
            <label className="product-toolbar__search">
              <SearchIcon width={16} height={16} />
              <input type="search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="product-toolbar__view">
              <span className="small muted">Show</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter products">
                <option value="all">All products ({rows.length})</option>
                <option value="live">Available ({counts.live})</option>
                <option value="out">Out of stock ({counts.out})</option>
                <option value="unavailable">Unavailable ({counts.unavailable})</option>
                <option value="changed">Unsaved changes ({dirtyRows.length})</option>
              </select>
            </label>
          </div>
          <div className="inv-panel__tools hostel-stock__bulk">
            <span className="small muted">For the {visible.length} listed:</span>
            <button type="button" className="btn btn--outline btn--sm inv-panel__tool" onClick={() => applyToVisible({ isAvailable: true })} disabled={saving || visible.length === 0}>
              Make available
            </button>
            <span className="inv-bulk">
              <input
                className="inv-input inv-input--qty"
                inputMode="numeric"
                placeholder="Qty"
                aria-label="Quantity for all listed products"
                value={bulkQuantity}
                onChange={(e) => setBulkQuantity(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--outline btn--sm inv-panel__tool"
                onClick={() => applyToVisible({ quantity: bulkQuantity.trim() })}
                disabled={saving || visible.length === 0 || parseQuantity(bulkQuantity) === null}
              >
                Set quantity
              </button>
            </span>
          </div>

          <ul className="hostel-stock__list">
            {visible.map((row) => {
              const draft = draftFor(row);
              const quantity = parseQuantity(draft.quantity);
              const status = statusOf(row);
              const inputId = `stock-${hostelId}-${row.productId}`;
              return (
                <li key={row.productId} className={`hostel-stock__row${isDirty(row) ? ' hostel-stock__row--dirty' : ''}${status === 'unavailable' ? ' hostel-stock__row--off' : ''}`}>
                  <div className="hostel-stock__product">
                    <img src={row.imageUrl} alt="" />
                    <div>
                      <strong>{row.name}</strong>
                      <span className="muted small">{row.unit} · {formatINR(row.price)}</span>
                    </div>
                  </div>
                  <div className="hostel-stock__state">
                    <span className={`inv-chip inv-chip--${status === 'unavailable' ? 'hidden' : status}`}>
                      {status === 'live' ? 'Available' : status === 'out' ? 'Out of stock' : 'Unavailable'}
                    </span>
                    {!row.exists && !isDirty(row) && <span className="muted small">Not set up yet</span>}
                    {row.reserved > 0 && <span className="inv-held">{row.reserved} held for pending payments</span>}
                  </div>
                  <label className="inv-tick">
                    <input type="checkbox" checked={draft.isAvailable} onChange={(e) => update(row, { isAvailable: e.target.checked })} disabled={saving} />
                    <span className="inv-tick__box" aria-hidden="true" />
                    <span>Available</span>
                  </label>
                  <div className="inv-qty">
                    <label htmlFor={inputId} className="sr-only">Quantity of {row.name} at {title}</label>
                    <button type="button" aria-label={`Decrease ${row.name} quantity`} onClick={() => step(row, -1)} disabled={saving || (quantity ?? 0) <= 0}>−</button>
                    <input
                      id={inputId}
                      inputMode="numeric"
                      value={draft.quantity}
                      aria-invalid={quantity === null}
                      onChange={(e) => update(row, { quantity: e.target.value })}
                      disabled={saving}
                    />
                    <button type="button" aria-label={`Increase ${row.name} quantity`} onClick={() => step(row, 1)} disabled={saving}>+</button>
                  </div>
                  {quantity === null && (
                    <p className="inv-row__error" role="alert">Enter a whole number from 0 to {MAX_STOCK_QUANTITY.toLocaleString('en-IN')}.</p>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && <li className="muted small inv-list__none">No products match these filters.</li>}
          </ul>

          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          {previewMode && <Notice tone="info">Preview mode: saving is disabled until the backend is connected.</Notice>}

          <div className={`inv-panel__foot hostel-stock__foot${dirty ? ' inv-panel__foot--dirty' : ''}`}>
            <span className="small">
              {dirty ? `${dirtyRows.length} unsaved ${dirtyRows.length === 1 ? 'change' : 'changes'} at ${title}` : 'No unsaved changes'}
              {invalidRows.length > 0 && <span className="inv-panel__invalid"> · fix {invalidRows.length} invalid {invalidRows.length === 1 ? 'quantity' : 'quantities'}</span>}
            </span>
            <span className="inv-panel__actions">
              <button type="button" className="btn btn--outline btn--sm inv-panel__tool" onClick={() => { setDrafts({}); setNotice(null); }} disabled={saving || !dirty}>
                Reset
              </button>
              <button type="button" className="btn btn--yellow btn--sm" onClick={() => void save()} disabled={previewMode || saving || !dirty || invalidRows.length > 0}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
