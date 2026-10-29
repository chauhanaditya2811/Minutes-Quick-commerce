import { Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import type { Product } from '../../types/product';
import { CartIcon } from '../ui/Icons';
import QuantityStepper from '../ui/QuantityStepper';

export default function ProductCard({ product, storeOpen = true }: { product: Product; storeOpen?: boolean }) {
  const { quantityOf, addItem, setQuantity } = useCart();
  const qty = quantityOf(product.id);
  const soldOut = product.stock <= 0;

  return (
    <article className="card">
      <Link to={`/products/${product.id}`} className="card__media" aria-label={`View ${product.name}`}>
        <img src={product.imageUrl} alt={product.name} loading="lazy" />
        {soldOut ? (
          <span className="badge badge--out">Out of stock</span>
        ) : (
          product.popular && <span className="badge badge--popular">Popular</span>
        )}
      </Link>
      <div className="card__body">
        <h3 className="card__title">
          <Link to={`/products/${product.id}`}>{product.name}</Link>
        </h3>
        {product.description && <p className="card__desc">{product.description}</p>}
        <p className="card__unit">{product.unit}</p>
        <div className="card__price-row">
          <span className="price">{formatINR(product.price)}</span>
          {!soldOut && product.stock <= 5 && <span className="low">Only {product.stock} left</span>}
        </div>
        {qty > 0 ? (
          <QuantityStepper quantity={qty} max={product.stock} label={product.name} onChange={(n) => setQuantity(product.id, n)} />
        ) : (
          <button
            type="button"
            className="btn btn--yellow btn--block"
            disabled={soldOut || !storeOpen}
            onClick={() => addItem(product)}
            aria-label={`Add ${product.name} to cart`}
          >
            <CartIcon width={16} height={16} /> {soldOut ? 'Unavailable' : 'Add to Cart'}
          </button>
        )}
      </div>
    </article>
  );
}
