import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { formatINR } from '../../utils/format';
import CartItemRow from '../../components/cart/CartItemRow';
import EmptyState from '../../components/ui/EmptyState';
import Notice from '../../components/ui/Notice';

export default function CartPage() {
  const { lines, subtotal, clearCart } = useCart();
  const { data: settings } = useStoreSettings();
  const { selectedHostel, openPicker } = useHostel();
  const navigate = useNavigate();

  if (lines.length === 0) {
    return (
      <EmptyState title="Your cart is empty">
        <p>Add a few things from the shop to get started.</p>
        <Link to="/" className="btn btn--yellow">Browse products</Link>
      </EmptyState>
    );
  }

  const belowMinimum = settings ? subtotal < settings.minimumOrder : false;
  const closed = settings ? !settings.storeOpen : false;

  return (
    <div className="page page--narrow">
      <section className="panel">
        <div className="panel__head">
          <h1>Shopping cart</h1>
          <button type="button" className="btn btn--red btn--sm" onClick={clearCart}>Clear Cart</button>
        </div>
        <p className="cart-hostel muted small">
          Shopping at <strong>{selectedHostel?.name}</strong> ·{' '}
          <button type="button" className="link-btn" onClick={openPicker}>Change</button>
        </p>
        <ul className="cart-list">
          {lines.map((l) => <CartItemRow key={l.product.id} line={l} />)}
        </ul>
        <div className="cart-foot">
          <div className="cart-foot__row"><span>Subtotal</span><strong>{formatINR(subtotal)}</strong></div>
          <p className="muted small">
            {settings ? `Delivery fee ${formatINR(settings.deliveryFee)} is added at checkout.` : 'Delivery is calculated at checkout.'}
          </p>
          {closed && <Notice tone="warning">The store is closed right now.</Notice>}
          {belowMinimum && settings && (
            <Notice tone="warning">Add {formatINR(settings.minimumOrder - subtotal)} more to reach the {formatINR(settings.minimumOrder)} minimum order.</Notice>
          )}
          <button type="button" className="btn btn--indigo btn--block btn--lg" onClick={() => navigate('/checkout')} disabled={belowMinimum || closed}>
            Checkout
          </button>
          <p className="cart-foot__alt">or <Link to="/">Continue Shopping →</Link></p>
        </div>
      </section>
    </div>
  );
}
