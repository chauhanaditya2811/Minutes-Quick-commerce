import { Link } from 'react-router-dom';
import { useCart, type CartLine } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import QuantityStepper from '../ui/QuantityStepper';

export default function CartItemRow({ line }: { line: CartLine }) {
  const { setQuantity, removeItem } = useCart();
  const { product, quantity } = line;
  return (
    <li className="cart-row">
      <Link to={`/products/${product.id}`} className="cart-row__img">
        <img src={product.imageUrl} alt="" />
      </Link>
      <div className="cart-row__info">
        <Link to={`/products/${product.id}`} className="cart-row__name">{product.name}</Link>
        <p className="cart-row__price">{formatINR(product.price)} <span className="muted">· {product.unit}</span></p>
        <div className="cart-row__actions">
          <QuantityStepper quantity={quantity} max={product.stock} label={product.name} onChange={(n) => setQuantity(product.id, n)} />
          <button type="button" className="link-btn" onClick={() => removeItem(product.id)} aria-label={`Remove ${product.name}`}>
            Remove
          </button>
        </div>
      </div>
      <p className="cart-row__total">{formatINR(product.price * quantity)}</p>
    </li>
  );
}
