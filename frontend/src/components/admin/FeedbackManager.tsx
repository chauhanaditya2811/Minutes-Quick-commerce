import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { StockGroup } from '../../types/product';
import type {
  AdminFeedback,
  AdminProductRequests,
  FeedbackStatus,
  ProductRequestStatus,
} from '../../types/feedback';
import { formatDate } from '../../utils/format';
import { ArrowUpIcon, StarIcon } from '../ui/Icons';
import Loading from '../Loading';
import Notice from '../ui/Notice';

type View = 'requests' | 'messages';

const REQUEST_FILTERS: { id: ProductRequestStatus; label: string }[] = [
  { id: 'OPEN', label: 'Open' },
  { id: 'ADDED', label: 'Added' },
  { id: 'HIDDEN', label: 'Hidden' },
  { id: 'ARCHIVED', label: 'Archived' },
];
const MESSAGE_FILTERS: { id: FeedbackStatus; label: string }[] = [
  { id: 'NEW', label: 'New' },
  { id: 'DONE', label: 'Done' },
];

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Admin → Feedback: product requests ranked by upvotes, and private feedback messages. */
export default function FeedbackManager() {
  const [view, setView] = useState<View>('requests');

  return (
    <section className="panel feedback-admin">
      <div className="feedback-admin__head">
        <div>
          <h2>Feedback</h2>
          <p className="muted small">What customers want stocked, and what they think of Minutes.</p>
        </div>
        <div className="segmented segmented--compact" role="tablist" aria-label="Feedback type">
          <button type="button" role="tab" aria-selected={view === 'requests'} className={`segmented__option${view === 'requests' ? ' segmented__option--on' : ''}`} onClick={() => setView('requests')}>
            Product requests
          </button>
          <button type="button" role="tab" aria-selected={view === 'messages'} className={`segmented__option${view === 'messages' ? ' segmented__option--on' : ''}`} onClick={() => setView('messages')}>
            Messages
          </button>
        </div>
      </div>
      {view === 'requests' ? <RequestsView /> : <MessagesView />}
    </section>
  );
}

function FilterChips<T extends string>({
  filters,
  value,
  counts,
  onChange,
}: {
  filters: { id: T; label: string }[];
  value: T;
  counts?: Record<T, number>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="filter-chips" role="group" aria-label="Filter by status">
      {filters.map((f) => (
        <button key={f.id} type="button" aria-pressed={value === f.id} className={`filter-chip${value === f.id ? ' filter-chip--on' : ''}`} onClick={() => onChange(f.id)}>
          {f.label}
          {counts && <span className="filter-chip__count">{counts[f.id]}</span>}
        </button>
      ))}
    </div>
  );
}

