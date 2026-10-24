import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStoreSettings } from '../../hooks/useStoreSettings';

const SUPPORT_EMAIL = 'caditya2811@gmail.com';

function PolicyPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page page--narrow policy-page">
      <h1>{title}</h1>
      <div className="panel policy-page__content">{children}</div>
      <Link to="/" className="btn btn--yellow">Continue Shopping</Link>
    </div>
  );
}

function SupportEmail() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

export function ContactPage() {
  const { data: settings } = useStoreSettings();
  const configuredSupportEmail = settings?.supportEmail?.trim();
  const showConfiguredEmail = configuredSupportEmail && configuredSupportEmail !== SUPPORT_EMAIL;

  return (
    <PolicyPage title="Contact & Support">
      <p>Minutes is a small beta app for friends in supported university hostels. For help, email <SupportEmail />.</p>
      <p>Contact us about login problems, order status, delivery delays, missing items, incorrect or damaged products, cancellations, or refunds.</p>
      {showConfiguredEmail && <p className="muted small">The store&apos;s configured support contact is <a href={`mailto:${configuredSupportEmail}`}>{configuredSupportEmail}</a>.</p>}
    </PolicyPage>
  );
}

export function DeliveryPolicyPage() {
  return (
    <PolicyPage title="Delivery Policy">
      <p>Minutes currently serves eligible university hostel addresses supported by the application.</p>
      <p>Orders can be placed only while the store is open. Product availability, delivery fees, and minimum order requirements are shown from the current store settings and checkout information.</p>
      <p>Delivery estimates can vary with order volume, product availability, and fulfilment conditions. A five-minute delivery label, when displayed, is an estimate rather than an unconditional guarantee.</p>
      <p>If your order is delayed, incomplete, or undelivered, please contact <SupportEmail />.</p>
    </PolicyPage>
  );
}

export function CancellationRefundPage() {
  return (
    <PolicyPage title="Cancellation & Refund Policy">
      <p>To request an order cancellation, contact <SupportEmail /> as soon as possible. Requests are handled manually and depend on the order&apos;s progress.</p>
      <p>A cancellation may not be possible once an order has already been fulfilled or delivered.</p>
      <p>If Minutes cannot fulfil a paid order, or an eligible refund is approved, we will explain the next steps. Approved refunds are processed through the supported payment-provider process where applicable, and processing times can vary.</p>
      <p>Please contact support if payment succeeds but an order remains unconfirmed, or if a delivered order is missing, incorrect, or damaged.</p>
    </PolicyPage>
  );
}

export function TermsPage() {
  return (
    <PolicyPage title="Terms & Conditions">
      <p>Minutes is currently a beta application intended for a limited university-hostel audience.</p>
      <p>Customers must provide accurate contact and delivery details. Product availability, prices, delivery fees, and minimum-order requirements are based on the information shown in the app and validated by the backend.</p>
      <p>Orders are subject to store availability and successful payment verification. Returning from Cashfree Checkout alone does not mean that an order has been confirmed.</p>
      <p>Please contact <SupportEmail /> if an order or payment problem occurs. Do not misuse the application or attempt to access another customer&apos;s account or orders.</p>
    </PolicyPage>
  );
}

export function PrivacyPage() {
  return (
    <PolicyPage title="Privacy Policy">
      <p>Minutes processes the information needed to run the app and fulfil orders. This can include sign-in details associated with Google or email/password authentication; your name, email, profile image where available, phone number, hostel, floor, and room; and cart and order information.</p>
      <p>We also process order totals, payment status, and transaction references needed to verify payments. Minutes does not store card numbers, UPI PINs, or payment passwords.</p>
      <p>Firebase Authentication provides sign-in. The Minutes backend and PostgreSQL database store application, profile, and order data. Cashfree processes payments. Product images are hosted through Cloudinary.</p>
      <p>For questions or requests about your information, contact <SupportEmail />.</p>
    </PolicyPage>
  );
}
