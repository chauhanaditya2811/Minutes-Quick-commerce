import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import type { AdminProduct, StockGroup } from '../../types/product';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import { BuildingIcon } from '../ui/Icons';
import HostelStockEditor from './HostelStockEditor';
import { loadAdminCatalogue, type AdminCatalogue } from './adminCatalogue';

interface Props {
  /** Opens this pool's stock straight away once loaded. */
  initialPoolId?: string | null;
  onGoToProducts: () => void;
  onGoToHostels: () => void;
  /** Lets the dashboard warn before leaving the tab with unsaved stock edits. */
  onDirtyChange: (dirty: boolean) => void;
}

const MAX_NAMED_HOSTELS = 3;

// Per-group summary computed from the admin catalogue (one request for everything).
const summarise = (group: StockGroup, products: AdminProduct[]) => {
  let live = 0;
  let out = 0;
  let units = 0;
  let held = 0;
  for (const product of products) {
    const row = product.inventories.find((inv) => inv.stockGroupId === group.id);
    held += row?.reserved ?? 0;
    if (!row?.isAvailable) continue;
    if (row.quantity > 0) live += 1;
    else out += 1;
    units += row.quantity;
  }
  return { live, out, unavailable: products.length - live - out, units, held };
};

/** "BH-1, BH-2, BH-3 +9 more" */
const servedBy = (group: StockGroup) => {
  const names = group.hostels.map((h) => h.name);
  if (names.length === 0) return 'No hostels';
  const shown = names.slice(0, MAX_NAMED_HOSTELS).join(', ');
  return names.length > MAX_NAMED_HOSTELS ? `${shown} +${names.length - MAX_NAMED_HOSTELS} more` : shown;
};

/**
 * Stock management: one tile per pool (one shelf). Hostels in the same pool are managed
 * together; pick a pool to edit the availability and quantity of every product in it.
 */
export default function StockManager({ initialPoolId, onGoToProducts, onGoToHostels, onDirtyChange }: Props) {
  const { data, loading, error, reload } = useAsync<AdminCatalogue>(loadAdminCatalogue, []);
  const [selected, setSelected] = useState<StockGroup | null>(null);

  // Arriving from "Manage stock" on a pool: open it once the pools have loaded.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialPoolId || !data) return;
    opened.current = true;
    const pool = data.groups.find((g) => g.id === initialPoolId);
    if (pool) setSelected(pool);
  }, [data, initialPoolId]);

  // Live stocks first, then by name; stocks no hostel uses any more go last.
  const groups = useMemo(() => {
    const rank = (g: StockGroup) => (g.hostels.some((h) => h.isActive) ? 0 : g.hostels.length > 0 ? 1 : 2);
    return [...(data?.groups ?? [])].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [data]);
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
          stockGroupId={selected.id}
          groupName={selected.name}
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
          <p className="muted small">
            Each pool is one stock. Every hostel in a pool sells from the same quantities; manage pools in the Pools &amp; hostels tab.
          </p>
        </div>
      </div>

      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {loading && !data && <Loading label="Loading pools…" />}

      {data && groups.length === 0 && (
        <div className="stock-manager__empty">
          <p><strong>No pools yet.</strong> Create a pool and add hostels to it to start managing stock.</p>
          <button type="button" className="btn btn--yellow btn--sm" onClick={onGoToHostels}>Go to pools &amp; hostels</button>
        </div>
      )}
      {data && groups.length > 0 && products.length === 0 && (
        <Notice tone="info">
          No products yet, so there’s no stock to set. <button type="button" className="link-btn" onClick={onGoToProducts}>Add products</button>
        </Notice>
      )}

      {groups.length > 0 && (
        <ul className="hostel-grid">
          {groups.map((group) => {
            const summary = summarise(group, products);
            const live = group.hostels.some((h) => h.isActive);
            const shared = group.hostels.length > 1;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  className={`hostel-tile${live ? '' : ' hostel-tile--inactive'}`}
                  onClick={() => setSelected(group)}
                  aria-label={`Manage stock for the pool ${group.name}`}
                >
                  <span className="hostel-tile__top">
                    <span className="hostel-tile__icon" aria-hidden="true"><BuildingIcon width={20} height={20} /></span>
                    <span className="hostel-tile__name">
                      {group.name}
                      <span className="hostel-tile__served">{shared ? `${group.hostels.length} hostels · ` : ''}{servedBy(group)}</span>
                    </span>
                    <span className={`hostel-badge${live ? '' : ' hostel-badge--inactive'}`}>{live ? 'Live' : group.hostels.length ? 'Inactive' : 'Unused'}</span>
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
