import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import { estimateFees } from '../../utils/fees';
import type { ValidateOrderResponse } from '../../types/order';
import type { StoreSettings } from '../../types/product';
import FeeRules from './FeeRules';

interface Props {
  /** Store settings, for the fee estimate before the server has priced the cart. */
  settings: StoreSettings | null | undefined;
  /** Validated figures from POST /api/orders/validate, when available. */
  validated?: ValidateOrderResponse['checkout'] | null;
}

export default function OrderSummary({ settings, validated }: Props) {
  const { lines, subtotal } = useCart();
  // The server's figures once it has priced the cart; until then an estimate from the fee rules.
  const estimate = settings ? estimateFees(subtotal, settings) : null;
  const convenienceFee = validated ? validated.deliveryFee : estimate?.convenienceFee ?? null;
  const lateNightFee = validated ? validated.lateNightFee ?? 0 : estimate?.lateNightFee ?? 0;
  const estTotal = subtotal + (convenienceFee ?? 0) + lateNightFee;

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
          <dt>Convenience fee</dt>
          <dd>{convenienceFee === null ? '—' : convenienceFee === 0 ? 'Free' : formatINR(convenienceFee)}</dd>
        </div>
        {lateNightFee > 0 && (
          <div>
            <dt>Late-night fee</dt>
            <dd>{formatINR(lateNightFee)}</dd>
          </div>
        )}
        {validated ? (
          <div className="totals__final"><dt>Total to pay</dt><dd>{formatINR(validated.total)}</dd></div>
        ) : (
          <div className="totals__final"><dt>Estimated total</dt><dd>{formatINR(estTotal)}</dd></div>
        )}
      </dl>
      <FeeRules settings={settings} />
      {!validated && <p className="muted small">The final total is confirmed by the server before you pay.</p>}
    </section>
  );
}
