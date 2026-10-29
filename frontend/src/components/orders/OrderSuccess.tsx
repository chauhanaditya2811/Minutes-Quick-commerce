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

interface Props {
  /** A server-confirmed order (paymentStatus SUCCESS). */
  order: OrderDetail;
  /** serverTime − device time, so the countdown is right even on a wrong device clock. */
  serverOffsetMs: number;
  /** Extra content under the order details, e.g. the guest's private order link. */
  children?: ReactNode;
}

/**
 * The confirmed-order screen shared by guest and signed-in checkout: what was ordered first, then
 * the 10-minute delivery countdown with the Call Store button, then delivery and order details.
 * A one-time full-screen celebration plays behind it right after confirmation.
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

  const elapsed = delivered ? 1 : 1 - Math.min(1, remaining / DELIVERY_WINDOW_MS);
  const time = delivered ? '00:00' : formatCountdown(remaining);
  const [minutes, seconds] = time.split(':').map(Number);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className={`order-success-page${celebrating ? ' order-success-page--celebrating' : ''}`}>
      {celebrating && !reducedMotion && (
        <Suspense fallback={null}>
          <PartyPopperCelebration onDone={() => setCelebrating(false)} />
        </Suspense>
      )}

      <section className={`panel order-success${celebrating ? ' order-success--celebrating' : ''}`} aria-labelledby="order-success-title">
        <header className="order-success__head">
          <span className={`order-success__check${celebrating ? ' order-success__check--pop' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <h1 id="order-success-title">{delivered ? 'Order Delivered' : 'Order Confirmed'}</h1>
            <p>{delivered ? 'Your order has been delivered. Enjoy!' : 'Your order has been placed successfully.'}</p>
          </div>
        </header>

        <section className="order-success__block" aria-labelledby="order-success-items">
          <div className="order-success__block-head">
            <h2 id="order-success-items">Your order</h2>
            <span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
          </div>
          <ul className="order-items">
            {order.items.map((item, index) => (
              <li key={`${item.productName}-${index}`} className="order-items__row">
                <ItemThumb name={item.productName} src={item.product?.imageUrl} />
                <span className="order-items__name">
                  {item.productName}
                  <small>{item.unit} · {formatINR(item.price)}</small>
                </span>
                <span className="order-items__qty">×{item.quantity}</span>
                <span className="order-items__price">{formatINR(item.subtotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="order-success__totals">
            <div><dt>Item total</dt><dd>{formatINR(order.subtotal)}</dd></div>
            <div><dt>Delivery</dt><dd>{order.deliveryFee === 0 ? 'Free' : formatINR(order.deliveryFee)}</dd></div>
            <div className="order-success__total"><dt>Total paid</dt><dd>{formatINR(order.total)}</dd></div>
          </dl>
        </section>

        <section className="order-success__block delivery-timer" aria-label="Delivery">
          {!delivered && (
            <>
              <div className="delivery-timer__row">
                <div>
                  <p className="delivery-timer__label">{ready ? 'Arriving now' : 'Arriving in'}</p>
                  <p className="delivery-timer__note">Sit back and relax. Your order will be delivered to your doorstep within 10 minutes.</p>
                </div>
                <span
                  className={`delivery-timer__time${ready ? ' delivery-timer__time--done' : ''}`}
                  role="timer"
                  aria-live="off"
                  aria-label={`Estimated delivery in ${minutes} minutes ${seconds} seconds`}
                >
                  {time}
                </span>
              </div>
              <div className="delivery-timer__bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${elapsed})` }} />
              </div>
            </>
          )}
          <CallStoreButton ready={ready} storePhone={settings?.storePhone} />
        </section>

        <dl className="order-success__details">
          <div><dt>Deliver to</dt><dd>{order.customerName} · {order.customerPhone}<br />{order.customerHostel}, Floor {order.customerFloor}, Room {order.customerRoom}</dd></div>
          <div><dt>Order ID</dt><dd className="order-success__id">{order.orderNumber}</dd></div>
          <div><dt>Placed</dt><dd>{formatDate(order.createdAt)}</dd></div>
          <div><dt>Payment</dt><dd>Paid</dd></div>
        </dl>

        {children}

        <Link to="/" className="btn btn--yellow btn--block order-success__continue">Continue shopping</Link>
      </section>
    </div>
  );
}

/** Product photo, or a neutral initial tile when the photo is missing or fails to load. */
function ItemThumb({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="order-items__thumb order-items__thumb--empty" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
  }
  return <img className="order-items__thumb" src={src} alt="" loading="lazy" decoding="async" width={44} height={44} onError={() => setFailed(true)} />;
}
