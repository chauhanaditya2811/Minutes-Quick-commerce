import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type AdminHostel } from '../../services/api';
import type { StockGroup } from '../../types/product';
import Field from '../ui/Field';
import Loading from '../Loading';
import Notice from '../ui/Notice';
import { BuildingIcon, SearchIcon } from '../ui/Icons';

type NoticeState = { tone: 'success' | 'error'; text: string } | null;

interface Props {
  /** Opens Stock management on this pool. */
  onManageStock: (poolId: string) => void;
}

const NEW_POOL = '__new';
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * Pools & hostels. A pool is one stock (one shelf); every hostel sells from exactly one pool,
 * and hostels in the same pool share its stock. Customers only ever see hostels.
 */
export default function PoolManager({ onManageStock }: Props) {
  const [hostels, setHostels] = useState<AdminHostel[]>([]);
  const [pools, setPools] = useState<StockGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [hostelList, poolList] = await Promise.all([api.getAdminHostels(), api.getStockGroups()]);
      setHostels(hostelList);
      setPools(poolList);
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, 'Could not load pools and hostels.') });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** Runs one admin change, reloads, and reports the outcome. Returns whether it worked. */
  const run = async (work: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await load();
      setNotice({ tone: 'success', text: success });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, failure) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const hostelsById = useMemo(() => new Map(hostels.map((h) => [h.id, h])), [hostels]);
  // Shared pools first, then one-hostel pools, then unused ones; each group A to Z.
  const sortedPools = useMemo(() => {
    const rank = (p: StockGroup) => (p.hostels.length > 1 ? 0 : p.hostels.length === 1 ? 1 : 2);
    return [...pools].sort((a, b) => rank(a) - rank(b) || byName.compare(a.name, b.name));
  }, [pools]);
  const q = query.trim().toLowerCase();
  const visiblePools = q
    ? sortedPools.filter((p) => p.name.toLowerCase().includes(q) || p.hostels.some((h) => h.name.toLowerCase().includes(q)))
    : sortedPools;

  if (loading) return <Loading />;

  return (
    <section className="panel pools">
      <div className="pools__head">
        <div>
          <h2>Pools &amp; hostels</h2>
          <p className="muted small">
            A pool is one stock. Every hostel sells from one pool, and hostels in the same pool share its stock.
            <strong> Customers choose a pool by its name first</strong> (so name it the way students would, e.g. “Boys’ Hostels”), then pick their exact hostel at checkout.
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn btn--yellow btn--sm" disabled={busy} onClick={() => { setNotice(null); setCreating(true); }}>
            + New pool
          </button>
        )}
      </div>

      {creating && (
        <NewPoolForm
          hostels={hostels}
          pools={pools}
          busy={busy}
          error={notice?.tone === 'error' ? notice.text : null}
          onCancel={() => { setCreating(false); setNotice(null); }}
          onCreate={async (name, hostelIds, copyFrom) => {
            const copied = copyFrom ? hostelsById.get(copyFrom)?.name : null;
            const ok = await run(
              () => api.createStockGroup(name, hostelIds, copyFrom ?? undefined),
              copied
                ? `${name} created with ${copied}’s stock as a starting point. Check the counts in Stock management.`
                : `${name} created.${hostelIds.length ? ' Set its stock in Stock management.' : ' Add hostels to it below.'}`,
              'Could not create the pool.',
            );
            if (ok) setCreating(false);
          }}
        />
      )}

      {notice && !(creating && notice.tone === 'error') && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {hostels.length > 6 && (
        <label className="hostel-picker__search pools__search">
          <SearchIcon width={16} height={16} />
          <input type="search" placeholder="Find a pool or hostel" aria-label="Find a pool or hostel" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      {pools.length === 0 && !creating && (
        <div className="stock-manager__empty">
          <p><strong>No pools yet.</strong> Create a pool, then add hostels to it.</p>
        </div>
      )}
      {q && visiblePools.length === 0 && <p className="muted pools__none">No pool or hostel matches “{query}”.</p>}

      <div className="pools__list">
        {visiblePools.map((pool) => (
          <PoolCard
            key={pool.id}
            pool={pool}
            pools={sortedPools}
            hostelsById={hostelsById}
            query={q}
            busy={busy}
            run={run}
            onManageStock={() => onManageStock(pool.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface PoolCardProps {
  pool: StockGroup;
  pools: StockGroup[];
  hostelsById: Map<string, AdminHostel>;
  query: string;
  busy: boolean;
  run: (work: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
  onManageStock: () => void;
}

function PoolCard({ pool, pools, hostelsById, query, busy, run, onManageStock }: PoolCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pool.name);
  const [newHostel, setNewHostel] = useState('');

  const live = pool.hostels.some((h) => h.isActive);
  const members = [...pool.hostels]
    .sort((a, b) => byName.compare(a.name, b.name))
    .filter((h) => !query || pool.name.toLowerCase().includes(query) || h.name.toLowerCase().includes(query));

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => api.updateStockGroup(pool.id, { name: name.trim() }), 'Pool renamed.', 'Could not rename the pool.')) setRenaming(false);
  };
  const addHostel = async (event: FormEvent) => {
    event.preventDefault();
    const hostelName = newHostel.trim();
    if (await run(() => api.createHostel(hostelName, pool.id), `${hostelName} added to ${pool.name}. It sells from this pool’s stock.`, 'Could not add the hostel.')) setNewHostel('');
  };
  const remove = () => {
    if (!window.confirm(`Delete the pool "${pool.name}" and its stock counts? No hostel uses it any more.`)) return;
    void run(() => api.deleteStockGroup(pool.id), 'Pool deleted.', 'Could not delete the pool.');
  };

  const move = (hostel: AdminHostel, target: string) => {
    const destination = pools.find((p) => p.id === target);
    const message =
      target === NEW_POOL
        ? `Give ${hostel.name} a new pool of its own? Its stock starts empty, so set it in Stock management afterwards.`
        : `Move ${hostel.name} to ${destination?.name}? It will sell from ${destination?.name}’s stock instead of ${pool.name}’s.`;
    if (!window.confirm(message)) return;
    void run(
      () => api.moveHostelToPool(hostel.id, target === NEW_POOL ? null : target),
      target === NEW_POOL ? `${hostel.name} now has a pool of its own.` : `${hostel.name} moved to ${destination?.name}.`,
      'Could not move the hostel.',
    );
  };
  const deactivate = (hostel: AdminHostel) => {
    if (!window.confirm(`Deactivate ${hostel.name}? It will be hidden from customers, and anyone shopping there will be asked to choose another hostel. Its pool and stock are kept.`)) return;
    void run(() => api.deactivateHostel(hostel.id), `${hostel.name} deactivated.`, 'Could not deactivate the hostel.');
  };
  const activate = (hostel: AdminHostel) =>
    void run(() => api.activateHostel(hostel.id), `${hostel.name} activated. Customers can now choose it.`, 'Could not activate the hostel.');
  const destroy = (hostel: AdminHostel) => {
    if (!window.confirm(`Permanently delete "${hostel.name}"? This cannot be undone. Hostels with assigned users or orders cannot be deleted.`)) return;
    void run(() => api.permanentlyDeleteHostel(hostel.id), `${hostel.name} permanently deleted.`, 'Could not delete the hostel.');
  };

  return (
    <article className={`pool-card${live ? '' : ' pool-card--quiet'}`}>
      <header className="pool-card__head">
        <span className="pool-card__icon" aria-hidden="true"><BuildingIcon width={18} height={18} /></span>
        {renaming ? (
          <form className="pool-card__rename" onSubmit={rename}>
            <input aria-label="Pool name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" className="btn btn--blue btn--sm" disabled={busy || !name.trim()}>Save</button>
            <button type="button" className="link-btn" onClick={() => { setRenaming(false); setName(pool.name); }}>Cancel</button>
          </form>
        ) : (
          <div className="pool-card__title">
            <h3>{pool.name}</h3>
            <span className="muted small">
              {pool.hostels.length === 0 ? 'Unused: no hostel sells from it' : `${pool.hostels.length} ${pool.hostels.length === 1 ? 'hostel' : 'hostels'}`}
            </span>
          </div>
        )}
        {!renaming && (
          <div className="pool-card__actions">
            <span className={`hostel-badge${live ? '' : ' hostel-badge--inactive'}`}>{live ? 'Live' : pool.hostels.length ? 'Inactive' : 'Unused'}</span>
            <button type="button" className="link-btn" disabled={busy} onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" className="btn btn--outline btn--sm pool-card__stock" onClick={onManageStock}>Manage stock</button>
            {pool.hostels.length === 0 && (
              <button type="button" className="btn btn--outline btn--sm hostel-card__delete pool-card__stock" disabled={busy} onClick={remove}>Delete</button>
            )}
          </div>
        )}
      </header>

      {members.length > 0 && (
        <ul className="pool-card__hostels">
          {members.map((member) => {
            const hostel = hostelsById.get(member.id);
            if (!hostel) return null;
            return (
              <li key={hostel.id} className={`pool-hostel${hostel.isActive ? '' : ' pool-hostel--inactive'}`}>
                <span className="pool-hostel__name">
                  {hostel.name}
                  {!hostel.isActive && <span className="pool-hostel__status">Inactive</span>}
                </span>
                <span className="pool-hostel__actions">
                  <select
                    aria-label={`Move ${hostel.name} to another pool`}
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && move(hostel, e.target.value)}
                  >
                    <option value="">Move to…</option>
                    {pools.filter((p) => p.id !== pool.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    {pool.hostels.length > 1 && <option value={NEW_POOL}>A new pool of its own</option>}
                  </select>
                  {hostel.isActive ? (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => deactivate(hostel)}>Deactivate</button>
                  ) : (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => activate(hostel)}>Activate</button>
                  )}
                  <button type="button" className="link-btn link-btn--danger" disabled={busy} onClick={() => destroy(hostel)}>Delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!query && (
        <form className="pool-card__add" onSubmit={addHostel}>
          <input aria-label={`New hostel in ${pool.name}`} placeholder="Add a hostel to this pool, e.g. BH-13" value={newHostel} maxLength={80} onChange={(e) => setNewHostel(e.target.value)} />
          <button type="submit" className="btn btn--blue btn--sm" disabled={busy || !newHostel.trim()}>Add hostel</button>
        </form>
      )}
    </article>
  );
}

interface NewPoolFormProps {
  hostels: AdminHostel[];
  pools: StockGroup[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (name: string, hostelIds: string[], copyFrom: string | null) => void;
}

/** Name a pool, optionally move existing hostels into it, and choose how its stock starts. */
function NewPoolForm({ hostels, pools, busy, error, onCancel, onCreate }: NewPoolFormProps) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyFrom, setCopyFrom] = useState('');
  const [query, setQuery] = useState('');

  const poolOf = useMemo(() => new Map(pools.flatMap((p) => p.hostels.map((h) => [h.id, p] as const))), [pools]);
  const sorted = useMemo(() => [...hostels].sort((a, b) => byName.compare(a.name, b.name)), [hostels]);
  const visible = query.trim() ? sorted.filter((h) => h.name.toLowerCase().includes(query.trim().toLowerCase())) : sorted;
  const chosen = sorted.filter((h) => selected.has(h.id));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(name.trim(), [...selected], copyFrom || null);
  };

  return (
    <form className="shared-stock__editor pools__new" onSubmit={submit}>
      <h3>New pool</h3>
      <Field label="Pool name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Boys’ Hostels" hint="Customers see this name when they choose where they live." />

      <div className="shared-stock__pick">
        <div className="shared-stock__pick-head">
          <span className="field__label-text">Move hostels into it <span className="muted">(optional)</span></span>
          <span className="muted small">{selected.size} selected</span>
        </div>
        {hostels.length > 6 && (
          <label className="hostel-picker__search shared-stock__search">
            <SearchIcon width={16} height={16} />
            <input type="search" placeholder="Search hostels" aria-label="Search hostels" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {hostels.length === 0 ? (
          <p className="muted small">No hostels yet. Create the pool, then add hostels inside it.</p>
        ) : (
          <ul className="shared-stock__checklist">
            {visible.map((hostel) => {
              const current = poolOf.get(hostel.id);
              return (
                <li key={hostel.id}>
                  <label className={`check-row${selected.has(hostel.id) ? ' check-row--on' : ''}`}>
                    <input type="checkbox" checked={selected.has(hostel.id)} onChange={() => toggle(hostel.id)} />
                    <span className="check-row__name">{hostel.name}{!hostel.isActive && <span className="muted small"> (inactive)</span>}</span>
                    {current && <span className="check-row__note check-row__note--quiet">in {current.name}</span>}
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && <li className="muted small shared-stock__none">No hostels match “{query}”.</li>}
          </ul>
        )}
      </div>

      <label className="field">
        <span className="field__label-text">Starting stock</span>
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">Empty: I’ll enter the counts</option>
          {(chosen.length ? chosen : sorted).map((h) => <option key={h.id} value={h.id}>Copy {h.name}’s current stock</option>)}
        </select>
        <span className="field__hint">
          {copyFrom
            ? 'Copies quantities and availability as a starting point. Hostels that shared one shelf often had the same counts typed in, so check the numbers rather than adding them up.'
            : 'You can set every product’s quantity in Stock management after creating the pool.'}
        </span>
      </label>

      {chosen.length > 0 && (
        <Notice tone="info">
          {chosen.length === 1 ? chosen[0].name : `${chosen.length} hostels`} will sell from this pool’s stock instead of {chosen.length === 1 ? 'its' : 'their'} current pool.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="shared-stock__buttons">
        <button type="submit" className="btn btn--blue" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create pool'}</button>
        <button type="button" className="btn btn--outline shared-stock__cancel" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
