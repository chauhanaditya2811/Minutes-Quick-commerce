import { createBrowserRouter } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import PrivateRoute from './PrivateRoute';
import AdminRoute from './AdminRoute';
import HomePage from '../pages/home/HomePage';
import ProductDetailsPage from '../pages/products/ProductDetailsPage';
import CartPage from '../pages/cart/CartPage';
import CheckoutPage from '../pages/checkout/CheckoutPage';
import OrderConfirmationPage from '../pages/orders/OrderConfirmationPage';
import OrdersPage from '../pages/orders/OrdersPage';
import AccountPage from '../pages/account/AccountPage';
import AuthPage from '../pages/auth/AuthPage';
import DashboardPage from '../pages/dashboard/DashboardPage';
import NotFoundPage from '../pages/NotFoundPage';
import { CancellationRefundPage, ContactPage, DeliveryPolicyPage, PrivacyPage, TermsPage } from '../pages/support/PolicyPages';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/products/:id', element: <ProductDetailsPage /> },
      { path: '/cart', element: <CartPage /> },
      { path: '/login', element: <AuthPage mode="login" /> },
      { path: '/register', element: <AuthPage mode="register" /> },
      { path: '/forgot-password', element: <AuthPage mode="reset-password" /> },
      { path: '/contact', element: <ContactPage /> },
      { path: '/delivery-policy', element: <DeliveryPolicyPage /> },
      { path: '/cancellation-refund', element: <CancellationRefundPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/account', element: <PrivateRoute><AccountPage /></PrivateRoute> },
      { path: '/checkout', element: <PrivateRoute><CheckoutPage /></PrivateRoute> },
      { path: '/orders', element: <PrivateRoute><OrdersPage /></PrivateRoute> },
      { path: '/orders/:orderId/confirmation', element: <PrivateRoute><OrderConfirmationPage /></PrivateRoute> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/admin', element: <AdminRoute><DashboardPage /></AdminRoute> },
]);
