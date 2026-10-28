import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { AdminOrder } from '../../types/order';
import { formatDate, formatINR } from '../../utils/format';
import Loading from '../Loading';
import Notice from '../ui/Notice';

export default function OrdersShell() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await api.getAdminOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const markDelivered = async (order: AdminOrder) => {
    if (updatingOrderId) return;
    if (!window.confirm(`Mark order ${order.orderNumber} as delivered?`)) return;

    setUpdatingOrderId(order.id);
    setMessage(null);
    try {
      const updated = await api.markAdminOrderDelivered(order.id);
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ tone: 'success', text: `${updated.orderNumber} marked as delivered.` });
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : `Could not update ${order.orderNumber}.`,
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  return (
    <section className="panel">
      <h2>Customer orders</h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && (
        <Notice tone="error">
          Could not load orders: {error} <button type="button" className="link-btn" onClick={() => void loadOrders()}>Try again</button>
        </Notice>
      )}
      {loading && <Loading label="Loading orders…" />}
      {!loading && !error && orders.length === 0 && (
        <Notice tone="info">No customer orders yet.</Notice>
      )}
      <div className="table-wrap admin-order__table-wrap">
        <table className="table admin-order__table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Delivery address</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Order status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const canDeliver = order.orderStatus === 'CONFIRMED' && order.paymentStatus === 'SUCCESS';
              return (
                <tr key={order.id}>
                  <td data-label="Order">{order.orderNumber}</td>
                  <td data-label="Customer">
                    <strong>{order.customerName}</strong>
                    <small className="admin-order__subline">{order.customerEmail}</small>
                    <small className="admin-order__subline">{order.customerPhone}</small>
                  </td>
                  <td data-label="Delivery address">{order.customerHostel}, Floor {order.customerFloor}, Room {order.customerRoom}</td>
                  <td data-label="Items">
                    <ul className="admin-order__items">
                      {order.items.map((item, index) => (
                        <li key={`${item.productName}-${index}`}>
                          {item.quantity} × {item.productName} ({item.unit}) — {formatINR(item.subtotal)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Total">{formatINR(order.total)}</td>
                  <td data-label="Payment"><span className="status">{order.paymentStatus.replace(/_/g, ' ')}</span></td>
                  <td data-label="Order status">
                    <span className={`status status--${order.orderStatus.toLowerCase()}`}>{order.orderStatus.replace(/_/g, ' ')}</span>
                    {order.inventoryShortfall && <span className="status status--shortfall" title="Paid after the stock hold expired and the hostel no longer had enough stock. Fulfil or refund manually.">Stock shortfall</span>}
                  </td>
                  <td data-label="Created"><time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time></td>
                  <td data-label="Action">
                    {canDeliver ? (
                      <button
                        type="button"
                        className="btn btn--blue btn--sm"
                        disabled={updatingOrderId !== null}
                        onClick={() => void markDelivered(order)}
                      >
                        {updatingOrderId === order.id ? 'Updating…' : 'Mark as Delivered'}
                      </button>
                    ) : order.orderStatus === 'DELIVERED' && order.deliveredAt ? (
                      <span className="muted small">Delivered {formatDate(order.deliveredAt)}</span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
