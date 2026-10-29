import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { ApiError, api } from '../../services/api';
import { previewMode } from '../../services/config';
import { openCashfree } from '../../services/cashfree';
import {
  loadGuestDetails,
  loadPendingCheckout,
  newCheckoutToken,
  rememberGuestOrder,
  saveGuestDetails,
  savePendingCheckout,
  type PendingGuestCheckout,
} from '../../services/guestCheckout';
import type { GuestCustomerInput, ValidateOrderResponse } from '../../types/order';
import { BLOCK_FLOOR_MAX_LENGTH, BLOCK_FLOOR_MESSAGE, deliveryAddress, parseBlockFloor } from '../../utils/blockFloor';
import { formatINR } from '../../utils/format';
import OrderSummaryPanel from './OrderSummary';
import Field from '../ui/Field';
import Notice from '../ui/Notice';

type DetailsForm = Record<keyof GuestCustomerInput, string>;
type Errors = Partial<Record<keyof GuestCustomerInput, string>>;

const PHONE_PATTERN = /^[6-9]\d{9}$/;

// Mirrors the server's rules so mistakes show before a request; the server re-validates everything.
function parseDetails(form: DetailsForm): { customer: GuestCustomerInput | null; errors: Errors } {
  const errors: Errors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  const phone = form.phone.replace(/\s+/g, '');
  const room = form.room.trim();
  const floor = parseBlockFloor(form.floor);
  if (name.length < 2 || name.length > 80) errors.name = 'Enter your full name (2 to 80 characters).';
  if (!PHONE_PATTERN.test(phone)) errors.phone = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.';
  if (floor === null) errors.floor = BLOCK_FLOOR_MESSAGE;
  if (!room || room.length > 20) errors.room = 'Enter your room number (up to 20 characters).';
  return floor === null || Object.keys(errors).length ? { customer: null, errors } : { customer: { name, phone, floor, room }, errors };
}

