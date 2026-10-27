import { Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import { CartIcon } from '../ui/Icons';

/** Floating bottom-center shortcut to the existing cart page. Rendered only while the cart has items. */
export default function FloatingViewCart() {
  const { lines, subtotal } = useCart();
  if (lines.length === 0) return null;

  const units = lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <div className="floating-cart">
      <Link
        to="/cart"
        className="floating-cart__btn"
        aria-label={`View cart, ${units} ${units === 1 ? 'item' : 'items'}, total ${formatINR(subtotal)}`}
      >
        <span className="floating-cart__icon" aria-hidden="true">
          <CartIcon width={20} height={20} />
        </span>
        <span className="floating-cart__info" aria-hidden="true">
          <span key={units} className="floating-cart__count">{units} {units === 1 ? 'item' : 'items'}</span>
          <span className="floating-cart__total">{formatINR(subtotal)}</span>
        </span>
        <span className="floating-cart__label" aria-hidden="true">View Cart ›</span>
      </Link>
    </div>
  );
}
