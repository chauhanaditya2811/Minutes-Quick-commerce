import { useState } from 'react';
import ProductManager from '../../components/admin/ProductManager';
import SettingsPanel from '../../components/admin/SettingsPanel';
import OrdersShell from '../../components/admin/OrdersShell';
import HostelManager from '../../components/admin/HostelManager';

const TABS = [
  { id: 'products', label: 'Products' },
  { id: 'settings', label: 'Store settings' },
  { id: 'orders', label: 'Orders' },
  { id: 'hostels', label: 'Hostels' },
] as const;

export default function DashboardPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('products');
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
      {tab === 'products' && <ProductManager />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'orders' && <OrdersShell />}
      {tab === 'hostels' && <HostelManager />}
    </div>
  );
}
