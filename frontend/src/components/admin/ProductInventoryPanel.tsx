import { Fragment, useEffect, useMemo, useState } from 'react';
import { ApiError, api, type AdminHostel } from '../../services/api';
import { previewMode } from '../../services/config';
import {
  MAX_STOCK_QUANTITY,
  type AdminProduct,
  type InventoryUpdateEntry,
  type ProductInventory,
  type ProductInventoryRow,
} from '../../types/product';
import Notice from '../ui/Notice';

const FILTER_THRESHOLD = 8;

interface Draft {
  isAvailable: boolean;
  quantity: string; // raw input so admins can type freely; validated before saving
}

interface Props {
  /** Admin product including its per-hostel stock summary. */
  product: AdminProduct;
  /** Every hostel, so hostels without a stock row are listed too. */
  hostels: AdminHostel[];
  onSaved: () => void;
  onGoToHostels?: () => void;
}

const parseQuantity = (text: string): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value <= MAX_STOCK_QUANTITY ? value : null;
};

const inventoryFromCatalogue = (product: AdminProduct, hostels: AdminHostel[]): ProductInventory => ({
  productId: product.id,
  productName: product.name,
  legacyStock: product.legacyStock,
  hostels: hostels.map((hostel) => {
    const row = product.inventories.find((inv) => inv.hostelId === hostel.id);
    return {
      hostelId: hostel.id,
      hostelName: hostel.name,
      hostelActive: hostel.isActive,
      isAvailable: row?.isAvailable ?? false,
      quantity: row?.quantity ?? 0,
      reserved: row?.reserved ?? 0,
      exists: Boolean(row),
      updatedAt: null,
    };
  }),
});

