import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { HostelProvider } from './context/HostelContext';
import { router } from './routers/router';
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <HostelProvider>
        <CartProvider>
          <RouterProvider router={router} />
        </CartProvider>
      </HostelProvider>
    </AuthProvider>
  );
}
