import { useState } from 'react';
import ProductManager from '../../components/admin/ProductManager';
import SettingsPanel from '../../components/admin/SettingsPanel';
import OrdersShell from '../../components/admin/OrdersShell';
import HostelManager from '../../components/admin/HostelManager';
import StockManager from '../../components/admin/StockManager';

const TABS = [
  { id: 'products', label: 'Products' },
  { id: 'stock', label: 'Stock management' },
  { id: 'settings', label: 'Store settings' },
  { id: 'orders', label: 'Orders' },
  { id: 'hostels', label: 'Hostels' },
] as const;

export default function DashboardPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('products');
  const [stockFocus, setStockFocus] = useState<string | null>(null);
  const manageStock = (productId: string) => {
    setStockFocus(productId);
    setTab('stock');
  };
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' tab--on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'products' && <ProductManager onGoToHostels={() => setTab('hostels')} onManageStock={manageStock} />}
      {tab === 'stock' && (
        <StockManager focusProductId={stockFocus} onGoToProducts={() => setTab('products')} onGoToHostels={() => setTab('hostels')} />
      )}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'orders' && <OrdersShell />}
      {tab === 'hostels' && <HostelManager />}
    </div>
  );
}