export default function ProductInventoryPanel({ product, hostels, onSaved, onGoToHostels }: Props) {
  const [inventory, setInventory] = useState<ProductInventory>(() => inventoryFromCatalogue(product, hostels));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filter, setFilter] = useState('');
  const [bulkQuantity, setBulkQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // The catalogue already carries every product's stock, so no per-product request is needed.
  // Unsaved edits live in `drafts` and survive a catalogue refresh.
  useEffect(() => {
    setInventory(inventoryFromCatalogue(product, hostels));
  }, [product, hostels]);

  const refreshFromServer = async () => {
    try {
      setInventory(await api.getProductInventory(product.id));
    } catch {
      /* the save error notice already tells the admin to refresh */
    }
  };

  const rows = useMemo(() => {
    const all = inventory.hostels;
    const sorted = [...all].sort((a, b) => Number(b.hostelActive) - Number(a.hostelActive) || a.hostelName.localeCompare(b.hostelName));
    const q = filter.trim().toLowerCase();
    return q ? sorted.filter((row) => row.hostelName.toLowerCase().includes(q)) : sorted;
  }, [inventory, filter]);

  const draftFor = (row: ProductInventoryRow): Draft => drafts[row.hostelId] ?? { isAvailable: row.isAvailable, quantity: String(row.quantity) };
  const isDirty = (row: ProductInventoryRow) => {
    const draft = drafts[row.hostelId];
    return Boolean(draft && (draft.isAvailable !== row.isAvailable || draft.quantity.trim() !== String(row.quantity)));
  };

  const allRows = inventory.hostels;
  const dirtyRows = allRows.filter(isDirty);
  const invalidRows = dirtyRows.filter((row) => parseQuantity(draftFor(row).quantity) === null);

  const update = (row: ProductInventoryRow, patch: Partial<Draft>) => {
    setNotice(null);
    setDrafts((prev) => ({ ...prev, [row.hostelId]: { ...draftFor(row), ...patch } }));
  };

  const step = (row: ProductInventoryRow, delta: number) => {
    const current = parseQuantity(draftFor(row).quantity) ?? 0;
    update(row, { quantity: String(Math.min(MAX_STOCK_QUANTITY, Math.max(0, current + delta))) });
  };

  const enableVisible = () => {
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.hostelId] = { ...(prev[row.hostelId] ?? { isAvailable: row.isAvailable, quantity: String(row.quantity) }), isAvailable: true };
      return next;
    });
  };

  const applyBulkQuantity = () => {
    if (parseQuantity(bulkQuantity) === null) return;
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.hostelId] = { ...(prev[row.hostelId] ?? { isAvailable: row.isAvailable, quantity: String(row.quantity) }), quantity: bulkQuantity.trim() };
      return next;
    });
  };

  const reset = () => {
    setDrafts({});
    setNotice(null);
  };

  const save = async () => {
    if (dirtyRows.length === 0 || invalidRows.length > 0) return;
    const entries: InventoryUpdateEntry[] = dirtyRows.map((row) => {
      const draft = draftFor(row);
      return {
        hostelId: row.hostelId,
        isAvailable: draft.isAvailable,
        quantity: parseQuantity(draft.quantity) as number,
        expectedQuantity: row.quantity,
      };
    });
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.updateProductInventory(product.id, entries);
      setInventory(saved);
      setDrafts({});
      setNotice({ tone: 'success', text: `Stock saved for ${entries.length} ${entries.length === 1 ? 'hostel' : 'hostels'}.` });
      onSaved();
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Could not save stock.';
      setNotice({ tone: 'error', text });
      // Someone else changed this stock: show the latest values but keep the admin's edits to review.
      if (e instanceof ApiError && e.status === 409) await refreshFromServer();
    } finally {
      setSaving(false);
    }
  };

  if (allRows.length === 0) {
    return (
      <div className="inv-panel inv-panel--empty">
        <p><strong>No hostels yet.</strong> Add a hostel before setting stock.</p>
        {onGoToHostels && <button type="button" className="btn btn--yellow btn--sm" onClick={onGoToHostels}>Go to hostels</button>}
      </div>
    );
  }

  const firstInactive = rows.findIndex((row) => !row.hostelActive);

  return (
    <div className="inv-panel">
      <div className="inv-panel__head">
        <div>
          <h4>Stock by hostel</h4>
          <p className="muted small">
            Customers only see this product at hostels where it is available. Quantity is stock available to sell now;
            units held for payments in progress are shown separately and return automatically if a payment isn’t completed.
            {inventory.legacyStock > 0 && <> Previous global stock: <strong>{inventory.legacyStock}</strong> (reference only).</>}
          </p>
        </div>
        <div className="inv-panel__tools">
          {allRows.length > FILTER_THRESHOLD && (
            <input className="inv-input" type="search" placeholder="Filter hostels" aria-label="Filter hostels" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <button type="button" className="btn btn--outline btn--sm inv-panel__tool" onClick={enableVisible} disabled={saving}>Enable all</button>
          <span className="inv-bulk">
            <input
              className="inv-input inv-input--qty"
              inputMode="numeric"
              placeholder="Qty"
              aria-label="Quantity for all listed hostels"
              value={bulkQuantity}
              onChange={(e) => setBulkQuantity(e.target.value)}
            />
            <button type="button" className="btn btn--outline btn--sm inv-panel__tool" onClick={applyBulkQuantity} disabled={saving || parseQuantity(bulkQuantity) === null}>
              Set all
            </button>
          </span>
        </div>
      </div>

      <ul className="inv-list">
        {rows.map((row, index) => {
          const draft = draftFor(row);
          const quantity = parseQuantity(draft.quantity);
          const dirty = isDirty(row);
          const status = !draft.isAvailable ? 'hidden' : quantity === 0 ? 'out' : 'live';
          const inputId = `inv-${product.id}-${row.hostelId}`;
          return (
            <Fragment key={row.hostelId}>
            {index === firstInactive && <li className="inv-list__group">Inactive hostels (hidden from customers)</li>}
            <li className={`inv-row${dirty ? ' inv-row--dirty' : ''}${row.hostelActive ? '' : ' inv-row--inactive'}`}>
              <div className="inv-row__hostel">
                <strong>{row.hostelName}</strong>
                <span className={`inv-chip inv-chip--${status}`}>{status === 'live' ? 'Live' : status === 'out' ? 'Out of stock' : 'Unavailable'}</span>
                {row.reserved > 0 && <span className="inv-held">{row.reserved} held for pending payments</span>}
              </div>
              <label className="inv-tick">
                <input
                  type="checkbox"
                  checked={draft.isAvailable}
                  onChange={(e) => update(row, { isAvailable: e.target.checked })}
                  disabled={saving}
                />
                <span className="inv-tick__box" aria-hidden="true" />
                <span>Available</span>
              </label>
              <div className="inv-qty">
                <label htmlFor={inputId} className="sr-only">Quantity at {row.hostelName}</label>
                <button type="button" aria-label={`Decrease quantity at ${row.hostelName}`} onClick={() => step(row, -1)} disabled={saving || (quantity ?? 0) <= 0}>−</button>
                <input
                  id={inputId}
                  inputMode="numeric"
                  value={draft.quantity}
                  aria-invalid={quantity === null}
                  onChange={(e) => update(row, { quantity: e.target.value })}
                  disabled={saving}
                />
                <button type="button" aria-label={`Increase quantity at ${row.hostelName}`} onClick={() => step(row, 1)} disabled={saving}>+</button>
              </div>
              {quantity === null && <p className="inv-row__error" role="alert">Enter a whole number from 0 to {MAX_STOCK_QUANTITY.toLocaleString('en-IN')}.</p>}
            </li>
            </Fragment>
          );
        })}
        {rows.length === 0 && <li className="muted small inv-list__none">No hostels match “{filter}”.</li>}
      </ul>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {previewMode && <Notice tone="info">Preview mode: saving is disabled until the backend is connected.</Notice>}

      <div className={`inv-panel__foot${dirtyRows.length > 0 ? ' inv-panel__foot--dirty' : ''}`}>
        <span className="small">
          {dirtyRows.length === 0 ? 'No unsaved changes' : `${dirtyRows.length} unsaved ${dirtyRows.length === 1 ? 'change' : 'changes'}`}
          {invalidRows.length > 0 && <span className="inv-panel__invalid"> · fix {invalidRows.length} invalid {invalidRows.length === 1 ? 'quantity' : 'quantities'}</span>}
        </span>
        <span className="inv-panel__actions">
          <button type="button" className="btn btn--outline btn--sm inv-panel__tool" onClick={reset} disabled={saving || dirtyRows.length === 0}>Reset</button>
          <button
            type="button"
            className="btn btn--yellow btn--sm"
            onClick={() => void save()}
            disabled={previewMode || saving || dirtyRows.length === 0 || invalidRows.length > 0}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </span>
      </div>
    </div>
  );
}
