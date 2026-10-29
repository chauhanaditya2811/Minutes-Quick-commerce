import { useEffect, useState, type FormEvent } from 'react';
import { api, type AdminHostel } from '../../services/api';
import Field from '../ui/Field';
import Loading from '../Loading';
import Notice from '../ui/Notice';

export default function HostelManager() {
  const [hostels, setHostels] = useState<AdminHostel[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const load = async () => {
    try { setHostels(await api.getAdminHostels()); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load hostels.' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const add = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    try { await api.createHostel(name); setName(''); await load(); setNotice({ tone: 'success', text: 'Hostel saved.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save hostel.' }); }
    finally { setBusy(false); }
  };
  const deactivate = async (hostel: AdminHostel) => {
    if (!window.confirm(`Deactivate ${hostel.name}? It will be hidden from customers, and anyone shopping there will be asked to choose another hostel. Its stock is kept.`)) return;
    setBusy(true); setNotice(null);
    try { await api.deactivateHostel(hostel.id); await load(); setNotice({ tone: 'success', text: 'Hostel deactivated.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not deactivate hostel.' }); }
    finally { setBusy(false); }
  };
  const activate = async (hostel: AdminHostel) => {
    setBusy(true); setNotice(null);
    try { await api.activateHostel(hostel.id); await load(); setNotice({ tone: 'success', text: 'Hostel activated. Customers can now choose it and see the products you have made available there.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not activate hostel.' }); }
    finally { setBusy(false); }
  };
  const permanentlyDelete = async (hostel: AdminHostel) => {
    if (!window.confirm(`Permanently delete "${hostel.name}"? This cannot be undone and removes its product stock. Hostels with assigned users or orders cannot be deleted.`)) return;
    setBusy(true); setNotice(null);
    try { await api.permanentlyDeleteHostel(hostel.id); await load(); setNotice({ tone: 'success', text: 'Hostel permanently deleted.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not delete hostel.' }); }
    finally { setBusy(false); }
  };
  if (loading) return <Loading />;
  return <section className="panel hostel-manager"><h2>Hostels</h2><p className="muted small">Active hostels are offered to customers when they choose where to shop. Set each product’s stock per hostel from the Products tab.</p><form className="form hostel-manager__form" onSubmit={add}><Field label="Add hostel" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Block C" /><button className="btn btn--blue" disabled={busy}>{busy ? 'Saving…' : 'Add hostel'}</button></form>{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}<div className="hostel-list">{hostels.map((hostel) => <article className={`hostel-card${hostel.isActive ? '' : ' hostel-card--inactive'}`} key={hostel.id}><div className="hostel-card__details"><strong>{hostel.name}</strong><p>{hostel.isActive ? 'Active' : 'Inactive'}</p></div><div className="hostel-card__actions">{hostel.isActive ? <button type="button" className="btn btn--red btn--sm" disabled={busy} onClick={() => void deactivate(hostel)}>Deactivate</button> : <button type="button" className="btn btn--blue btn--sm" disabled={busy} onClick={() => void activate(hostel)}>Activate</button>}<button type="button" className="btn btn--outline btn--sm hostel-card__delete" disabled={busy} onClick={() => void permanentlyDelete(hostel)}>Delete</button></div></article>)}{hostels.length === 0 && <p className="muted">No hostels yet.</p>}</div></section>;
}