/** Checkout without an account: delivery details, a server-priced review, then Cashfree. */
export default function GuestCheckout() {
  const { lines } = useCart();
  const { selectedHostel, openPicker } = useHostel();
  const { data: settings } = useStoreSettings();
  const navigate = useNavigate();

  const [form, setForm] = useState<DetailsForm>(() => {
    const saved = loadGuestDetails();
    return { name: saved?.name ?? '', phone: saved?.phone ?? '', floor: saved?.floor ?? '', room: saved?.room ?? '' };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [review, setReview] = useState<ValidateOrderResponse['checkout'] | null>(null);
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false); // blocks double submissions before React re-renders
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);

  const hostelId = selectedHostel?.id ?? '';
  const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity }));
  const itemsKey = JSON.stringify(items);
  const storeClosed = settings ? !settings.storeOpen : false;

  // A changed cart or hostel needs fresh server prices before paying.
  useEffect(() => {
    setReview(null);
  }, [itemsKey, hostelId]);

  const set = (key: keyof DetailsForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setReview(null);
  };

  const toReview = async (e: FormEvent) => {
    e.preventDefault();
    const { customer, errors: found } = parseDetails(form);
    setErrors(found);
    if (!customer) return;
    saveGuestDetails(form);
    setChecking(true);
    setMessage(null);
    try {
      const response = await api.validateGuestOrder({ hostelId, items, customer });
      setReview(response.checkout);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not check your order.' });
    } finally {
      setChecking(false);
    }
  };

  const pay = async () => {
    const { customer } = parseDetails(form);
    if (payingRef.current || !review || !customer) return;
    payingRef.current = true;
    setPaying(true);
    setMessage(null);

    const cartKey = JSON.stringify({ hostelId, items, customer });
    let pending: PendingGuestCheckout | null = loadPendingCheckout();
    try {
      // Reuse this tab's unpaid order for the same cart, so retries never place a second one.
      if (!pending || pending.cartKey !== cartKey) {
        const token = newCheckoutToken();
        const order = await api.createGuestOrder({
          hostelId,
          items,
          customer,
          checkoutToken: token,
          ...(pending ? { replacesOrder: { orderId: pending.orderId, checkoutToken: pending.token } } : {}),
        });
        pending = { cartKey, orderId: order.id, orderNumber: order.orderNumber, token };
        savePendingCheckout(pending);
        rememberGuestOrder({ orderId: order.id, token, orderNumber: order.orderNumber });
        if (order.orderStatus !== 'PENDING_PAYMENT') {
          navigate(`/guest-orders/${order.id}`);
          return;
        }
      }

      let init;
      try {
        init = await api.initGuestPayment(pending.orderId, pending.token);
      } catch (err) {
        // The held stock lapsed and is gone, or the order can no longer be paid: start again.
        if (err instanceof ApiError && err.status === 409) {
          savePendingCheckout(null);
          setReview(null);
        }
        throw err;
      }
      pending = { ...pending, cashfreeOrderId: init.cashfreeOrderId };
      savePendingCheckout(pending);
      rememberGuestOrder({ orderId: pending.orderId, token: pending.token, orderNumber: pending.orderNumber, cashfreeOrderId: init.cashfreeOrderId });

      const holdNote = init.holdExpiresAt
        ? ` Your items are held until ${new Date(init.holdExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : '';
      const outcome = await openCashfree(init);
      if (outcome.status === 'dismissed') {
        setMessage({ tone: 'warning', text: `Payment was not completed.${holdNote} You can try again; you won’t be charged twice.` });
        return;
      }
      if (outcome.status === 'failed') {
        setMessage({ tone: 'error', text: `${outcome.message}${holdNote}` });
        return;
      }
      // Cashfree reported success in the browser; the order page confirms it with the server
      // (and the webhook does too), so only a verified payment ever shows as confirmed.
      navigate(`/guest-orders/${pending.orderId}`, { replace: true });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong while paying.' });
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  };

  const priceChanged = review?.items.some((item) => lines.find((l) => l.product.id === item.productId)?.product.price !== item.price);

  return (
    <div className="page">
      <h1>Checkout</h1>
      <div className="checkout">
        <section className="panel guest-checkout" aria-labelledby="guest-h">
          <div className="guest-checkout__intro">
            <h2 id="guest-h">Checkout as a guest</h2>
            <p className="muted">No account needed: tell us where to deliver and pay online.</p>
            <p className="small guest-checkout__login">
              Have an account? <Link to="/login" state={{ from: '/checkout' }}>Log in</Link> to use your saved details.
            </p>
          </div>

          <ol className="guest-steps" aria-label="Checkout steps">
            <li className={review ? 'guest-steps__done' : 'guest-steps__on'}>Delivery details</li>
            <li className={review ? 'guest-steps__on' : ''}>Review &amp; pay</li>
          </ol>

          {previewMode && <Notice tone="info">Preview mode: checkout is disabled until the backend is connected.</Notice>}
          {storeClosed && <Notice tone="warning">The store is closed right now.</Notice>}

          {!review ? (
            <form className="form" onSubmit={toReview} noValidate>
              <Field label="Full name" value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} aria-invalid={!!errors.name} hint={errors.name && <span className="field__error">{errors.name}</span>} />
              <Field
                label="Phone number"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={form.phone}
                onChange={set('phone')}
                aria-invalid={!!errors.phone}
                hint={errors.phone ? <span className="field__error">{errors.phone}</span> : 'We’ll call this number if we can’t find your room.'}
              />
              <div className="field">
                <span className="field__label">Hostel</span>
                <div className="locked-hostel">
                  <strong>{selectedHostel?.name}</strong>
                  <button type="button" className="link-btn" onClick={openPicker}>Change</button>
                </div>
              </div>
              <div className="form__row">
                <Field label="Block/Floor" autoCapitalize="characters" autoComplete="off" maxLength={BLOCK_FLOOR_MAX_LENGTH} placeholder="e.g. A/2" value={form.floor} onChange={set('floor')} aria-invalid={!!errors.floor} hint={errors.floor && <span className="field__error">{errors.floor}</span>} />
                <Field label="Room" placeholder="e.g. 214" maxLength={20} value={form.room} onChange={set('room')} aria-invalid={!!errors.room} hint={errors.room && <span className="field__error">{errors.room}</span>} />
              </div>
              {message && <Notice tone={message.tone}>{message.text}</Notice>}
              <button type="submit" className="btn btn--yellow btn--block btn--lg" disabled={checking || storeClosed || previewMode || lines.length === 0}>
                {checking ? 'Checking your order…' : 'Review order'}
              </button>
            </form>
          ) : (
            <div className="guest-review">
              <div className="guest-review__address">
                <div>
                  <span className="muted small">Delivering to</span>
                  <strong>{review.customer.name}</strong>
                  <span>{deliveryAddress(review.customer.hostel, review.customer.floor, review.customer.room)}</span>
                  <span className="muted small">{review.customer.phone}</span>
                </div>
                <button type="button" className="btn btn--outline btn--sm guest-review__edit" onClick={() => setReview(null)} disabled={paying}>Edit</button>
              </div>
              {priceChanged && <Notice tone="info">Some prices changed since you added them. You’ll pay the prices shown in the summary.</Notice>}
              {message && <Notice tone={message.tone}>{message.text}</Notice>}
              <button type="button" className="btn btn--indigo btn--block btn--lg" onClick={() => void pay()} disabled={paying || storeClosed}>
                {paying ? 'Processing…' : `Pay ${formatINR(review.total)}`}
              </button>
              <p className="checkout__policy muted small">
                By placing your order, you acknowledge our <Link to="/terms">Terms &amp; Conditions</Link>,{' '}
                <Link to="/privacy">Privacy Policy</Link>, and <Link to="/cancellation-refund">Cancellation &amp; Refund Policy</Link>.
              </p>
              <p className="muted small">Payment is processed by Cashfree and verified by our server before your order is confirmed.</p>
            </div>
          )}
        </section>

        <div className="checkout__side">
          <OrderSummaryPanel deliveryFee={settings?.deliveryFee ?? null} validated={review} />
        </div>
      </div>
    </div>
  );
}
