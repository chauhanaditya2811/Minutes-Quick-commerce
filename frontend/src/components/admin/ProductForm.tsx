import { useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import type { ProductInput } from '../../types/product';
import Field from '../ui/Field';
import Notice from '../ui/Notice';

/** The catalogue fields the form edits. Stock is managed per hostel, not here. */
export interface EditableProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  description: string | null;
  imageUrl: string;
}

interface Props {
  product: EditableProduct | null; // null = add
  onSaved: (saved: { id: string }, created: boolean) => void;
  onCancel: () => void;
}

export default function ProductForm({ product, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    price: product ? String(product.price) : '',
    unit: product?.unit ?? '',
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
    if (!Number.isSafeInteger(price) || price < 0 || price > 2_147_483_647) {
      setError('Price must be a whole number between 0 and 2,147,483,647.');
      return;
    }
    const body: ProductInput = {
      name: form.name.trim(),
      price,
      unit: form.unit.trim(),
      description: form.description.trim() || null,
      imageUrl: form.imageUrl.trim(),
    };
    if (!body.imageUrl) return setError('Upload a product image first.');
    setBusy(true);
    setError(null);
    try {
      const saved = product ? await api.updateProduct(product.id, body) : await api.createProduct(body);
      onSaved(saved, !product);
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
      <Notice tone="info">
        Stock is managed per hostel. {product ? 'Use “Manage stock” in the product list.' : 'After saving, set availability and quantity for each hostel.'}
      </Notice>
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
