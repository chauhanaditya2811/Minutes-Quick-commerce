import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { previewMode } from '../../services/config';
import Field from '../ui/Field';
import Notice from '../ui/Notice';
import SelectField from '../ui/SelectField';
import type { Hostel } from '../../services/api';
import { useHostel } from '../../context/HostelContext';

interface Props {
  submitLabel: string;
  onSaved?: () => void;
  /** Checkout passes the store hostel: delivery must go to the hostel whose stock is in the cart. */
  lockedHostel?: Hostel | null;
}

/** Shared by the Account page and Checkout. Saves via PUT /api/users/me. */
export default function DeliveryDetailsForm({ submitLabel, onSaved, lockedHostel }: Props) {
  const { profile, firebaseUser, saveProfile } = useAuth();
  const { hostels, hostelsLoading, hostelsError, openPicker } = useHostel();
  const [form, setForm] = useState({ name: '', phone: '', hostelId: '', floor: '', room: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        hostelId: profile.hostelId ?? '',
        floor: profile.floor === null ? '' : String(profile.floor),
        room: profile.room ?? '',
      });
    }
  }, [profile]);

  useEffect(() => {
    if (lockedHostel) setForm((f) => ({ ...f, hostelId: lockedHostel.id }));
  }, [lockedHostel, profile]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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
        hostelId: lockedHostel?.id ?? form.hostelId,
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
  const selectedHostelMissing = Boolean(
    !lockedHostel && profile?.hostelId && !hostelsLoading && !hostelsError && !hostels.some((hostel) => hostel.id === profile.hostelId),
  );
  const hostelSelectionChanged = form.hostelId !== (profile?.hostelId ?? '');

  return (
    <form className="form" onSubmit={submit} noValidate={false}>
      {disabled && <Notice tone="info">Preview mode: sign-in and saving are disabled until the backend is connected.</Notice>}
      <Field label="Full name" value={form.name} onChange={set('name')} required autoComplete="name" />
      <Field label="Email address" value={profile?.email ?? firebaseUser?.email ?? ''} readOnly disabled hint="Email comes from your sign-in and can't be changed here." />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
      {lockedHostel ? (
        <div className="field">
          <span className="field__label">Hostel</span>
          <div className="locked-hostel">
            <strong>{lockedHostel.name}</strong>
            <button type="button" className="link-btn" onClick={openPicker}>Change</button>
          </div>
          <p className="field__hint">Your order is delivered to the hostel you’re shopping at.</p>
        </div>
      ) : hostelsLoading ? <p className="field__hint">Loading available hostels…</p> : hostelsError ? <Notice tone="error">{hostelsError}</Notice> : hostels.length === 0 ? <Notice tone="warning">No hostels are available yet. Please contact the store administrator.</Notice> : (
        <SelectField label="Hostel" value={form.hostelId} onChange={set('hostelId')} required disabled={disabled}>
          <option value="">Select your hostel</option>
          {hostels.map((hostel) => <option key={hostel.id} value={hostel.id}>{hostel.name}</option>)}
        </SelectField>
      )}
      {selectedHostelMissing && (
        <Notice tone="warning">
          {hostelSelectionChanged
            ? 'Your saved hostel is no longer available. Click “Save updated details” to use your newly selected hostel.'
            : 'Your saved hostel is no longer available. Please select a new one.'}
        </Notice>
      )}
      <div className="form__row">
        <Field label="Floor" type="number" min={0} step={1} inputMode="numeric" value={form.floor} onChange={set('floor')} required placeholder="e.g. 2" />
        <Field label="Room" value={form.room} onChange={set('room')} required placeholder="e.g. 214" />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Details saved.</Notice>}
      <button type="submit" className="btn btn--blue" disabled={saving || disabled || (!lockedHostel && (hostelsLoading || Boolean(hostelsError) || hostels.length === 0))}>
        {saving ? 'Saving…' : hostelSelectionChanged ? 'Save updated details' : submitLabel}
      </button>
    </form>
  );
}
