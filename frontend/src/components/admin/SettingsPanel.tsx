import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import { previewMode } from '../../services/config';
import { mockSettings } from '../../data/mockProducts';
import type { FeeTier, StoreSettings } from '../../types/product';
import { convenienceFeeFor, feeTiersOf, formatClock } from '../../utils/fees';
import { formatINR } from '../../utils/format';
import Field from '../ui/Field';
import Notice from '../ui/Notice';
import Loading from '../Loading';

const MAX_RANGES = 6;

/** One editable price range: typed text until saved. The first range always starts at ₹0. */
interface RangeDraft {
  from: string;
  fee: string;
}

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** Checks the ranges like the server does; returns the tiers or the first problem found. */
const toTiers = (ranges: RangeDraft[]): { tiers: FeeTier[] } | { error: string } => {
  const tiers: FeeTier[] = [];
  for (const [i, range] of ranges.entries()) {
    const from = i === 0 ? 0 : whole(range.from);
    const fee = whole(range.fee);
    if (from === null) return { error: `Range ${i + 1}: enter where it starts, in whole rupees.` };
    if (fee === null) return { error: `Range ${i + 1}: enter the fee in whole rupees (0 for no fee).` };
    if (i > 0 && from <= tiers[i - 1]!.minSubtotal) {
      return { error: `Range ${i + 1} must start above ₹${tiers[i - 1]!.minSubtotal}.` };
    }
    tiers.push({ minSubtotal: from, fee });
  }
  return { tiers };
};

/** A sample basket inside each range, for the preview: ₹45 → ₹10 · ₹75 → ₹15 · … */
const sampleAmounts = (tiers: FeeTier[]) =>
  tiers.map((tier, i) => {
    const next = tiers[i + 1]?.minSubtotal;
    if (next === undefined) return tier.minSubtotal + 15;
    return Math.max(tier.minSubtotal, next - 15);
  });

