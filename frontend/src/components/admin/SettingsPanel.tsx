import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import { previewMode } from '../../services/config';
import Field from '../ui/Field';
import Notice from '../ui/Notice';
import Loading from '../Loading';

export default function SettingsPanel() {
  const [loading, setLoading] = useState(!previewMode);
  const [storeOpen, setStoreOpen] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [minimumOrder, setMinimumOrder] = useState('0');
  const [supportEmail, setSupportEmail] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (previewMode) return;
    api
      .getAdminSettings()
      .then((s) => {
        setStoreOpen(s.storeOpen);
        setDeliveryFee(String(s.deliveryFee));
        setMinimumOrder(String(s.minimumOrder));
        setSupportEmail(s.supportEmail ?? '');
        setStorePhone(s.storePhone ?? '');
      })
      .catch((e: unknown) => setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Could not load settings.' }))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.updateAdminSettings({
        storeOpen,
        deliveryFee: Number(deliveryFee),
        minimumOrder: Number(minimumOrder),
        supportEmail: supportEmail.trim() || null,
        storePhone: storePhone.trim() || null,
      });
      // Show the number as saved (normalised to +91… form by the server).
      setStorePhone(saved.storePhone ?? '');
      setMsg({ tone: 'success', text: 'Settings saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save settings.' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <form className="form panel" onSubmit={submit}>
      <h2>Store settings</h2>
      {previewMode && <Notice tone="info">Preview mode: saving is disabled until the backend is connected.</Notice>}
      <label className="switch">
        <input type="checkbox" checked={storeOpen} onChange={(e) => setStoreOpen(e.target.checked)} />
        <span>Store is {storeOpen ? 'open' : 'closed'}</span>
      </label>
      <div className="form__row">
        <Field label="Delivery fee (₹)" type="number" min={0} step="1" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} required />
        <Field label="Minimum order (₹)" type="number" min={0} step="1" value={minimumOrder} onChange={(e) => setMinimumOrder(e.target.value)} required />
      </div>
      <Field label="Support email" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
      <Field
        label="Store phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="e.g. 98728 08122"
        value={storePhone}
        onChange={(e) => setStorePhone(e.target.value)}
        hint="Customers can tap “Call Store” on their order confirmation once the 10-minute delivery timer ends. Indian numbers are saved as +91…; leave empty to hide the call option."
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="form__actions">
        <button type="submit" className="btn btn--blue" disabled={busy || previewMode}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  );
}
