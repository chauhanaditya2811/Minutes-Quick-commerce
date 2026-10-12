import { Link, useLocation, useParams } from 'react-router-dom';
import type { OrderSummary } from '../../types/order';
import { formatINR } from '../../utils/format';
import EmptyState from '../../components/ui/EmptyState';

export default function OrderConfirmationPage() {
  const { orderId } = useParams();
  const order = (useLocation().state as { order?: OrderSummary } | null)?.order;

  // No "get order by id" endpoint is documented yet, so details only exist right after payment.
  if (!order) {
    return (
      <EmptyState title="Order details unavailable">
        <p>Order {orderId} can't be loaded here yet. Order lookup needs a backend endpoint.</p>
        <Link to="/orders" className="btn btn--yellow">Go to orders</Link>
      </EmptyState>
    );
  }

  return (
    <div className="page page--narrow">
      <section className="panel">
        <h1>{order.status === 'CONFIRMED' ? 'Order confirmed' : 'Order received'}</h1>
        <p className="muted">Order ID: {order.id}</p>
        <dl className="totals">
          <div><dt>Status</dt><dd>{order.status.replace('_', ' ')}</dd></div>
          {order.paymentStatus && <div><dt>Payment</dt><dd>{order.paymentStatus}</dd></div>}
          {order.subtotal !== undefined && <div><dt>Items</dt><dd>{formatINR(order.subtotal)}</dd></div>}
          {order.deliveryFee !== undefined && <div><dt>Delivery</dt><dd>{formatINR(order.deliveryFee)}</dd></div>}
          <div className="totals__final"><dt>Total</dt><dd>{formatINR(order.total)}</dd></div>
        </dl>
        {order.items && (
          <ul className="summary-list">
            {order.items.map((i, n) => (
              <li key={n}><span className="summary-list__name">{i.name}<small>{i.quantity} × {formatINR(i.price)}</small></span><span>{formatINR(i.quantity * i.price)}</span></li>
            ))}
          </ul>
        )}
        <Link to="/" className="btn btn--yellow btn--block">Continue Shopping</Link>
      </section>
    </div>
  );
}