export default function SettingsPanel() {
  const [loading, setLoading] = useState(!previewMode);
  const [storeOpen, setStoreOpen] = useState(true);
  const [minimumOrder, setMinimumOrder] = useState('0');
  const [supportEmail, setSupportEmail] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [ranges, setRanges] = useState<RangeDraft[]>([{ from: '0', fee: '0' }]);
  const [lateOn, setLateOn] = useState(false);
  const [lateFee, setLateFee] = useState('5');
  const [lateStart, setLateStart] = useState('01:00');
  const [lateEnd, setLateEnd] = useState('06:00');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = (s: StoreSettings) => {
    setStoreOpen(s.storeOpen);
    setMinimumOrder(String(s.minimumOrder));
    setSupportEmail(s.supportEmail ?? '');
    setStorePhone(s.storePhone ?? '');
    setRanges(feeTiersOf(s).map((t) => ({ from: String(t.minSubtotal), fee: String(t.fee) })));
    setLateOn(Boolean(s.lateNightFeeEnabled));
    setLateFee(String(s.lateNightFee ?? 5));
    setLateStart(s.lateNightStart ?? '01:00');
    setLateEnd(s.lateNightEnd ?? '06:00');
  };

  useEffect(() => {
    if (previewMode) {
      load(mockSettings);
      return;
    }
    api
      .getAdminSettings()
      .then(load)
      .catch((e: unknown) => setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Could not load settings.' }))
      .finally(() => setLoading(false));
  }, []);

  const checked = useMemo(() => toTiers(ranges), [ranges]);
  const lateFeeValue = whole(lateFee);
  const lateError = lateOn
    ? lateFeeValue === null
      ? 'Enter the late-night fee in whole rupees.'
      : lateStart === lateEnd
        ? 'Late-night hours must start and end at different times.'
        : null
    : null;

  const preview = useMemo(() => {
    if ('error' in checked) return null;
    const parts = sampleAmounts(checked.tiers).map((amount) => `${formatINR(amount)} → ${formatINR(convenienceFeeFor(amount, checked.tiers))}`);
    if (lateOn && lateFeeValue !== null && lateFeeValue > 0 && lateStart !== lateEnd) {
      const amount = sampleAmounts(checked.tiers)[Math.min(1, checked.tiers.length - 1)]!;
      const fee = convenienceFeeFor(amount, checked.tiers);
      parts.push(`${formatINR(amount)} at ${formatClock(lateStart)} → ${formatINR(fee)} + ${formatINR(lateFeeValue)} = ${formatINR(fee + lateFeeValue)}`);
    }
    return parts.join('  ·  ');
  }, [checked, lateOn, lateFeeValue, lateStart, lateEnd]);

  const setRange = (index: number, key: keyof RangeDraft, value: string) =>
    setRanges((current) => current.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const addRange = () =>
    setRanges((current) => {
      const last = current[current.length - 1]!;
      const from = (whole(last.from) ?? 0) + (current.length === 1 ? 60 : 50);
      const fee = (whole(last.fee) ?? 0) + 5;
      return [...current, { from: String(from), fee: String(fee) }];
    });

  const removeRange = (index: number) => setRanges((current) => current.filter((_, i) => i !== index));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ('error' in checked) {
      setMsg({ tone: 'error', text: checked.error });
      return;
    }
    if (lateError) {
      setMsg({ tone: 'error', text: lateError });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.updateAdminSettings({
        storeOpen,
        minimumOrder: Number(minimumOrder),
        supportEmail: supportEmail.trim() || null,
        storePhone: storePhone.trim() || null,
        feeTiers: checked.tiers,
        lateNight: { enabled: lateOn, fee: lateFeeValue ?? 0, start: lateStart, end: lateEnd },
      });
      // Show values as saved (e.g. the phone normalised to +91… by the server).
      load(saved);
      setMsg({ tone: 'success', text: 'Settings saved. New orders use these fees right away.' });
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
      <Field
        label="Minimum order (₹)"
        type="number"
        min={0}
        step="1"
        value={minimumOrder}
        onChange={(e) => setMinimumOrder(e.target.value)}
        required
        hint="Item total needed before fees."
      />

      <section className="fee-editor" aria-labelledby="fee-title">
        <h3 id="fee-title">Convenience fee</h3>
        <p className="muted small">
          Added on top of item prices. Customers only see the fee for their own order, in the cart and at checkout.
        </p>
        <ol className="fee-editor__ranges">
          {ranges.map((range, i) => {
            const nextFrom = whole(ranges[i + 1]?.from ?? '');
            return (
              <li key={i} className="fee-range">
                <span className="fee-range__text">Orders from ₹</span>
                <input
                  className="fee-range__input"
                  inputMode="numeric"
                  aria-label={`Range ${i + 1} starts at (₹)`}
                  value={i === 0 ? '0' : range.from}
                  disabled={i === 0}
                  onChange={(e) => setRange(i, 'from', e.target.value)}
                />
                <span className="fee-range__text fee-range__to">
                  {i === ranges.length - 1 ? 'and above' : nextFrom !== null && nextFrom > 0 ? `to ₹${nextFrom - 1}` : 'to …'}
                </span>
                <span className="fee-range__text">→ fee ₹</span>
                <input
                  className="fee-range__input"
                  inputMode="numeric"
                  aria-label={`Range ${i + 1} fee (₹)`}
                  value={range.fee}
                  onChange={(e) => setRange(i, 'fee', e.target.value)}
                />
                {i > 0 ? (
                  <button type="button" className="link-btn link-btn--danger fee-range__remove" onClick={() => removeRange(i)} aria-label={`Remove range ${i + 1}`}>
                    Remove
                  </button>
                ) : (
                  <span className="fee-range__remove" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
        {ranges.length < MAX_RANGES && (
          <button type="button" className="btn btn--outline btn--sm fee-editor__add" onClick={addRange}>
            + Add higher price range
          </button>
        )}
      </section>

      <section className="fee-editor" aria-labelledby="late-title">
        <div className="fee-editor__head">
          <h3 id="late-title">Late-night fee</h3>
          <label className="switch">
            <input type="checkbox" checked={lateOn} onChange={(e) => setLateOn(e.target.checked)} />
            <span>{lateOn ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div className={`fee-range fee-range--late${lateOn ? '' : ' fee-range--off'}`}>
          <span className="fee-range__text">Extra ₹</span>
          <input className="fee-range__input" inputMode="numeric" aria-label="Late-night fee (₹)" value={lateFee} disabled={!lateOn} onChange={(e) => setLateFee(e.target.value)} />
          <span className="fee-range__text">on orders placed between</span>
          <input className="fee-range__time" type="time" aria-label="Late-night hours start" value={lateStart} disabled={!lateOn} onChange={(e) => setLateStart(e.target.value)} />
          <span className="fee-range__text">and</span>
          <input className="fee-range__time" type="time" aria-label="Late-night hours end" value={lateEnd} disabled={!lateOn} onChange={(e) => setLateEnd(e.target.value)} />
        </div>
        <p className="muted small">India time. The hours can cross midnight, e.g. 23:00 to 05:00.</p>
      </section>

      {'error' in checked ? (
        <Notice tone="warning">{checked.error}</Notice>
      ) : (
        preview && (
          <p className="fee-preview">
            <span className="fee-preview__label">Preview</span>
            {preview}
          </p>
        )
      )}
      {lateError && <Notice tone="warning">{lateError}</Notice>}

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
