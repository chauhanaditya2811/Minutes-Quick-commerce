import { useMemo, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import { api, type AdminHostel } from '../../services/api';
import { previewMode } from '../../services/config';
import { formatINR } from '../../utils/format';
import type { AdminProduct } from '../../types/product';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import { SearchIcon } from '../ui/Icons';
import ProductForm from './ProductForm';
import { loadAdminCatalogue, type AdminCatalogue } from './adminCatalogue';

function AvailabilityCell({ product, hostels, view }: { product: AdminProduct; hostels: AdminHostel[]; view: string }) {
  if (view !== 'all') {
    const row = product.inventories.find((inv) => inv.hostelId === view);
    if (!row?.isAvailable) return <span className="inv-chip inv-chip--hidden">Unavailable</span>;
    if (row.quantity === 0) return <span className="inv-chip inv-chip--out">Out of stock</span>;
    return <span className="inv-summary"><strong>{row.quantity}</strong> units</span>;
  }

  const activeIds = new Set(hostels.filter((h) => h.isActive).map((h) => h.id));
  const live = product.inventories.filter((inv) => inv.isAvailable && activeIds.has(inv.hostelId));
  const units = live.reduce((sum, inv) => sum + inv.quantity, 0);
  if (live.length === 0) return <span className="inv-chip inv-chip--out">Not available</span>;
  return (
    <span className="inv-summary">
      <span>Live in <strong>{live.length}</strong> of {activeIds.size}</span>
      <small className="muted">{units} units</small>
    </span>
  );
}

interface Props {
  onGoToHostels?: () => void;
  /** Opens the hostel-first Stock management tab. */
  onManageStock: () => void;
}

export default function ProductManager({ onGoToHostels, onManageStock }: Props) {
  const { data, loading, error, reload } = useAsync<AdminCatalogue>(loadAdminCatalogue, []);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');

  const products = data?.products ?? [];
  const hostels = data?.hostels ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, query]);

  const remove = async (p: AdminProduct) => {
    if (!window.confirm(`Delete "${p.name}"? It will be hidden from the shop.`)) return;
    try {
      await api.deleteProduct(p.id);
      setMessage(`${p.name} deleted.`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not delete the product.');
    }
  };

  if (editing) {
    return (
      <ProductForm
        product={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={(_saved, created) => {
          setEditing(null);
          // A new product is unavailable at every hostel until its stock is set.
          setMessage(created ? 'Product added. It isn’t available at any hostel yet: set its stock in Stock management.' : 'Product saved.');
          reload();
        }}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Products</h2>
        <span className="panel__actions">
          <button type="button" className="btn btn--outline btn--sm panel__action" onClick={onManageStock}>Stock management</button>
          <button type="button" className="btn btn--yellow btn--sm" onClick={() => setEditing('new')} disabled={previewMode}>Add product</button>
        </span>
      </div>
      {previewMode && <Notice tone="info">Preview mode: editing is disabled until the backend is connected.</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {data && hostels.length === 0 && (
        <Notice tone="warning">
          No hostels yet. Products can’t be shown to customers until you add a hostel and set stock.{' '}
          {onGoToHostels && <button type="button" className="link-btn" onClick={onGoToHostels}>Add a hostel</button>}
        </Notice>
      )}

      {data && products.length > 0 && (
        <div className="product-toolbar">
          <label className="product-toolbar__search">
            <SearchIcon width={16} height={16} />
            <input type="search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {hostels.length > 0 && (
            <label className="product-toolbar__view">
              <span className="small muted">Stock view</span>
              <select value={view} onChange={(e) => setView(e.target.value)} aria-label="Stock view">
                <option value="all">All hostels</option>
                {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}{h.isActive ? '' : ' (inactive)'}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {loading && !data && <Loading />}
      <div className="table-wrap product-table-wrap">
        <table className="table product-table">
          <thead><tr><th>Product</th><th>Price</th><th>Availability</th><th>Actions</th></tr></thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td data-label="Product"><span className="table__name"><img src={p.imageUrl} alt="" /><span className="table__name-copy"><span>{p.name}</span><small>{p.unit}</small></span></span></td>
                <td data-label="Price">{formatINR(p.price)}</td>
                <td data-label="Availability"><AvailabilityCell product={p} hostels={hostels} view={view} /></td>
                <td className="table__actions" data-label="Actions">
                  <span className="product-table__action-links">
                    <button type="button" className="link-btn" disabled={previewMode} onClick={() => setEditing(p)}>Edit</button>
                    <button type="button" className="link-btn link-btn--danger" disabled={previewMode} onClick={() => void remove(p)}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && products.length === 0 && <p className="muted product-table__empty">No products yet. Add your first product to start selling.</p>}
        {data && products.length > 0 && visible.length === 0 && <p className="muted product-table__empty">No products match “{query}”.</p>}
      </div>
    </section>
  );
}
