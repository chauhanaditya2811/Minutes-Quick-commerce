import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { ApiError, api } from '../../services/api';
import { apiConfigured, previewMode } from '../../services/config';
import { openCashfree } from '../../services/cashfree';
import { isProfileComplete } from '../../types/user';
import type { OrderSummary, ValidateOrderResponse } from '../../types/order';
import type { StoreSettings } from '../../types/product';
import { formatINR } from '../../utils/format';
import { estimateFees } from '../../utils/fees';
import DeliveryDetailsForm from '../../components/checkout/DeliveryDetailsForm';
import GuestCheckout from '../../components/checkout/GuestCheckout';
import Loading from '../../components/Loading';
import OrderSummaryPanel from '../../components/checkout/OrderSummary';
import EmptyState from '../../components/ui/EmptyState';
import Notice from '../../components/ui/Notice';

const estimatedTotal = (subtotal: number, settings: StoreSettings) => {
  const fees = estimateFees(subtotal, settings);
  return subtotal + fees.convenienceFee + fees.lateNightFee;
};

/** Signed-in customers keep their saved-details checkout; everyone else can check out as a guest. */
export default function CheckoutPage() {
  const { firebaseUser, loading } = useAuth();
  const { lines } = useCart();
  if (loading) return <Loading label="Checking sign-in…" />;
  if (firebaseUser) return <SignedInCheckout />;
  if (lines.length === 0) {
    return (
      <EmptyState title="Nothing to check out">
        <p>Your cart is empty.</p>
        <Link to="/" className="btn btn--yellow">Browse products</Link>
      </EmptyState>
    );
  }
  return <GuestCheckout />;
}

