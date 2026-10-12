import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from '../Navbar';
import Footer from '../Footer';
import PreviewBanner from './PreviewBanner';

const TINTED = ['/checkout', '/account', '/orders'];

export default function Layout() {
  const { pathname } = useLocation();
  const tinted = TINTED.some((p) => pathname.startsWith(p));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <PreviewBanner />
      <Navbar />
      <main className={`main${tinted ? ' main--tinted' : ''}`}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
}
