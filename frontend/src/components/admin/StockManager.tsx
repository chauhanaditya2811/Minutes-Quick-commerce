import { useCallback, useMemo, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import type { AdminHostel } from '../../services/api';
import type { AdminProduct } from '../../types/product';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import { BuildingIcon } from '../ui/Icons';
import HostelStockEditor from './HostelStockEditor';
import { loadAdminCatalogue, type AdminCatalogue } from './adminCatalogue';

interface Props {
  onGoToProducts: () => void;
  onGoToHostels: () => void;
  /** Lets the dashboard warn before leaving the tab with unsaved stock edits. */
  onDirtyChange: (dirty: boolean) => void;
}

// Per-hostel summary computed from the admin catalogue (one request for all hostels).
const summarise = (hostel: AdminHostel, products: AdminProduct[]) => {
  let live = 0;
  let out = 0;
  let units = 0;
  let held = 0;
  for (const product of products) {
    const row = product.inventories.find((inv) => inv.hostelId === hostel.id);
    held += row?.reserved ?? 0;
    if (!row?.isAvailable) continue;
    if (row.quantity > 0) live += 1;
    else out += 1;
    units += row.quantity;
  }
  return { live, out, unavailable: products.length - live - out, units, held };
};

/** Hostel-first stock management: pick a hostel, then edit every product's stock there. */
export default function StockManager({ onGoToProducts, onGoToHostels, onDirtyChange }: Props) {
  const { data, loading, error, reload } = useAsync<AdminCatalogue>(loadAdminCatalogue, []);
  const [selected, setSelected] = useState<AdminHostel | null>(null);

  const hostels = useMemo(
    () => [...(data?.hostels ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
    [data]
  );
  const products = data?.products ?? [];

  const closeEditor = useCallback(() => {
    setSelected(null);
    onDirtyChange(false);
    reload(); // refresh the summaries with what was just saved
  }, [onDirtyChange, reload]);

  if (selected) {
    return (
      <section className="panel stock-manager">
        <HostelStockEditor
          key={selected.id}
          hostelId={selected.id}
          hostelName={selected.name}
          catalogue={data}
          onBack={closeEditor}
          onDirtyChange={onDirtyChange}
          onSaved={reload}
          onGoToProducts={onGoToProducts}
        />
      </section>
    );
  }

  return (
    <section className="panel stock-manager">
      <div className="panel__head">
        <div>
          <h2>Stock management</h2>
          <p className="muted small">Choose a hostel to set the availability and quantity of every product there.</p>
        </div>
      </div>

      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {loading && !data && <Loading label="Loading hostels…" />}

      {data && hostels.length === 0 && (
        <div className="stock-manager__empty">
          <p><strong>No hostels yet.</strong> Add a hostel to start managing its stock.</p>
          <button type="button" className="btn btn--yellow btn--sm" onClick={onGoToHostels}>Go to hostels</button>
        </div>
      )}
      {data && hostels.length > 0 && products.length === 0 && (
        <Notice tone="info">
          No products yet, so there’s no stock to set. <button type="button" className="link-btn" onClick={onGoToProducts}>Add products</button>
        </Notice>
      )}

      {hostels.length > 0 && (
        <ul className="hostel-grid">
          {hostels.map((hostel) => {
            const summary = summarise(hostel, products);
            return (
              <li key={hostel.id}>
                <button
                  type="button"
                  className={`hostel-tile${hostel.isActive ? '' : ' hostel-tile--inactive'}`}
                  onClick={() => setSelected(hostel)}
                  aria-label={`Manage stock at ${hostel.name}`}
                >
                  <span className="hostel-tile__top">
                    <span className="hostel-tile__icon" aria-hidden="true"><BuildingIcon width={20} height={20} /></span>
                    <span className="hostel-tile__name">{hostel.name}</span>
                    <span className={`hostel-badge${hostel.isActive ? '' : ' hostel-badge--inactive'}`}>{hostel.isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  {products.length > 0 && (
                    <span className="hostel-tile__stats">
                      <span><strong>{summary.live}</strong> available</span>
                      <span><strong>{summary.out}</strong> out of stock</span>
                      <span><strong>{summary.unavailable}</strong> unavailable</span>
                    </span>
                  )}
                  <span className="hostel-tile__foot">
                    <span className="muted small">
                      {summary.units} units in stock{summary.held > 0 ? ` · ${summary.held} held for payments` : ''}
                    </span>
                    <span className="hostel-tile__cta">Manage stock ›</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
