import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { previewMode } from '../../services/config';
import Field from '../ui/Field';
import Notice from '../ui/Notice';

interface Props {
  submitLabel: string;
  onSaved?: () => void;
}

/** Shared by the Account page and Checkout. Saves via PUT /api/users/me. */
export default function DeliveryDetailsForm({ submitLabel, onSaved }: Props) {
  const { profile, firebaseUser, saveProfile } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '', hostel: '', floor: '', room: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        hostel: profile.hostel ?? '',
        floor: profile.floor ?? '',
        room: profile.room ?? '',
      });
    }
  }, [profile]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveProfile({
        name: form.name.trim(),
        phone: form.phone.trim(),
        hostel: form.hostel.trim(),
        floor: form.floor.trim(),
        room: form.room.trim(),
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = previewMode && !firebaseUser;

  return (
    <form className="form" onSubmit={submit} noValidate={false}>
      {disabled && <Notice tone="info">Preview mode: sign-in and saving are disabled until the backend is connected.</Notice>}
      <Field label="Full name" value={form.name} onChange={set('name')} required autoComplete="name" />
      <Field label="Email address" value={profile?.email ?? firebaseUser?.email ?? ''} readOnly disabled hint="Email comes from your sign-in and can't be changed here." />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
      <Field label="Hostel" value={form.hostel} onChange={set('hostel')} required placeholder="e.g. Block C" />
      <div className="form__row">
        <Field label="Floor" value={form.floor} onChange={set('floor')} required placeholder="e.g. 2" />
        <Field label="Room" value={form.room} onChange={set('room')} required placeholder="e.g. 214" />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Details saved.</Notice>}
      <button type="submit" className="btn btn--blue" disabled={saving || disabled}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
