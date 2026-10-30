import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { previewMode } from '../../services/config';
import Field from '../ui/Field';
import { BLOCK_FLOOR_MAX_LENGTH, BLOCK_FLOOR_MESSAGE, parseBlockFloor } from '../../utils/blockFloor';
import Notice from '../ui/Notice';
import HostelSelect from './HostelSelect';
import type { Pool } from '../../services/api';
import { useHostel } from '../../context/HostelContext';

interface Props {
  submitLabel: string;
  onSaved?: () => void;
  /**
   * Checkout passes the pool being shopped in: the delivery hostel must be one of its hostels,
   * since the cart holds that pool's stock. The Account page passes nothing (any hostel).
   */
  pool?: Pool | null;
}

// Natural order, so "BH-2" comes before "BH-10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Shared by the Account page and Checkout. Saves via PUT /api/users/me. */
export default function DeliveryDetailsForm({ submitLabel, onSaved, pool }: Props) {
  const { profile, firebaseUser, saveProfile } = useAuth();
  const { pools, poolsLoading: hostelsLoading, poolsError: hostelsError, openPicker } = useHostel();
  // At checkout: the pool's hostels. On the Account page: every open hostel.
  const hostels = useMemo(
    () => [...(pool ? pool.hostels : pools.flatMap((p) => p.hostels))].sort((a, b) => byName.compare(a.name, b.name)),
    [pool, pools],
  );
  const onlyHostel = pool && pool.hostels.length === 1 ? pool.hostels[0] : null;
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
        floor: profile.floor ?? '',
        room: profile.room ?? '',
      });
    }
  }, [profile]);

  // At checkout, keep the saved hostel only if it's in this pool; a pool with one hostel fills it in.
  useEffect(() => {
    if (!pool) return;
    setForm((f) => {
      const inPool = pool.hostels.some((h) => h.id === f.hostelId);
      const hostelId = onlyHostel ? onlyHostel.id : inPool ? f.hostelId : '';
      return hostelId === f.hostelId ? f : { ...f, hostelId };
    });
  }, [pool, onlyHostel, profile]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const floor = parseBlockFloor(form.floor);
      if (floor === null) {
        setError(BLOCK_FLOOR_MESSAGE);
        return;
      }
      if (!onlyHostel && !form.hostelId) {
        setError('Choose your hostel.');
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
        hostelId: onlyHostel?.id ?? form.hostelId,
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
    !pool && profile?.hostelId && !hostelsLoading && !hostelsError && !hostels.some((hostel) => hostel.id === profile.hostelId),
  );
  const hostelSelectionChanged = form.hostelId !== (profile?.hostelId ?? '');

  return (
    <form className="form" onSubmit={submit} noValidate={false}>
      {disabled && <Notice tone="info">Preview mode: sign-in and saving are disabled until the backend is connected.</Notice>}
      <Field label="Full name" value={form.name} onChange={set('name')} required autoComplete="name" />
      <Field label="Email address" value={profile?.email ?? firebaseUser?.email ?? ''} readOnly disabled hint="Email comes from your sign-in and can't be changed here." />
      <Field label="Phone number" value={form.phone} onChange={set('phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
      {onlyHostel ? (
        <div className="field">
          <span className="field__label">Hostel</span>
          <div className="locked-hostel">
            <strong>{onlyHostel.name}</strong>
            <button type="button" className="link-btn" onClick={openPicker}>Change</button>
          </div>
          <p className="field__hint">Your order is delivered to the hostel you’re shopping for.</p>
        </div>
      ) : hostelsLoading && !pool ? <p className="field__hint">Loading available hostels…</p> : hostelsError && !pool ? <Notice tone="error">{hostelsError}</Notice> : hostels.length === 0 ? <Notice tone="warning">No hostels are available yet. Please contact the store administrator.</Notice> : (
        <HostelSelect
          label={pool ? 'Your hostel' : 'Hostel'}
          hostels={hostels}
          value={form.hostelId}
          onChange={(hostelId) => {
            setSaved(false);
            setForm((f) => ({ ...f, hostelId }));
          }}
          disabled={disabled}
          hint={pool && <>Hostels in {pool.name}. Not here? <button type="button" className="link-btn" onClick={openPicker}>Change where you live</button></>}
        />
      )}
      {selectedHostelMissing && (
        <Notice tone="warning">
          {hostelSelectionChanged
            ? 'Your saved hostel is no longer available. Click “Save updated details” to use your newly selected hostel.'
            : 'Your saved hostel is no longer available. Please select a new one.'}
        </Notice>
      )}
      <div className="form__row">
        <Field label="Block/Floor" autoCapitalize="characters" autoComplete="off" maxLength={BLOCK_FLOOR_MAX_LENGTH} value={form.floor} onChange={set('floor')} required placeholder="e.g. A/2" />
        <Field label="Room" value={form.room} onChange={set('room')} required placeholder="e.g. 214" />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Details saved.</Notice>}
      <button type="submit" className="btn btn--blue" disabled={saving || disabled || (!pool && (hostelsLoading || Boolean(hostelsError) || hostels.length === 0))}>
        {saving ? 'Saving…' : hostelSelectionChanged ? 'Save updated details' : submitLabel}
      </button>
    </form>
  );
}
