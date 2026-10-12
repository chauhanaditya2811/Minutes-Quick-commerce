/** SAMPLE ORDERS ONLY. No order-listing endpoint exists yet; replace with a real API call. */
import type { OrderSummary } from '../types/order';

export const mockOrders: OrderSummary[] = [
  {
    id: 'sample-1043', status: 'DELIVERED', paymentStatus: 'SUCCESS', total: 150, createdAt: '2026-10-08T21:14:00+05:30',
    items: [{ name: 'Maggi Masala Noodles', quantity: 2, price: 56 }, { name: 'Packaged Water', quantity: 1, price: 20 }, { name: 'Delivery', quantity: 1, price: 10 }].slice(0, 2),
  },
  {
    id: 'sample-1051', status: 'CONFIRMED', paymentStatus: 'SUCCESS', total: 94, createdAt: '2026-10-11T08:02:00+05:30',
    items: [{ name: 'Toned Milk', quantity: 2, price: 30 }, { name: 'Bananas', quantity: 1, price: 40 }].slice(0, 2),
  },
  { id: 'sample-1055', status: 'PENDING_PAYMENT', paymentStatus: 'CREATED', total: 64, createdAt: '2026-10-12T07:40:00+05:30' },
];
