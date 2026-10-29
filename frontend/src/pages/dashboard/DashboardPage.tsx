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

type TabId = (typeof TABS)[number]['id'];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabId>('products');
  const [stockDirty, setStockDirty] = useState(false);

  // Leaving Stock management unmounts it, so confirm before discarding unsaved edits.
  const goTo = (next: TabId) => {
    if (next === tab) return;
    if (tab === 'stock' && stockDirty && !window.confirm('You have unsaved stock changes. Leave without saving?')) return;
    setStockDirty(false);
    setTab(next);
  };

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' tab--on' : ''}`} onClick={() => goTo(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'products' && <ProductManager onGoToHostels={() => goTo('hostels')} onManageStock={() => goTo('stock')} />}
      {tab === 'stock' && (
        <StockManager onGoToProducts={() => goTo('products')} onGoToHostels={() => goTo('hostels')} onDirtyChange={setStockDirty} />
      )}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'orders' && <OrdersShell />}
      {tab === 'hostels' && <HostelManager />}
    </div>
  );
}
