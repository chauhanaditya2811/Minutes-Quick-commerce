import { Link } from 'react-router-dom';
import { mockOrders } from '../../data/mockOrders';
import { formatDate, formatINR } from '../../utils/format';
import Notice from '../../components/ui/Notice';

/** MOCK-ONLY until the backend exposes an order-listing endpoint (see README). */
export default function OrdersPage() {
  return (
    <div className="page page--narrow">
      <h1>Orders</h1>
      <Notice tone="info">
        Sample data. Your real order history will appear here once an order-listing API is available.
      </Notice>
      <ul className="orders">
        {mockOrders.map((o) => (
          <li key={o.id} className="panel orders__item">
            <div className="orders__top">
              <strong>#{o.id}</strong>
              <span className={`status status--${o.status.toLowerCase()}`}>{o.status.replace('_', ' ')}</span>
            </div>
            {o.createdAt && <p className="muted small">{formatDate(o.createdAt)}</p>}
            {o.items && <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>}
            <p className="orders__total">{formatINR(o.total)}</p>
          </li>
        ))}
      </ul>
      <Link to="/" className="btn btn--yellow">Continue Shopping</Link>
    </div>
  );
}
