import type { Product } from '../../types/product';
import ProductCard from './ProductCard';

export default function ProductGrid({ products, storeOpen }: { products: Product[]; storeOpen: boolean }) {
  return (
    <div className="grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} storeOpen={storeOpen} />
      ))}
    </div>
  );
}
