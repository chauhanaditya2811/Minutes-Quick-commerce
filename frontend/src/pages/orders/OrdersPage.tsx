import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { CustomerOrder } from '../../types/order';
import { formatDate, formatINR } from '../../utils/format';
import Loading from '../../components/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Notice from '../../components/ui/Notice';

export default function OrdersPage() {
  const { data: orders, loading, error, reload } = useAsync<CustomerOrder[]>(
    () => api.getMyOrders(),
    [],
  );

  if (loading) return <Loading label="Loading your orders…" />;

  if (error) {
    return (
      <div className="page page--narrow">
        <h1>My Orders</h1>
        <Notice tone="error">
          Could not load your orders: {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      </div>
    );
  }

  if (orders?.length === 0) {
    return (
      <div className="page page--narrow">
        <h1>My Orders</h1>
        <EmptyState title="No orders yet">
          <p>Your orders will appear here after you place one.</p>
          <Link to="/" className="btn btn--yellow">Continue Shopping</Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <h1>My Orders</h1>
      <ul className="orders">
        {(orders ?? []).map((order) => (
          <li key={order.orderNumber} className="panel orders__item">
            <div className="orders__top">
              <strong className="orders__number">{order.orderNumber}</strong>
              <time className="orders__date muted small" dateTime={order.createdAt}>{formatDate(order.createdAt)}</time>
            </div>
            <div className="orders__statuses" aria-label="Order and payment status">
              <span className={`status status--${order.orderStatus.toLowerCase()}`}>
                {order.orderStatus.replace(/_/g, ' ')}
              </span>
              <span className="status">Payment: {order.paymentStatus.replace(/_/g, ' ')}</span>
            </div>
            <ul className="summary-list">
              {order.items.map((item, index) => (
                <li key={`${item.productName}-${index}`} className="orders__line-item">
                  <span className="summary-list__name">
                    {item.productName}
                    <small>{item.quantity} × {formatINR(item.price)} / {item.unit}</small>
                  </span>
                  <span className="orders__line-total">{formatINR(item.subtotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="totals">
              <div><dt>Items</dt><dd>{formatINR(order.subtotal)}</dd></div>
              <div><dt>Delivery</dt><dd>{formatINR(order.deliveryFee)}</dd></div>
              <div className="totals__final"><dt>Total</dt><dd>{formatINR(order.total)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <Link to="/" className="btn btn--yellow">Continue Shopping</Link>
    </div>
  );
}
