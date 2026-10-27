const SUPPORT_PHONE = '9872808122';
const CLOSED_DELIVERY_CHARGE = 30;

/** Shown in place of the plain closed notice while the existing `storeOpen` setting is false. */
export default function StoreClosedBanner() {
  return (
    <section className="store-closed" role="status" aria-live="polite">
      <div className="store-closed__icon" aria-hidden="true">🌙</div>
      <h2 className="store-closed__title">Store’s Closed for Now</h2>
      <p className="store-closed__subtitle">Need something urgently? We’ve got you.</p>
      <p className="store-closed__text">
        Our store is currently closed, but we understand that some essentials just can’t wait. Give us a call at{' '}
        <strong>{SUPPORT_PHONE}</strong> and we’ll help you with your urgent needs.
      </p>
      <p className="store-closed__charge">
        Just a heads-up: a <strong>₹{CLOSED_DELIVERY_CHARGE} delivery charge</strong> applies to orders placed while the store is closed.
      </p>
      <a className="btn store-closed__call" href={`tel:${SUPPORT_PHONE}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" />
        </svg>
        Call Now
      </a>
      <p className="store-closed__tagline">Minutes — Your essentials, even when the clock says otherwise.</p>
    </section>
  );
}
