import { Link } from 'react-router-dom';

interface Props {
  /** The pool (hostel or group of hostels) the customer is shopping from. */
  placeName: string;
  /** Offered only when there is another pool to switch to. */
  onChangePlace?: (() => void) | undefined;
}

/** Shown instead of the product grid when nothing at the selected pool is in stock. */
export default function NotServingToday({ placeName, onChangePlace }: Props) {
  return (
    <section className="store-closed not-serving" role="status" aria-live="polite">
      <div className="store-closed__icon" aria-hidden="true">📦</div>
      <h2 className="store-closed__title">Sorry, we’re not serving {placeName} today</h2>
      <p className="store-closed__subtitle not-serving__subtitle">Everything here is sold out for now.</p>
      <p className="store-closed__text">
        We’re restocking and will be back soon. Thanks for your patience. If there’s something you need, tell us and we’ll try to have it
        ready for your next order.
      </p>
      <Link to="/feedback" className="btn store-closed__call">Request a product</Link>
      {onChangePlace && (
        <button type="button" className="link-btn not-serving__switch" onClick={onChangePlace}>
          Shop from another hostel
        </button>
      )}
    </section>
  );
}
