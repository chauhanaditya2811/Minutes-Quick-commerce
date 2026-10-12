import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <span>©{new Date().getFullYear()} Minutes. Hostel essentials, delivered to your room.</span>
        <nav aria-label="Footer">
          <Link to="/">Shop</Link>
          <Link to="/orders">Orders</Link>
          <Link to="/account">Account</Link>
        </nav>
      </div>
    </footer>
  );
}
