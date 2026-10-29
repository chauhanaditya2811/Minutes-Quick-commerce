import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { DELIVERY_WINDOW_MS, formatCountdown, useDeliveryCountdown } from '../../hooks/useDeliveryCountdown';
import { claimCelebration } from '../../services/celebration';
import type { OrderDetail } from '../../types/order';
import { formatDate, formatINR } from '../../utils/format';
import CallStoreButton from './CallStoreButton';

// Loaded only when an order is actually celebrated, keeping it out of the main bundle.
const PartyPopperCelebration = lazy(() => import('../celebration/PartyPopperCelebration'));

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const RING = 2 * Math.PI * 54;

interface Props {
  /** A server-confirmed order (paymentStatus SUCCESS). */
  order: OrderDetail;
  /** serverTime − device time, so the countdown is right even on a wrong device clock. */
  serverOffsetMs: number;
  /** Extra content under the order details, e.g. the guest's private order link. */
  children?: ReactNode;
}

/**
 * The confirmed-order screen shared by guest and signed-in checkout: a one-time full-screen
 * celebration, the 10-minute delivery countdown and the Call Store button.
 */
export default function OrderSuccess({ order, serverOffsetMs, children }: Props) {
  const { data: settings, reload: reloadSettings } = useStoreSettings();
  const remaining = useDeliveryCountdown(order.confirmedAt, serverOffsetMs);
  const delivered = order.orderStatus === 'DELIVERED';
  const ready = delivered || remaining <= 0;

  // Celebrate once per order on this device, only right after confirmation (never on refresh).
  const [celebrating, setCelebrating] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current || delivered) return;
    claimed.current = true;
    if (claimCelebration(order.id, order.confirmedAt, serverOffsetMs)) setCelebrating(true);
  }, [delivered, order.confirmedAt, order.id, serverOffsetMs]);

  // When the button unlocks, fetch the latest store number in case the admin changed it.
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) reloadSettings();
    wasReady.current = ready;
  }, [ready, reloadSettings]);

  const progress = delivered ? 0 : Math.min(1, remaining / DELIVERY_WINDOW_MS);
  const time = delivered ? '00:00' : formatCountdown(remaining);
  const [minutes, seconds] = time.split(':').map(Number);

  return (
    <div className="order-success-page">
      {celebrating && !reducedMotion && (
        <Suspense fallback={null}>
          <PartyPopperCelebration onDone={() => setCelebrating(false)} />
        </Suspense>
      )}

      <section className={`panel order-success${celebrating ? ' order-success--celebrating' : ''}`} aria-labelledby="order-success-title">
        <div className="order-success__hero">
          <span className={`order-success__badge${celebrating ? ' order-success__badge--pop' : ''}`} aria-hidden="true">✓</span>
          <h1 id="order-success-title">{delivered ? '✅ Order Delivered!' : '🎉 Order Confirmed!'}</h1>
          <p className="order-success__lead">
            {delivered ? 'Your order has been delivered. Enjoy!' : 'Your order has been placed successfully!'}
          </p>
          {!delivered && (
            <p className="order-success__promise">
              <span aria-hidden="true">💛</span> Sit back and relax. Your order will be delivered to your doorstep within 10 minutes.
            </p>
          )}
        </div>

        <div className="delivery-timer">
          {!delivered && (
            <div
              className="delivery-timer__clock"
              role="timer"
              aria-live="off"
              aria-label={`Estimated delivery in ${minutes} minutes ${seconds} seconds`}
            >
              <svg viewBox="0 0 120 120" className="delivery-timer__ring" aria-hidden="true">
                <circle cx="60" cy="60" r="54" className="delivery-timer__track" />
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  className="delivery-timer__progress"
                  strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - progress)}
                />
              </svg>
              <span className="delivery-timer__label">Estimated delivery</span>
              <span className={`delivery-timer__time${ready ? ' delivery-timer__time--done' : ''}`}>{time}</span>
            </div>
          )}
          {!delivered && (
            <p className="delivery-timer__note">
              {ready ? 'Your order should be with you any moment now.' : 'Your order will be delivered within 10 minutes.'}
            </p>
          )}
          <CallStoreButton ready={ready} storePhone={settings?.storePhone} />
        </div>

        <dl className="guest-order__meta order-success__meta">
          <div><dt>Order number</dt><dd>{order.orderNumber}</dd></div>
          <div><dt>Placed</dt><dd>{formatDate(order.createdAt)}</dd></div>
          <div><dt>Status</dt><dd>{delivered ? 'Delivered' : 'Confirmed'} · Paid</dd></div>
        </dl>

        <h2 className="guest-order__section">Delivery</h2>
        <p className="guest-order__address">
          <strong>{order.customerName}</strong> · {order.customerPhone}<br />
          {order.customerHostel}, Floor {order.customerFloor}, Room {order.customerRoom}
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
          <div className="totals__final"><dt>Total paid</dt><dd>{formatINR(order.total)}</dd></div>
        </dl>

        {children}

        <Link to="/" className="btn btn--yellow btn--block">Continue shopping</Link>
      </section>
    </div>
  );
}