function SignedInCheckout() {
  const { lines, subtotal, clearCart } = useCart();
  const { profile, firebaseUser, profileError, saveProfile } = useAuth();
  const { selectedPool } = useHostel();
  const { data: settings, loading: settingsLoading, error: settingsError, reload: reloadSettings } = useStoreSettings();
  const navigate = useNavigate();

  const [validated, setValidated] = useState<ValidateOrderResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payMessage, setPayMessage] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<OrderSummary | null>(null);
  const [revalidate, setRevalidate] = useState(0);

  const complete = isProfileComplete(profile);
  const live = apiConfigured && !!firebaseUser;
  // The cart holds the pool's stock, so the saved delivery hostel must be one of its hostels.
  const hostelId = profile?.hostelId ?? '';
  const poolId = selectedPool?.id ?? '';
  const hostelMatches = !!hostelId && !!selectedPool?.hostels.some((h) => h.id === hostelId);
  // A pool with one hostel leaves nothing to choose: the customer picked it on the first
  // screen, so their saved address moves there (keeping name, phone, block/floor and room).
  const onlyHostel = selectedPool?.hostels.length === 1 ? selectedPool.hostels[0] : null;
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [movedFrom, setMovedFrom] = useState<string | null>(null);
  const deliverToOnlyHostel = async () => {
    if (!profile || !onlyHostel) return;
    const previous = profile.hostel;
    setMoving(true);
    setMoveError(null);
    try {
      // Same name, phone, block/floor and room; only the hostel changes.
      await saveProfile({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        hostelId: onlyHostel.id,
        floor: profile.floor ?? '',
        room: profile.room ?? '',
      });
      setMovedFrom(previous ?? 'your previous hostel');
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Could not update your delivery details.');
    } finally {
      setMoving(false);
    }
  };
  // Do it automatically, once per pool and saved hostel; on failure the button below retries.
  const autoMoved = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !complete || hostelMatches || !onlyHostel || !profile) return;
    const key = `${onlyHostel.id}:${profile.hostelId ?? ''}`;
    if (autoMoved.current === key) return;
    autoMoved.current = key;
    void deliverToOnlyHostel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, complete, hostelMatches, onlyHostel?.id, profile?.hostelId]);
  const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity }));
  const itemsKey = JSON.stringify(items);
  const storeOpen = settings?.storeOpen ?? false;

  // Ask the backend to validate the cart. Its total is the only one we trust.
  useEffect(() => {
    setValidated(null);
    setPendingOrder(null);
    setValidationError(null);
    if (!live || !complete || !hostelMatches || items.length === 0 || !storeOpen) {
      setValidating(false);
      return;
    }
    let cancelled = false;
    setValidating(true);
    api
      .validateOrder({ hostelId, poolId, items })
      .then((r) => !cancelled && setValidated(r))
      .catch((e: unknown) => !cancelled && setValidationError(e instanceof Error ? e.message : 'Could not validate your order.'))
      .finally(() => !cancelled && setValidating(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, complete, hostelMatches, hostelId, poolId, itemsKey, storeOpen, revalidate]);

  if (lines.length === 0) {
    return (
      <EmptyState title="Nothing to check out">
        <p>Your cart is empty.</p>
        <Link to="/" className="btn btn--yellow">Browse products</Link>
      </EmptyState>
    );
  }

  const pay = async () => {
    setPaying(true);
    setPayMessage(null);
    try {
      // Reuse the order if an earlier payment attempt was dismissed, so retries don't create duplicates.
      const order = pendingOrder ?? (await api.createOrder({ hostelId, poolId, items }));
      setPendingOrder(order);
      let init;
      try {
        init = await api.initPayment(order.id);
      } catch (e) {
        // The order's held stock lapsed and someone else bought it: start again from the cart.
        if (e instanceof ApiError && e.status === 409) {
          setPendingOrder(null);
          setRevalidate((n) => n + 1);
        }
        throw e;
      }
      const holdNote = init.holdExpiresAt
        ? ` Your items are held until ${new Date(init.holdExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : '';
      const outcome = await openCashfree(init);
      if (outcome.status === 'dismissed') {
        setPayMessage(`Payment was not completed.${holdNote} You can try again.`);
      } else if (outcome.status === 'failed') {
        setPayMessage(`${outcome.message}${holdNote}`);
      } else {
        const payment = await api.verifyPayment(order.id, outcome.payload);
        if (payment.paymentStatus !== 'SUCCESS' || payment.orderStatus !== 'CONFIRMED') {
          throw new Error('The server has not confirmed this payment. Your cart has been kept.');
        }
        const confirmed: OrderSummary = {
          ...order,
          orderNumber: payment.orderNumber,
          status: payment.orderStatus,
          paymentStatus: payment.paymentStatus,
        };
        clearCart();
        navigate(`/orders/${order.id}/confirmation`, { replace: true, state: { order: confirmed } });
      }
    } catch (e) {
      setPayMessage(e instanceof Error ? e.message : 'Something went wrong while paying.');
    } finally {
      setPaying(false);
    }
  };

  const canPay = live && complete && hostelMatches && storeOpen && !!validated && !validating && !paying;

  return (
    <div className="page">
      <h1>Checkout</h1>
      <div className="checkout">
        <section className="panel" aria-labelledby="details-h">
          <h2 id="details-h">Delivery details</h2>
          <p className="muted">Where should we bring your order? Please fill out all the fields.</p>
          {profileError && <Notice tone="error">Could not load your saved delivery details: {profileError}</Notice>}
          <DeliveryDetailsForm submitLabel={complete ? 'Update details' : 'Save details'} pool={selectedPool} />
        </section>

        <div className="checkout__side">
          <OrderSummaryPanel settings={settings} validated={validated?.checkout ?? null} />

          <section className="panel" aria-labelledby="pay-h">
            <h2 id="pay-h">Pay securely with Cashfree</h2>
            {previewMode && <Notice tone="info">Preview mode: payments are disabled until the backend and Cashfree are connected.</Notice>}
            {settingsLoading && <p className="muted">Loading store settings…</p>}
            {settingsError && <Notice tone="error">{settingsError} <button type="button" className="link-btn" onClick={reloadSettings}>Try again</button></Notice>}
            {settings && !settings.storeOpen && <Notice tone="warning">The store is closed right now.</Notice>}
            {live && !complete && <Notice tone="warning">Save your delivery details to continue.</Notice>}
            {movedFrom && hostelMatches && onlyHostel && (
              <Notice tone="info">
                Delivering to <strong>{onlyHostel.name}</strong>. We’ve updated your saved hostel (it was {movedFrom}). Check your
                block/floor and room under Delivery details.
              </Notice>
            )}
            {live && complete && !hostelMatches && !moving && selectedPool && selectedPool.hostels.length > 0 && (
              <Notice tone="warning">
                Your saved delivery address is at <strong>{profile?.hostel ?? 'another hostel'}</strong>, but you’re shopping for{' '}
                <strong>{selectedPool.name}</strong>.{' '}
                {onlyHostel ? (
                  <>
                    <button type="button" className="link-btn" disabled={moving} onClick={() => void deliverToOnlyHostel()}>
                      {moving ? 'Updating…' : `Deliver to ${onlyHostel.name} instead`}
                    </button>{' '}
                    (your block/floor and room stay the same; change them above if they’re different there).
                  </>
                ) : (
                  <>Choose your hostel under Delivery details above and save to continue.</>
                )}
              </Notice>
            )}
            {moveError && <Notice tone="error">{moveError}</Notice>}
            {validating && <p className="muted">Checking your order…</p>}
            {validationError && <Notice tone="error">{validationError}</Notice>}
            {payMessage && <Notice tone="error">{payMessage}</Notice>}
            {!validated && live && complete && hostelMatches && !validating && !validationError && settings?.storeOpen && (
              <p className="muted small">Estimated {formatINR(estimatedTotal(subtotal, settings))}</p>
            )}
            <button type="button" className="btn btn--indigo btn--block btn--lg" disabled={!canPay} onClick={() => void pay()}>
              {paying ? 'Processing…' : validated ? `Pay ${formatINR(validated.checkout.total)}` : 'Pay now'}
            </button>
            <p className="checkout__policy muted small">
              By placing your order, you acknowledge our <Link to="/terms">Terms &amp; Conditions</Link>,{' '}
              <Link to="/privacy">Privacy Policy</Link>, and <Link to="/cancellation-refund">Cancellation &amp; Refund Policy</Link>.
            </p>
            <p className="muted small">Payment is processed by Cashfree and verified by our server before your order is confirmed.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
