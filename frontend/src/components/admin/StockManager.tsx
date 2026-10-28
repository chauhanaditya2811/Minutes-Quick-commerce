import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import { formatINR } from '../../utils/format';
import type { AdminProduct } from '../../types/product';
import type { AdminHostel } from '../../services/api';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import { SearchIcon } from '../ui/Icons';
import ProductInventoryPanel from './ProductInventoryPanel';
import { loadAdminCatalogue, type AdminCatalogue } from './adminCatalogue';

type Show = 'all' | 'live' | 'unavailable';

interface Props {
  /** Scrolls to this product when the tab opens, e.g. from the Products tab or after adding one. */
  focusProductId?: string | null;
  onGoToProducts: () => void;
  onGoToHostels: () => void;
}

const liveHostelCount = (product: AdminProduct, hostels: AdminHostel[]) => {
  const activeIds = new Set(hostels.filter((h) => h.isActive).map((h) => h.id));
  return product.inventories.filter((inv) => inv.isAvailable && activeIds.has(inv.hostelId)).length;
};

export default function StockManager({ focusProductId, onGoToProducts, onGoToHostels }: Props) {
  const { data, loading, error, reload } = useAsync<AdminCatalogue>(loadAdminCatalogue, []);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');

  const products = data?.products ?? [];
  const hostels = data?.hostels ?? [];
  const activeHostels = hostels.filter((h) => h.isActive).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      const live = liveHostelCount(p, hostels);
      return show === 'all' || (show === 'live' ? live > 0 : live === 0);
    });
  }, [products, hostels, query, show]);

  useEffect(() => {
    if (!data || !focusProductId) return;
    document.getElementById(`stock-${focusProductId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, focusProductId]);

  return (
    <section className="panel stock-manager">
      <div className="panel__head">
        <div>
          <h2>Stock management</h2>
          <p className="muted small">Tick the hostels where each product is sold and set its stock there. Customers only see products ticked for their hostel.</p>
        </div>
      </div>

      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {loading && !data && <Loading label="Loading products and hostels…" />}

      {data && hostels.length === 0 && (
        <Notice tone="warning">
          No hostels yet. Add a hostel before setting stock.{' '}
          <button type="button" className="link-btn" onClick={onGoToHostels}>Go to hostels</button>
        </Notice>
      )}
      {data && hostels.length > 0 && products.length === 0 && (
        <div className="stock-manager__empty">
          <p><strong>No products yet.</strong> Add a product, then set its stock here.</p>
          <button type="button" className="btn btn--yellow btn--sm" onClick={onGoToProducts}>Go to products</button>
        </div>
      )}

      {data && hostels.length > 0 && products.length > 0 && (
        <>
          <div className="product-toolbar">
            <label className="product-toolbar__search">
              <SearchIcon width={16} height={16} />
              <input type="search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="product-toolbar__view">
              <span className="small muted">Show</span>
              <select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Filter products by availability">
                <option value="all">All products ({products.length})</option>
                <option value="live">Available somewhere</option>
                <option value="unavailable">Not available anywhere</option>
              </select>
            </label>
          </div>

          <div className="stock-list">
            {visible.map((product) => {
              const live = liveHostelCount(product, hostels);
              return (
                <article key={product.id} id={`stock-${product.id}`} className={`stock-card${product.id === focusProductId ? ' stock-card--focus' : ''}`}>
                  <header className="stock-card__head">
                    <img src={product.imageUrl} alt="" />
                    <div className="stock-card__title">
                      <h3>{product.name}</h3>
                      <p className="muted small">{product.unit} · {formatINR(product.price)}</p>
                    </div>
                    <span className={`inv-chip ${live > 0 ? 'inv-chip--live' : 'inv-chip--out'}`}>
                      {live > 0 ? `Live in ${live} of ${activeHostels}` : 'Not available'}
                    </span>
                  </header>
                  <ProductInventoryPanel product={product} hostels={hostels} onSaved={reload} onGoToHostels={onGoToHostels} />
                </article>
              );
            })}
            {visible.length === 0 && <p className="muted product-table__empty">No products match these filters.</p>}
          </div>
        </>
      )}
    </section>
  );
}
