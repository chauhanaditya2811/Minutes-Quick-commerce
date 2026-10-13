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
        floor: profile.floor === null ? '' : String(profile.floor),
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
      const floor = Number(form.floor);
      if (!Number.isSafeInteger(floor) || floor < 0) {
        setError('Floor must be a whole number greater than or equal to 0.');
        return;
      }
      const phone = form.phone.trim();
      if (!/^[6-9]\d{9}$/.test(phone)) {
        setError('Phone must be exactly 10 digits and start with 6-9.');
        return;
      }
      await saveProfile({
        name: form.name.trim(),
        phone,
        hostel: form.hostel.trim(),
        floor,
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
        <Field label="Floor" type="number" min={0} step={1} inputMode="numeric" value={form.floor} onChange={set('floor')} required placeholder="e.g. 2" />
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
