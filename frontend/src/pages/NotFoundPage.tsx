import { Link } from 'react-router-dom';
import EmptyState from '../components/ui/EmptyState';

export default function NotFoundPage() {
  return (
    <EmptyState title="Page not found">
      <p>That page doesn't exist or has moved.</p>
      <Link to="/" className="btn btn--yellow">Back to shop</Link>
    </EmptyState>
  );
}
