import { Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';

/** Floating bottom-center shortcut to the existing cart page. Rendered only while the cart has items. */
export default function FloatingViewCart() {
  const { lines, subtotal } = useCart();
  if (lines.length === 0) return null;

  const units = lines.reduce((sum, l) => sum + l.quantity, 0);
  const latest = lines[lines.length - 1].product;
  const itemsLabel = `${units} ${units === 1 ? 'item' : 'items'}`;
  return (
    <div className="floating-cart">
      <Link
        to="/cart"
        className="floating-cart__btn"
        aria-label={`View cart, ${itemsLabel}, total ${formatINR(subtotal)}`}
      >
        <span key={latest.id} className="floating-cart__thumb" aria-hidden="true">
          <img src={latest.imageUrl} alt="" />
        </span>
        <span className="floating-cart__text" aria-hidden="true">
          <span className="floating-cart__title">View cart</span>
          <span key={units} className="floating-cart__sub">{itemsLabel} · {formatINR(subtotal)}</span>
        </span>
        <span className="floating-cart__chevron" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </Link>
    </div>
  );
}
