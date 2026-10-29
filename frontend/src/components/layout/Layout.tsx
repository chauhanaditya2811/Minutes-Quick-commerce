import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from '../Navbar';
import Footer from '../Footer';
import PreviewBanner from './PreviewBanner';
import FloatingViewCart from '../cart/FloatingViewCart';
import WhatsAppButton from './WhatsAppButton';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import HostelPicker from '../hostel/HostelPicker';

const TINTED = ['/checkout', '/account', '/orders', '/guest-orders'];
// Pages where the cart shortcut would duplicate or cover the main task.
const NO_FLOATING_CART = ['/cart', '/checkout', '/orders', '/guest-orders', '/login', '/register', '/forgot-password'];

export default function Layout() {
  const { pathname } = useLocation();
  const { lines } = useCart();
  const { pickerOpen } = useHostel();
  const showFloatingCart = lines.length > 0 && !NO_FLOATING_CART.some((p) => pathname.startsWith(p));
  const tinted = TINTED.some((p) => pathname.startsWith(p));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app app--floating-actions">
      <PreviewBanner />
      <Navbar />
      <main className={`main${tinted ? ' main--tinted' : ''}`}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <Footer />
      <FloatingViewCart visible={showFloatingCart} />
      <WhatsAppButton />
      {pickerOpen && <HostelPicker variant="modal" />}
    </div>
  );
}
