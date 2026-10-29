import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

export default function ProductDetailsSkeleton() {
  return (
    <SkeletonTheme
      baseColor="#e5e7eb"
      highlightColor="#f9fafb"
      duration={1.2}
    >
      <div className="page">
        <p className="crumbs">
          <Skeleton width={45} /> / <Skeleton width={120} />
        </p>

        <div className="detail product-detail-skeleton">
          <div
            className="detail__media product-detail-skeleton__media"
            aria-hidden="true"
          >
            <Skeleton width="100%" height="100%" borderRadius={8} />
          </div>

          <div className="detail__info">
            <Skeleton width="75%" height={30} />
            <Skeleton width={65} height={16} />
            <Skeleton width={115} height={28} />

            <Skeleton width={90} height={20} borderRadius={6} />

            <div className="product-detail-skeleton__description">
              <Skeleton count={2} height={14} />
            </div>

            <div className="detail__cta">
              <Skeleton width={150} height={44} borderRadius={6} />
            </div>
          </div>
        </div>

        <p className="sr-only" role="status">
          Loading product details...
        </p>
      </div>
    </SkeletonTheme>
  );
}