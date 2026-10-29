import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../services/api';
import type { OrderDetail } from '../../types/order';
import EmptyState from '../../components/ui/EmptyState';
import Loading from '../../components/Loading';
import Notice from '../../components/ui/Notice';
import OrderSuccess from '../../components/orders/OrderSuccess';

const POLL_MS = 5000;
const MAX_POLLS = 12;

/** A signed-in customer's order after checkout, loaded from the server so it survives refreshes. */
export default function OrderConfirmationPage() {
  const { orderId = '' } = useParams();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const { order: fresh, serverTime } = await api.getMyOrder(orderId);
      const offset = Date.parse(serverTime) - Date.now();
      if (!Number.isNaN(offset)) setServerOffsetMs(offset);
      setOrder(fresh);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'not-found' : e instanceof Error ? e.message : 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = order?.orderStatus === 'PENDING_PAYMENT' && order.paymentStatus !== 'FAILED' && order.paymentStatus !== 'CANCELLED';

  // The webhook may confirm a moment after the browser returns: check back briefly.
  useEffect(() => {
    if (!pending || polls.current >= MAX_POLLS) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [pending, order, load]);

  if (loading && !order) return <Loading label="Loading your order…" />;
  if (!order) {
    return (
      <EmptyState title={error === 'not-found' ? 'Order not found' : 'Could not load this order'}>
        <p>{error === 'not-found' ? 'This order doesn’t exist or belongs to another account.' : error}</p>
        <Link to="/orders" className="btn btn--yellow">Go to my orders</Link>
      </EmptyState>
    );
  }

  // Only a payment the server has verified shows the confirmation (and its celebration).
  if (order.paymentStatus === 'SUCCESS' && order.orderStatus !== 'CANCELLED') {
    return (
      <div className="page">
        <OrderSuccess order={order} serverOffsetMs={serverOffsetMs} />
      </div>
    );
  }

  const failed = order.orderStatus === 'PENDING_PAYMENT' && !pending;
  return (
    <div className="page page--narrow">
      <section className="panel guest-order">
        <div className={`guest-order__hero guest-order__hero--${failed ? 'failed' : 'pending'}`}>
          <span className="guest-order__icon" aria-hidden="true">{failed ? '!' : <span className="spinner" />}</span>
          <div>
            <h1>{order.orderStatus === 'CANCELLED' ? 'Order cancelled' : failed ? 'Payment didn’t go through' : 'Confirming your payment…'}</h1>
            <p className="muted">
              {failed
                ? 'No money was taken for this order. You can try again from checkout.'
                : 'This usually takes a few seconds. You won’t be charged twice.'}
            </p>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <p className="muted small">Order number {order.orderNumber}</p>
        <div className="guest-order__actions">
          {failed ? (
            <Link to="/checkout" className="btn btn--indigo">Try payment again</Link>
          ) : (
            <button type="button" className="btn btn--outline btn--sm" onClick={() => void load()}>Check again</button>
          )}
          <Link to="/orders" className="btn btn--outline btn--sm">My orders</Link>
        </div>
      </section>
    </div>
  );
}
