import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

export default function ProductGridSkeleton() {
  return (
    <SkeletonTheme
      baseColor="#e5e7eb"
      highlightColor="#f9fafb"
      duration={1.2}
    >
      <div
        className="grid product-skeleton-grid"
        role="status"
        aria-label="Loading products"
      >
        <span className="sr-only">Loading products...</span>

        {Array.from({ length: 8 }, (_, index) => (
          <article
            className="card product-skeleton-card"
            key={index}
            aria-hidden="true"
          >
            <div className="card__media product-skeleton-card__media">
              <Skeleton width="100%" height="100%" borderRadius={0} />
            </div>

            <div className="card__body product-skeleton-card__body">
              <Skeleton width="75%" height={18} />

              <Skeleton width="90%" height={12} />

              <Skeleton width="35%" height={12} />

              <div className="product-skeleton-card__price">
                <Skeleton width="45%" height={16} />
              </div>

              <Skeleton
                containerClassName="product-skeleton-card__button"
                width="100%"
                height={40}
                borderRadius={6}
              />
            </div>
          </article>
        ))}
      </div>
    </SkeletonTheme>
  );
}