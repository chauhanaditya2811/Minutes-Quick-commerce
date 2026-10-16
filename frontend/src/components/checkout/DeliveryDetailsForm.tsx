import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { previewMode } from '../../services/config';
import Field from '../ui/Field';
import Notice from '../ui/Notice';
import SelectField from '../ui/SelectField';
import { api, type Hostel } from '../../services/api';

interface Props {
  submitLabel: string;
  onSaved?: () => void;
}

/** Shared by the Account page and Checkout. Saves via PUT /api/users/me. */
export default function DeliveryDetailsForm({ submitLabel, onSaved }: Props) {
  const { profile, firebaseUser, saveProfile } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '', hostelId: '', floor: '', room: '' });
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [hostelsLoading, setHostelsLoading] = useState(true);
  const [hostelsError, setHostelsError] = useState<string | null>(null);
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
    api.getHostels().then(setHostels).catch((e: unknown) =>
      setHostelsError(e instanceof Error ? e.message : 'Could not load hostels.'),
    ).finally(() => setHostelsLoading(false));
  }, []);

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
        hostelId: form.hostelId,
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
  const selectedHostelMissing = Boolean(profile?.hostelId && !hostels.some((hostel) => hostel.id === profile.hostelId));
  const hostelSelectionChanged = form.hostelId !== (profile?.hostelId ?? '');

  return (
    <form className="form" onSubmit={submit} noValidate={false}>
      {disabled && <Notice tone="info">Preview mode: sign-in and saving are disabled until the backend is connected.</Notice>}
      <Field label="Full name" value={form.name} onChange={set('name')} required autoComplete="name" />
      <Field label="Email address" value={profile?.email ?? firebaseUser?.email ?? ''} readOnly disabled hint="Email comes from your sign-in and can't be changed here." />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
      {hostelsLoading ? <p className="field__hint">Loading available hostels…</p> : hostelsError ? <Notice tone="error">{hostelsError}</Notice> : hostels.length === 0 ? <Notice tone="warning">No hostels are available yet. Please contact the store administrator.</Notice> : (
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
      <button type="submit" className="btn btn--blue" disabled={saving || disabled || hostelsLoading || Boolean(hostelsError) || hostels.length === 0}>
        {saving ? 'Saving…' : hostelSelectionChanged ? 'Save updated details' : submitLabel}
      </button>
    </form>
  );
}
