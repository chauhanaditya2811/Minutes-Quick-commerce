import Notice from '../ui/Notice';

/** UI shell only. No admin order-listing/management API exists yet — see README "Missing APIs". */
export default function OrdersShell() {
  return (
    <section className="panel">
      <h2>Customer orders</h2>
      <Notice tone="info">
        Order management isn't connected. It needs backend endpoints to list orders and update their status
        (for example, marking an order delivered).
      </Notice>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Room</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td colSpan={5} className="muted">No data. Waiting for an order-listing API.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
