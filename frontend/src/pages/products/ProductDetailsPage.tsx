import { Link, useParams } from 'react-router-dom';
import { useProduct } from '../../hooks/useProducts';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import Loading from '../../components/Loading';
import Notice from '../../components/ui/Notice';
import EmptyState from '../../components/ui/EmptyState';
import QuantityStepper from '../../components/ui/QuantityStepper';
import { CartIcon } from '../../components/ui/Icons';

export default function ProductDetailsPage() {
  const { id } = useParams();
  const { data: product, loading, error } = useProduct(id);
  const { data: settings } = useStoreSettings();
  const { quantityOf, addItem, setQuantity } = useCart();

  if (loading) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!product) {
    return (
      <EmptyState title="Product not found">
        <p>It may have been removed.</p>
        <Link to="/" className="btn btn--yellow">Back to shop</Link>
      </EmptyState>
    );
  }

  const qty = quantityOf(product.id);
  const soldOut = product.stock <= 0;
  const closed = settings ? !settings.storeOpen : false;

  return (
    <div className="page">
      <p className="crumbs"><Link to="/">Shop</Link> / {product.name}</p>
      <div className="detail">
        <div className="detail__media"><img src={product.imageUrl} alt={product.name} /></div>
        <div className="detail__info">
          <h1>{product.name}</h1>
          <p className="muted">{product.unit}</p>
          <p className="price price--lg">{formatINR(product.price)}</p>
          <p className={soldOut ? 'stock stock--out' : 'stock'}>
            {soldOut ? 'Out of stock' : product.stock <= 5 ? `Only ${product.stock} left` : 'In stock'}
          </p>
          {product.description && <p className="detail__desc">{product.description}</p>}
          {closed && <Notice tone="warning">The store is closed right now.</Notice>}
          <div className="detail__cta">
            {qty > 0 ? (
              <>
                <QuantityStepper quantity={qty} max={product.stock} label={product.name} onChange={(n) => setQuantity(product.id, n)} />
                <Link to="/cart" className="btn btn--indigo">View cart</Link>
              </>
            ) : (
              <button type="button" className="btn btn--yellow" disabled={soldOut || closed} onClick={() => addItem(product)}>
                <CartIcon width={16} height={16} /> Add to Cart
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
