import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProducts } from '../../hooks/useProducts';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { useHostel } from '../../context/HostelContext';
import { formatINR } from '../../utils/format';
import ProductGrid from '../../components/products/ProductGrid';
//import Loading from '../../components/Loading';
import Notice from '../../components/ui/Notice';
import StoreClosedBanner from '../../components/StoreClosedBanner';
import NotServingToday from '../../components/NotServingToday';
import EmptyState from '../../components/ui/EmptyState';
import ProductGridSkeleton from '../../components/skeletons/ProductGridSkeleton';
import { ChatIcon } from '../../components/ui/Icons';

export default function HomePage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const { selectedPool, pools, openPicker } = useHostel();
  const { data: products, loading, error, reload } = useProducts(selectedPool?.id);
  const { data: settings, loading: settingsLoading, error: settingsError, reload: reloadSettings } = useStoreSettings();

  const visible = useMemo(
    () =>
      (products ?? []).filter(
        (p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      ),
    [products, q],
  );
  // Nothing in stock here (or no products at all): one clear message instead of a grid of sold-out cards.
  const soldOut = Boolean(selectedPool) && !loading && !error && products !== null && products.every((p) => p.stock <= 0);
  const storeOpen = settings?.storeOpen ?? true;

  return (
    <div className="page">
      <div className="page__head">
        <h1>Available at {selectedPool?.name}</h1>
        {settings && (
          <p className="muted">
            {!settings.storeOpen ? 'Closed' : soldOut ? 'Not serving today' : 'Open now'} · Delivery {formatINR(settings.deliveryFee)} · Minimum order {formatINR(settings.minimumOrder)}
          </p>
        )}
        {settingsLoading && <p className="muted">Loading store information…</p>}
      </div>

      {settingsError && (
        <Notice tone="error">
          Could not load store information: {settingsError} <button type="button" className="link-btn" onClick={reloadSettings}>Try again</button>
        </Notice>
      )}
      {settings && !settings.storeOpen && <StoreClosedBanner />}

   {loading && <ProductGridSkeleton />}
      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {soldOut && storeOpen && (
        <NotServingToday placeName={selectedPool?.name ?? 'your hostel'} onChangePlace={pools.length > 1 ? openPicker : undefined} />
      )}
      {!loading && !error && !soldOut && visible.length === 0 && (
        <EmptyState title={q ? `No results for "${params.get('q')}"` : `No products available at ${selectedPool?.name} yet`}>
          <p>{q ? 'Try a different word.' : 'Check back soon, or try another hostel.'}</p>
          {!q && <button type="button" className="btn btn--yellow" onClick={openPicker}>Change hostel</button>}
        </EmptyState>
      )}
      {!loading && !soldOut && visible.length > 0 && <ProductGrid products={visible} storeOpen={settings?.storeOpen ?? false} />}
      {!loading && !error && !q && !soldOut && products && (
        <Link to="/feedback" className="request-cta">
          <span className="request-cta__icon" aria-hidden="true"><ChatIcon width={20} height={20} /></span>
          <span className="request-cta__text">
            <strong>Didn’t find what you need?</strong>
            <span>Request a product and we’ll try to stock it.</span>
          </span>
          <span className="request-cta__action">Request it <span aria-hidden="true">→</span></span>
        </Link>
      )}
    </div>
  );
}
