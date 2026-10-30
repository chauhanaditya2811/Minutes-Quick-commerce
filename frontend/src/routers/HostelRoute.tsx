import type { ReactNode } from 'react';
import { useHostel } from '../context/HostelContext';
import HostelPicker from '../components/hostel/HostelPicker';

/**
 * Store routes need a pool (where the customer shops). Without one, the picker renders in place (no redirect),
 * so direct links and refreshes continue to the requested page once a hostel is chosen.
 * UX guard only: the backend scopes products and orders to a hostel on every request.
 */
export default function HostelRoute({ children }: { children: ReactNode }) {
  const { selectedPool } = useHostel();
  if (!selectedPool) return <HostelPicker variant="page" />;
  return <>{children}</>;
}
