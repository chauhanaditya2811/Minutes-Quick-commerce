import { createBrowserRouter } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import PrivateRoute from './PrivateRoute';
import AdminRoute from './AdminRoute';
import HostelRoute from './HostelRoute';
import HomePage from '../pages/home/HomePage';
import ProductDetailsPage from '../pages/products/ProductDetailsPage';
import CartPage from '../pages/cart/CartPage';
import CheckoutPage from '../pages/checkout/CheckoutPage';
import OrderConfirmationPage from '../pages/orders/OrderConfirmationPage';
import GuestOrderPage from '../pages/orders/GuestOrderPage';
import OrdersPage from '../pages/orders/OrdersPage';
import AccountPage from '../pages/account/AccountPage';
import AuthPage from '../pages/auth/AuthPage';
import DashboardPage from '../pages/dashboard/DashboardPage';
import FeedbackPage from '../pages/feedback/FeedbackPage';
import NotFoundPage from '../pages/NotFoundPage';
import { CancellationRefundPage, ContactPage, DeliveryPolicyPage, PrivacyPage, TermsPage } from '../pages/support/PolicyPages';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HostelRoute><HomePage /></HostelRoute> },
      { path: '/products/:id', element: <HostelRoute><ProductDetailsPage /></HostelRoute> },
      { path: '/cart', element: <HostelRoute><CartPage /></HostelRoute> },
      // Product requests are per hostel; general feedback is sent with the hostel for context.
      { path: '/feedback', element: <HostelRoute><FeedbackPage /></HostelRoute> },
      { path: '/login', element: <AuthPage mode="login" /> },
      { path: '/register', element: <AuthPage mode="register" /> },
      { path: '/forgot-password', element: <AuthPage mode="reset-password" /> },
      { path: '/contact', element: <ContactPage /> },
      { path: '/delivery-policy', element: <DeliveryPolicyPage /> },
      { path: '/cancellation-refund', element: <CancellationRefundPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/account', element: <PrivateRoute><AccountPage /></PrivateRoute> },
      // Open to guests: CheckoutPage uses the signed-in flow when an account is signed in.
      { path: '/checkout', element: <HostelRoute><CheckoutPage /></HostelRoute> },
      { path: '/orders', element: <PrivateRoute><OrdersPage /></PrivateRoute> },
      { path: '/orders/:orderId/confirmation', element: <PrivateRoute><OrderConfirmationPage /></PrivateRoute> },
      // Guest order page: opened with the order's secret token, not an account.
      { path: '/guest-orders/:orderId', element: <GuestOrderPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/admin', element: <AdminRoute><DashboardPage /></AdminRoute> },
]);
