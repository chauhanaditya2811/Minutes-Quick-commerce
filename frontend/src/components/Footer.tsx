import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__card">
          <div className="footer__intro">
            <h2>Minutes</h2>
            <p>Everyday essentials, delivered to your hostel.</p>
          </div>
          <div className="footer__divider" />
          <nav className="footer__links" aria-label="Footer">
          <section aria-labelledby="footer-help">
            <h2 id="footer-help">Help &amp; Support</h2>
            <a href="mailto:caditya2811@gmail.com">Contact Support — caditya2811@gmail.com</a>
            <Link to="/delivery-policy">Delivery Policy</Link>
            <Link to="/cancellation-refund">Cancellation &amp; Refund Policy</Link>
          </section>
          <div className="footer__divider" />
          <section aria-labelledby="footer-legal">
            <h2 id="footer-legal">Legal</h2>
            <Link to="/terms">Terms &amp; Conditions</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </section>
          </nav>
          <div className="footer__divider" />
          <p className="footer__copyright">© 2026 Minutes. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
