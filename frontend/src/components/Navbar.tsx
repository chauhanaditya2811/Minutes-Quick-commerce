import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useHostel } from '../context/HostelContext';
import { CartIcon, ChevronDownIcon, MenuIcon, PinIcon, SearchIcon, UserIcon } from './ui/Icons';

export default function Navbar() {
  const { firebaseUser, profile, signOut, loading: authLoading } = useAuth();
  const { itemCount } = useCart();
  const { selectedHostel, openPicker } = useHostel();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const query = pathname === '/' ? (params.get('q') ?? '') : '';
  const returnTo = ['/login', '/register', '/forgot-password'].includes(pathname) ? '/' : `${pathname}${search}`;
  const avatar = profile?.profileImage ?? firebaseUser?.photoURL ?? null;

  // Close the menu on navigation, outside click, and Escape.
  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen && !profileOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, profileOpen]);

  const onSearch = (value: string) => {
    const q = value ? `?q=${encodeURIComponent(value)}` : '';
    navigate(`/${q}`, { replace: pathname === '/' });
  };

  return (
    <header className="navbar">
      <div className="container navbar__inner">
        <div className="navbar__menu" ref={menuRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MenuIcon width={26} height={26} />
          </button>
          {menuOpen && (
            <div className="dropdown" role="menu">
              <Link role="menuitem" to="/" onClick={() => setMenuOpen(false)}>Shop</Link>
              <Link role="menuitem" to="/orders" onClick={() => setMenuOpen(false)}>My Orders</Link>
              <Link role="menuitem" to="/cart" onClick={() => setMenuOpen(false)}>Shopping Cart</Link>
              <Link role="menuitem" to="/feedback" onClick={() => setMenuOpen(false)}>Feedback</Link>
            </div>
          )}
        </div>

        <Link to="/" className="navbar__brand" aria-label="Minutes home">Minutes</Link>

        <button
          type="button"
          className="hostel-chip"
          onClick={openPicker}
          aria-label={selectedHostel ? `Delivering to ${selectedHostel.name}. Change hostel` : 'Select your hostel'}
        >
          <PinIcon width={16} height={16} className="hostel-chip__pin" />
          <span className="hostel-chip__text">
            <span className="hostel-chip__label">{selectedHostel ? 'Delivering to' : 'Select hostel'}</span>
            {selectedHostel && <span className="hostel-chip__name">{selectedHostel.name}</span>}
          </span>
          <ChevronDownIcon width={14} height={14} />
        </button>

        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <SearchIcon width={16} height={16} />
          <input
            type="search"
            placeholder="Search here"
            aria-label="Search products"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
          />
        </form>

        <nav className="navbar__links" aria-label="Primary">
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>

        <div className="navbar__account" ref={profileRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label={firebaseUser ? 'Your account menu' : 'Login menu'}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            onClick={() => {
              setProfileError(null);
              setProfileOpen((o) => !o);
            }}
          >
            {avatar ? (
              <span className="navbar__avatar">
                <img className="navbar__avatar-image" src={avatar} alt="" referrerPolicy="no-referrer" />
              </span>
            ) : firebaseUser ? (
              <span className="navbar__avatar navbar__avatar--default" aria-hidden="true" />
            ) : (
              <UserIcon width={26} height={26} />
            )}
          </button>
          {profileOpen && (
            <div className="dropdown dropdown--right" role="menu">
              {authLoading ? (
                <span className="dropdown__status" role="status">Checking account…</span>
              ) : firebaseUser ? (
                <>
                  <Link role="menuitem" to="/account" onClick={() => setProfileOpen(false)}>My Account</Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      void signOut().then(() => navigate('/')).catch((error: unknown) => {
                        setProfileOpen(true);
                        setProfileError(error instanceof Error ? error.message : 'Could not sign out. Please try again.');
                      });
                    }}
                  >
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  role="menuitem"
                  to="/login"
                  state={{ from: returnTo }}
                  onClick={() => setProfileOpen(false)}
                >
                  Login
                </Link>
              )}
              {profileError && <p className="dropdown__error" role="alert">{profileError}</p>}
            </div>
          )}
        </div>

        <Link to="/cart" className="cart-btn" aria-label={`Cart, ${itemCount} items`}>
          <CartIcon width={17} height={17} />
          <span>{itemCount}</span>
        </Link>
      </div>
      <button type="button" className="hostel-bar" onClick={openPicker}>
        <span className="container hostel-bar__inner">
          <PinIcon width={15} height={15} className="hostel-chip__pin" />
          <span className="hostel-bar__text">
            {selectedHostel ? <>Delivering to <strong>{selectedHostel.name}</strong></> : 'Select your hostel'}
          </span>
          <ChevronDownIcon width={14} height={14} />
        </span>
      </button>
    </header>
  );
}
