import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import type { Product } from '../../types/product';

/** Matches the exit keyframes in App.css (collapse, then drop). */
const EXIT_MS = 420;
/** Centre of the photo from the pill's left edge: 7px padding + half of the 46px photo. */
const PHOTO_CENTER_PX = 30;

interface Snapshot {
  latest: Product;
  units: number;
  subtotal: number;
}

/**
 * Floating bottom-center shortcut to the cart page. On entry a circle holding the latest
 * product rises at the bottom centre, then the pill opens out of it in both directions while
 * the photo slides to its place on the left; on exit it closes back into the centred circle
 * and drops away. Layout decides when it should be visible.
 */
export default function FloatingViewCart({ visible }: { visible: boolean }) {
  const { lines, subtotal } = useCart();
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'hidden'>(visible ? 'shown' : 'hidden');
  // Keep the last contents so the exit animation can play after the cart empties.
  const snapshot = useRef<Snapshot | null>(null);
  const pill = useRef<HTMLAnchorElement>(null);
  if (visible && lines.length > 0) {
    snapshot.current = {
      latest: lines[lines.length - 1].product,
      units: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal,
    };
  }

  useEffect(() => {
    if (visible) {
      setPhase('shown');
      return;
    }
    setPhase((p) => (p === 'shown' ? 'leaving' : p));
    const timer = setTimeout(() => setPhase('hidden'), EXIT_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  // How far the photo sits from the pill's centre; the CSS animations slide it between the two.
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el) return;
    const measure = () => el.style.setProperty('--fc-shift', `${el.offsetWidth / 2 - PHOTO_CENTER_PX}px`);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  if (phase === 'hidden' || !snapshot.current) return null;

  const { latest, units, subtotal: total } = snapshot.current;
  const leaving = phase === 'leaving';
  const itemsLabel = `${units} ${units === 1 ? 'item' : 'items'}`;
  return (
    <div className={`floating-cart${leaving ? ' floating-cart--leaving' : ''}`} aria-hidden={leaving || undefined}>
      <div className="floating-cart__lift">
        <Link
          ref={pill}
          to="/cart"
          className="floating-cart__btn"
          tabIndex={leaving ? -1 : undefined}
          aria-label={`View cart, ${itemsLabel}, total ${formatINR(total)}`}
        >
          {/* The slot carries the centre-to-left slide and is never remounted; only the photo
              inside it is keyed, so a newly added product just pops in where it already is. */}
          <span className="floating-cart__photo" aria-hidden="true">
            <span key={latest.id} className="floating-cart__thumb">
              <img src={latest.imageUrl} alt="" />
            </span>
          </span>
          <span className="floating-cart__text" aria-hidden="true">
            <span className="floating-cart__title">View cart</span>
            <span key={units} className="floating-cart__sub">{itemsLabel} · {formatINR(total)}</span>
          </span>
          <span className="floating-cart__chevron" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        </Link>
      </div>
    </div>
  );
}
