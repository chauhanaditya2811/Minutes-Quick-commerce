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
        <a className="btn call-store__btn" href={`tel:${phone}`} aria-describedby={helpId}>
          <PhoneIcon /> Call Store
        </a>
      ) : (
        <button type="button" className="btn call-store__btn" disabled aria-describedby={helpId}>
          <PhoneIcon /> Call Store
        </button>
      )}
      {/* Announced when the button unlocks at 00:00. */}
      <p id={helpId} className="call-store__help" aria-live="polite">{help}</p>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1z" fill="currentColor" />
    </svg>
  );
}
