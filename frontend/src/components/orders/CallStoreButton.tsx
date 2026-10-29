import { useId } from 'react';

/** E.164, as saved by Store Settings (e.g. +919876543210). */
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

interface Props {
  /** True once the delivery countdown has reached 00:00. */
  ready: boolean;
  storePhone: string | null | undefined;
}

/**
 * "Call Store" is visible from the start but stays a disabled button (no tel: link, so clicks,
 * keyboard activation and dialler navigation are all impossible) until the countdown ends.
 * Then the same button becomes a tel: link to the store number from Store Settings.
 */
export default function CallStoreButton({ ready, storePhone }: Props) {
  const helpId = useId();
  const phone = storePhone && PHONE_PATTERN.test(storePhone) ? storePhone : null;
  const canCall = ready && phone !== null;

  const help = !ready
    ? 'You can contact the store when the timer reaches zero.'
    : phone
      ? 'Need assistance? You can now contact the store.'
      : 'The store’s phone number isn’t available right now. Please message us on WhatsApp instead.';

  return (
    <div className="call-store">
      {canCall ? (
        <a className="btn btn--lg call-store__btn" href={`tel:${phone}`} aria-describedby={helpId}>
          <span aria-hidden="true">📞</span> Call Store
        </a>
      ) : (
        <button type="button" className="btn btn--lg call-store__btn" disabled aria-describedby={helpId}>
          <span aria-hidden="true">📞</span> Call Store
        </button>
      )}
      {/* Announced when the button unlocks at 00:00. */}
      <p id={helpId} className="call-store__help small" aria-live="polite">{help}</p>
    </div>
  );
}
