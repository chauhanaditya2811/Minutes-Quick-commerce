import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProducts } from '../../hooks/useProducts';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { formatINR } from '../../utils/format';
import ProductGrid from '../../components/products/ProductGrid';
//import Loading from '../../components/Loading';
import Notice from '../../components/ui/Notice';
import EmptyState from '../../components/ui/EmptyState';
import ProductGridSkeleton from '../../components/skeletons/ProductGridSkeleton';

export default function HomePage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const { data: products, loading, error, reload } = useProducts();
  const { data: settings, loading: settingsLoading, error: settingsError, reload: reloadSettings } = useStoreSettings();

  const visible = useMemo(
    () =>
      (products ?? []).filter(
        (p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      ),
    [products, q],
  );

  return (
    <div className="page">
      <div className="page__head">
        <h1>Hostel essentials</h1>
        {settings && (
          <p className="muted">
            {settings.storeOpen ? 'Open now' : 'Closed'} · Delivery {formatINR(settings.deliveryFee)} · Minimum order {formatINR(settings.minimumOrder)}
          </p>
        )}
        {settingsLoading && <p className="muted">Loading store information…</p>}
      </div>

      {settingsError && (
        <Notice tone="error">
          Could not load store information: {settingsError} <button type="button" className="link-btn" onClick={reloadSettings}>Try again</button>
        </Notice>
      )}
      {settings && !settings.storeOpen && (
        <Notice tone="warning">The store is closed right now. You can browse, but ordering is paused.</Notice>
      )}

   {loading && <ProductGridSkeleton />}
      {error && (
        <Notice tone="error">
          {error} <button type="button" className="link-btn" onClick={reload}>Try again</button>
        </Notice>
      )}
      {!loading && !error && visible.length === 0 && (
        <EmptyState title={q ? `No results for "${params.get('q')}"` : 'No products yet'}>
          <p>{q ? 'Try a different word.' : 'Check back soon.'}</p>
        </EmptyState>
      )}
      {!loading && visible.length > 0 && <ProductGrid products={visible} storeOpen={settings?.storeOpen ?? false} />}
    </div>
  );
}
