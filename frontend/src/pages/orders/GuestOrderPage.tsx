import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { ApiError, api } from '../../services/api';
import { findGuestOrder, loadPendingCheckout, rememberGuestOrder, savePendingCheckout } from '../../services/guestCheckout';
import type { GuestOrder, OrderStatus } from '../../types/order';
import { deliveryAddress } from '../../utils/blockFloor';
import { formatDate, formatINR } from '../../utils/format';
import EmptyState from '../../components/ui/EmptyState';
import OrderSuccess from '../../components/orders/OrderSuccess';
import Loading from '../../components/Loading';
import Notice from '../../components/ui/Notice';

const POLL_MS = 5000;
const MAX_POLLS = 12; // about a minute of waiting for a delayed confirmation

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

// The token arrives either from this device's storage or a private link (#t=…). The part after
// "#" is never sent to the server or to other sites, so the token stays out of logs and referrers.
function readToken(orderId: string): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('t');
  return fromLink ?? findGuestOrder(orderId)?.token ?? null;
}

/** A guest's order: confirmation, pending payment or failure, opened with its secret token. */
export default function GuestOrderPage() {
  const { orderId = '' } = useParams();
  const { clearCart } = useCart();
  const [token] = useState(() => readToken(orderId));
  const [order, setOrder] = useState<GuestOrder | null>(null);
  // serverTime − device time, captured with each load; keeps the countdown right on a wrong clock.
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const polls = useRef(0);

  const isPending = (o: GuestOrder) => o.orderStatus === 'PENDING_PAYMENT' && o.paymentStatus !== 'FAILED' && o.paymentStatus !== 'CANCELLED';

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const { order: fresh, serverTime } = await api.getGuestOrder(orderId, token);
      const offset = Date.parse(serverTime) - Date.now();
      if (!Number.isNaN(offset)) setServerOffsetMs(offset);
      setOrder(fresh);
      setError(null);
      rememberGuestOrder({ orderId, token, orderNumber: fresh.orderNumber });
      // Paid and confirmed by the server: only now is it safe to empty the cart.
      if (fresh.paymentStatus === 'SUCCESS' && loadPendingCheckout()?.orderId === orderId) {
        clearCart();
        savePendingCheckout(null);
      }
      return fresh;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'not-found' : e instanceof Error ? e.message : 'Could not load this order.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearCart, orderId, token]);

  // Ask the server to check Cashfree directly. It confirms only a payment Cashfree reports as
  // successful for this order and amount, and does so at most once however often it is asked.
  const verify = useCallback(async () => {
    const cashfreeOrderId = findGuestOrder(orderId)?.cashfreeOrderId ?? loadPendingCheckout()?.cashfreeOrderId;
    if (!token || !cashfreeOrderId) return;
    try {
      await api.verifyGuestPayment(orderId, token, { cashfree_order_id: cashfreeOrderId });
    } catch {
      /* not paid yet, or confirmation still on its way: the status below says which */
    }
  }, [orderId, token]);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    await verify();
    await load();
    setChecking(false);
  }, [load, verify]);

  // First load: keep the token from a private link on this device and tidy the address bar.
  useEffect(() => {
    if (!token) return;
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    void (async () => {
      const first = await load();
      if (first && isPending(first)) await checkAgain();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the payment is still being confirmed (e.g. a delayed webhook), check back briefly.
  useEffect(() => {
    if (!order || !isPending(order) || polls.current >= MAX_POLLS) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [order, load]);

  if (!token) {
    return (
      <EmptyState title="This order can’t be opened here">
        <p>Guest orders open only on the device used to place them, or with the private order link shown after checkout.</p>
        <p>Need help? Message us on WhatsApp with your order number.</p>
        <Link to="/" className="btn btn--yellow">Back to shop</Link>
      </EmptyState>
    );
  }
  if (loading && !order) return <Loading label="Loading your order…" />;
  if (error === 'not-found' || (!order && error)) {
    return (
      <EmptyState title={error === 'not-found' ? 'Order not found' : 'Could not load this order'}>
        <p>{error === 'not-found' ? 'This order link is invalid or has expired on this device.' : error}</p>
        <Link to="/" className="btn btn--yellow">Back to shop</Link>
      </EmptyState>
    );
  }
  if (!order) return null;

  const paid = order.paymentStatus === 'SUCCESS';
  const failed = order.orderStatus === 'PENDING_PAYMENT' && (order.paymentStatus === 'FAILED' || order.paymentStatus === 'CANCELLED');
  const pending = isPending(order);
  const link = `${window.location.origin}/guest-orders/${order.id}#t=${token}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt('Copy your private order link:', link);
    }
  };

  const privateLink = (
    <div className="guest-order__link">
      <p className="small"><strong>Save your private order link</strong> to check this order later or on another device. Anyone with the link can see this order, so keep it to yourself.</p>
      <button type="button" className="btn btn--outline btn--sm" onClick={() => void copyLink()}>{copied ? 'Link copied' : 'Copy order link'}</button>
    </div>
  );

  // Only a payment the server has verified shows the confirmation (and its celebration).
  if (paid && order.orderStatus !== 'CANCELLED') {
    return (
      <div className="page">
        <OrderSuccess order={order} serverOffsetMs={serverOffsetMs}>{privateLink}</OrderSuccess>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <section className="panel guest-order">
        <div className={`guest-order__hero guest-order__hero--${paid ? 'ok' : failed ? 'failed' : 'pending'}`}>
          <span className="guest-order__icon" aria-hidden="true">{paid ? '✓' : failed ? '!' : <span className="spinner" />}</span>
          <div>
            <h1>
              {order.orderStatus === 'DELIVERED'
                ? 'Order delivered'
                : order.orderStatus === 'CANCELLED'
                  ? 'Order cancelled'
                  : paid
                    ? 'Order confirmed'
                    : failed
                      ? 'Payment didn’t go through'
                      : 'Confirming your payment…'}
            </h1>
            <p className="muted">
              {paid
                ? `Thank you, ${order.customerName}! We’re getting your order ready.`
                : failed
                  ? 'No money was taken for this order. Your items are kept for a few minutes so you can try again.'
                  : 'This usually takes a few seconds. You won’t be charged twice.'}
            </p>
          </div>
        </div>

        {pending && (
          <div className="guest-order__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
        )}
        {failed && (
          <div className="guest-order__actions">
            <Link to="/checkout" className="btn btn--indigo">Try payment again</Link>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <dl className="guest-order__meta">
          <div><dt>Order number</dt><dd>{order.orderNumber}</dd></div>
          <div><dt>Placed</dt><dd>{formatDate(order.createdAt)}</dd></div>
          <div><dt>Status</dt><dd>{STATUS_LABEL[order.orderStatus]}{paid ? ' · Paid' : ''}</dd></div>
        </dl>

        <h2 className="guest-order__section">Delivery</h2>
        <p className="guest-order__address">
          <strong>{order.customerName}</strong> · {order.customerPhone}<br />
          {deliveryAddress(order.customerHostel, order.customerFloor, order.customerRoom)}
        </p>

        <h2 className="guest-order__section">Items</h2>
        <ul className="summary-list">
          {order.items.map((item, index) => (
            <li key={`${item.productName}-${index}`}>
              <span className="summary-list__name">{item.productName}<small>{item.quantity} × {formatINR(item.price)} · {item.unit}</small></span>
              <span>{formatINR(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="totals">
          <div><dt>Items</dt><dd>{formatINR(order.subtotal)}</dd></div>
          <div><dt>Delivery</dt><dd>{formatINR(order.deliveryFee)}</dd></div>
          <div className="totals__final"><dt>{paid ? 'Total paid' : 'Total'}</dt><dd>{formatINR(order.total)}</dd></div>
        </dl>

        {privateLink}

        <Link to="/" className="btn btn--yellow btn--block">Continue shopping</Link>
      </section>
    </div>
  );
}
