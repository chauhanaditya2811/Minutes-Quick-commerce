import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';

export default function OrdersPageSkeleton() {
  return (
    <SkeletonTheme
      baseColor="#e5e7eb"
      highlightColor="#f9fafb"
      duration={1.2}
    >
      <div className="page page--narrow">
        <h1>My Orders</h1>

        <p className="sr-only" role="status">
          Loading your orders...
        </p>

        <ul className="orders orders-skeleton-list" aria-hidden="true">
          {Array.from({ length: 2 }, (_, orderIndex) => (
            <li className="panel orders__item" key={orderIndex}>
              <div className="orders__top">
                <Skeleton width={120} height={18} />
                <Skeleton width={85} height={14} />
              </div>

              <div className="orders__statuses">
                <Skeleton width={90} height={26} borderRadius={6} />
                <Skeleton width={125} height={26} borderRadius={6} />
              </div>

              <ul className="summary-list">
                {Array.from({ length: 3 }, (_, itemIndex) => (
                  <li className="orders__line-item" key={itemIndex}>
                    <span className="summary-list__name">
                      <Skeleton width="65%" height={15} />
                      <small>
                        <Skeleton width={145} height={12} />
                      </small>
                    </span>

                    <span className="orders__line-total">
                      <Skeleton width={55} height={15} />
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="totals">
                {['Items', 'Delivery', 'Total'].map((label) => (
                  <div key={label}>
                    <dt><Skeleton width={65} height={14} /></dt>
                    <dd><Skeleton width={55} height={14} /></dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonTheme>
  );
}