function RequestsView() {
  const [status, setStatus] = useState<ProductRequestStatus>('OPEN');
  // Requests are per pool (customers shop per pool).
  const [poolId, setPoolId] = useState('');
  const [pools, setPools] = useState<StockGroup[]>([]);
  const [data, setData] = useState<AdminProductRequests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.getStockGroups().then((list) => setPools(list.filter((p) => p.hostels.length > 0))).catch(() => setPools([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getAdminProductRequests(status, poolId || undefined));
    } catch (err) {
      setError(errorText(err, 'Could not load product requests.'));
    }
  }, [status, poolId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const change = async (id: string, next: ProductRequestStatus) => {
    setBusy(id);
    setError(null);
    try {
      await api.updateProductRequestStatus(id, next);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not update the request.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" permanently? Its votes are removed too. This can't be undone.`)) return;
    setBusy(id);
    setError(null);
    try {
      await api.deleteProductRequest(id);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not delete the request.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="feedback-admin__toolbar">
        <FilterChips filters={REQUEST_FILTERS} value={status} counts={data?.counts} onChange={setStatus} />
        <label className="feedback-admin__hostel">
          <span className="sr-only">Pool</span>
          <select value={poolId} onChange={(e) => setPoolId(e.target.value)}>
            <option value="">All pools</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        !error && <Loading />
      ) : data.requests.length === 0 ? (
        <p className="feedback-admin__empty muted">
          {status === 'OPEN'
            ? 'No open requests yet.'
            : status === 'ADDED'
              ? 'Nothing marked as added yet.'
              : status === 'HIDDEN'
                ? 'No hidden requests.'
                : 'Nothing archived yet. Each night, requests outside the top 3 move here.'}
        </p>
      ) : (
        <ul className="admin-requests">
          {data.requests.map((r) => (
            <li key={r.id} className="admin-request">
              <span className="admin-request__votes" aria-label={`${r.votes} ${r.votes === 1 ? 'vote' : 'votes'}`}>
                <ArrowUpIcon width={14} height={14} />
                {r.votes}
              </span>
              <span className="admin-request__main">
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.pool.name} · requested {formatDate(r.createdAt)}
                  {r.addedAt && ` · added ${formatDate(r.addedAt)}`}
                  {r.archivedAt && ` · archived ${formatDate(r.archivedAt)}`}
                </span>
              </span>
              <span className="admin-request__actions">
                {r.status === 'OPEN' && (
                  <>
                    <button type="button" className="btn btn--sm admin-request__add" disabled={busy === r.id} onClick={() => void change(r.id, 'ADDED')}>Mark added</button>
                    <button type="button" className="link-btn link-btn--danger" disabled={busy === r.id} onClick={() => void change(r.id, 'HIDDEN')}>Hide</button>
                  </>
                )}
                {r.status !== 'OPEN' && (
                  <button type="button" className="link-btn" disabled={busy === r.id} onClick={() => void change(r.id, 'OPEN')}>Reopen</button>
                )}
                <button type="button" className="link-btn link-btn--danger" disabled={busy === r.id} onClick={() => void remove(r.id, r.name)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small feedback-admin__hint">
        “Mark added” shows the request as Now available to customers for 7 days. “Hide” removes it from customers and stops it being requested again. “Delete” removes it and its votes completely. Each pool can have up to 10 open requests; every night at 12 am the top 3 stay and the rest move to Archived.
      </p>
    </>
  );
}

function MessagesView() {
  const [status, setStatus] = useState<FeedbackStatus>('NEW');
  const [data, setData] = useState<AdminFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getAdminFeedback(status));
    } catch (err) {
      setError(errorText(err, 'Could not load feedback.'));
    }
  }, [status]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const change = async (id: string, next: FeedbackStatus) => {
    setBusy(id);
    setError(null);
    try {
      await api.updateFeedbackStatus(id, next);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not update the feedback.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="feedback-admin__toolbar">
        <FilterChips filters={MESSAGE_FILTERS} value={status} counts={data?.counts} onChange={setStatus} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        !error && <Loading />
      ) : data.messages.length === 0 ? (
        <p className="feedback-admin__empty muted">{status === 'NEW' ? 'You’re all caught up.' : 'No handled feedback yet.'}</p>
      ) : (
        <ul className="admin-messages">
          {data.messages.map((m) => (
            <li key={m.id} className="admin-message">
              <div className="admin-message__meta">
                {m.rating !== null && (
                  <span className="admin-message__rating" aria-label={`Rated ${m.rating} of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <StarIcon key={n} width={14} height={14} className={n <= m.rating! ? 'is-on' : undefined} />
                    ))}
                  </span>
                )}
                <span className="muted small">
                  {m.hostel?.name ?? 'No hostel'} · {formatDate(m.createdAt)}
                </span>
              </div>
              <p className="admin-message__text">{m.message}</p>
              <div className="admin-message__foot">
                {m.contactPhone ? (
                  <a className="small" href={`tel:+91${m.contactPhone}`}>Call {m.contactPhone}</a>
                ) : (
                  <span className="muted small">No phone left</span>
                )}
                {m.status === 'NEW' ? (
                  <button type="button" className="btn btn--sm admin-request__add" disabled={busy === m.id} onClick={() => void change(m.id, 'DONE')}>Mark done</button>
                ) : (
                  <button type="button" className="link-btn" disabled={busy === m.id} onClick={() => void change(m.id, 'NEW')}>Move to new</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
