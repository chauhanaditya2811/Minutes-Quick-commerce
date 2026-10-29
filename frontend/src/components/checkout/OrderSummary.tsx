import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import type { ValidateOrderResponse } from '../../types/order';

interface Props {
  deliveryFee: number | null;
  /** Validated figures from POST /api/orders/validate, when available. */
  validated?: ValidateOrderResponse['checkout'] | null;
}

export default function OrderSummary({ deliveryFee, validated }: Props) {
  const { lines, subtotal } = useCart();
  const estTotal = subtotal + (deliveryFee ?? 0);

  return (
    <section className="panel" aria-labelledby="summary-h">
      <h2 id="summary-h">Order summary</h2>
      <ul className="summary-list">
        {lines.map((l) => {
          // Once the server has priced the cart, show its prices rather than the cart's snapshot.
          const price = validated?.items.find((item) => item.productId === l.product.id)?.price ?? l.product.price;
          return (
            <li key={l.product.id}>
              <img src={l.product.imageUrl} alt="" />
              <span className="summary-list__name">
                {l.product.name}
                <small>{l.quantity} × {formatINR(price)}</small>
              </span>
              <span>{formatINR(l.quantity * price)}</span>
            </li>
          );
        })}
      </ul>
      <dl className="totals">
        <div><dt>Items</dt><dd>{formatINR(validated?.subtotal ?? subtotal)}</dd></div>
        <div>
          <dt>Delivery</dt>
          <dd>{validated?.deliveryFee !== undefined ? formatINR(validated.deliveryFee) : deliveryFee !== null ? formatINR(deliveryFee) : '—'}</dd>
        </div>
        {validated ? (
          <div className="totals__final"><dt>Total to pay</dt><dd>{formatINR(validated.total)}</dd></div>
        ) : (
          <div className="totals__final"><dt>Estimated total</dt><dd>{formatINR(estTotal)}</dd></div>
        )}
      </dl>
      {!validated && <p className="muted small">The final total is confirmed by the server before you pay.</p>}
    </section>
  );
}
