import { useState } from 'react';
import { useProducts } from '../../hooks/useProducts';
import { api } from '../../services/api';
import { previewMode } from '../../services/config';
import { formatINR } from '../../utils/format';
import type { Product } from '../../types/product';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import ProductForm from './ProductForm';

export default function ProductManager() {
  const { data, loading, error, reload } = useProducts();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const remove = async (p: Product) => {
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
        onSaved={() => {
          setEditing(null);
          setMessage('Product saved.');
          reload();
        }}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Products</h2>
        <button type="button" className="btn btn--yellow btn--sm" onClick={() => setEditing('new')} disabled={previewMode}>Add product</button>
      </div>
      {previewMode && <Notice tone="info">Preview mode: editing is disabled until the backend is connected.</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {loading && <Loading />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id}>
                <td><span className="table__name"><img src={p.imageUrl} alt="" />{p.name}<small>{p.unit}</small></span></td>
                <td>{formatINR(p.price)}</td>
                <td>{p.stock > 0 ? p.stock : <span className="stock stock--out">Out of stock</span>}</td>
                <td className="table__actions">
                  <button type="button" className="link-btn" disabled={previewMode} onClick={() => setEditing(p)}>Edit</button>
                  <button type="button" className="link-btn link-btn--danger" disabled={previewMode} onClick={() => void remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
