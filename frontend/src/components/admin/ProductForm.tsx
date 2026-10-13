import { useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import type { Product, ProductInput } from '../../types/product';
import Field from '../ui/Field';
import Notice from '../ui/Notice';

interface Props {
  product: Product | null; // null = add
  onSaved: () => void;
  onCancel: () => void;
}

export default function ProductForm({ product, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    price: product ? String(product.price) : '',
    unit: product?.unit ?? '',
    stock: product ? String(product.stock) : '0',
    description: product?.description ?? '',
    imageUrl: product?.imageUrl ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await api.uploadProductImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!Number.isSafeInteger(price) || price < 0 || price > 2_147_483_647) {
      setError('Price must be a whole number between 0 and 2,147,483,647.');
      return;
    }
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 2_147_483_647) {
      setError('Stock must be a whole number between 0 and 2,147,483,647.');
      return;
    }
    const body: ProductInput = {
      name: form.name.trim(),
      price,
      unit: form.unit.trim(),
      stock,
      description: form.description.trim() || null,
      imageUrl: form.imageUrl.trim(),
    };
    if (!body.imageUrl) return setError('Upload a product image first.');
    setBusy(true);
    setError(null);
    try {
      if (product) await api.updateProduct(product.id, body);
      else await api.createProduct(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form panel" onSubmit={submit}>
      <h3>{product ? `Edit ${product.name}` : 'Add a product'}</h3>
      <Field label="Name" value={form.name} onChange={set('name')} required />
      <div className="form__row">
        <Field label="Price (₹)" type="number" min={0} step="1" inputMode="numeric" value={form.price} onChange={set('price')} required />
        <Field label="Unit" value={form.unit} onChange={set('unit')} required placeholder="e.g. 500 ml" />
      </div>
      <Field label="Stock" type="number" min={0} step="1" value={form.stock} onChange={set('stock')} required hint="Set to 0 to mark the product out of stock. Stock is managed manually." />
      <div className="field">
        <label htmlFor="desc">Description</label>
        <textarea id="desc" rows={3} value={form.description} onChange={set('description')} />
      </div>
      <div className="field">
        <label htmlFor="img">Image</label>
        <input id="img" type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} />
        {uploading && <p className="field__hint">Uploading…</p>}
        {form.imageUrl && <img className="thumb" src={form.imageUrl} alt="Product preview" />}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form__actions">
        <button type="submit" className="btn btn--blue" disabled={busy || uploading}>{busy ? 'Saving…' : 'Save product'}</button>
        <button type="button" className="btn btn--outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
