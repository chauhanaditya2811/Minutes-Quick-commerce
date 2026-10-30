import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useHostel } from '../../context/HostelContext';
import { api } from '../../services/api';
import type { ProductRequest } from '../../types/feedback';
import { ArrowUpIcon, CheckIcon } from '../ui/Icons';
import Notice from '../ui/Notice';

const NAME_MAX = 60;
const DEFAULT_MAX_OPEN = 10;
const KEEP_AFTER_RESET = 3;

/** Matches the server: "Red  Bull" and "redbull" are the same request. */
const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A hostel's request board: ask for a product, or upvote what others asked for. */
export default function ProductRequestBoard() {
  const { selectedPool } = useHostel();
  const poolId = selectedPool?.id ?? '';
  const [requests, setRequests] = useState<ProductRequest[] | null>(null);
  const [maxOpen, setMaxOpen] = useState(DEFAULT_MAX_OPEN);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoadError(null);
    try {
      const board = await api.getProductRequests(poolId);
      setRequests(board.requests);
      setMaxOpen(board.maxOpen);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load requests.');
    }
  }, [poolId]);

  useEffect(() => {
    setRequests(null);
    void load();
  }, [load]);

  const open = useMemo(() => (requests ?? []).filter((r) => r.status === 'OPEN'), [requests]);
  const added = useMemo(() => (requests ?? []).filter((r) => r.status === 'ADDED'), [requests]);
  const full = requests !== null && open.length >= maxOpen;

  // While typing, show matching requests so customers upvote instead of asking again.
  const matches = useMemo(() => {
    const typed = normalize(name);
    if (typed.length < 2) return [];
    return open.filter((r) => normalize(r.name).includes(typed)).slice(0, 3);
  }, [name, open]);

  const replace = (next: ProductRequest) =>
    setRequests((list) =>
      (list ?? [])
        .map((r) => (r.id === next.id ? next : r))
        .sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt)),
    );

  const toggleVote = async (request: ProductRequest) => {
    if (pending.has(request.id)) return;
    const voted = !request.voted;
    setPending((s) => new Set(s).add(request.id));
    replace({ ...request, voted, votes: request.votes + (voted ? 1 : -1) }); // optimistic
    try {
      replace(await api.setProductRequestVote(request.id, voted));
    } catch (error) {
      replace(request);
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save your vote.' });
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(request.id);
        return next;
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2) {
      setNotice({ tone: 'error', text: 'Enter the product you’d like us to stock.' });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const { request, duplicate } = await api.requestProduct(poolId, trimmed);
      setRequests((list) => {
        const rest = (list ?? []).filter((r) => r.id !== request.id);
        return [...rest, request].sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
      });
      setName('');
      setNotice({
        tone: 'success',
        text: duplicate
          ? `${request.name} was already requested, so we counted your vote.`
          : `Thanks! ${request.name} is on the list. Others can upvote it now.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not send your request.' });
      // Someone else may have filled the last spot: refresh so the board shows it.
      if (error instanceof Error && /list is full/.test(error.message)) void load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="requests">
      <section className="panel requests__form-card" aria-labelledby="request-title">
        <h2 id="request-title">What should we stock?</h2>
        <p className="muted small">Request a product for {selectedPool?.name}. We stock the most wanted items first.</p>
        {full && (
          <p className="requests__full" role="status">
            Today’s list is full ({maxOpen} of {maxOpen}). Upvote a request below, or come back after midnight when spots open up.
          </p>
        )}
        <form className="requests__form" onSubmit={submit}>
          <label className="sr-only" htmlFor="request-name">Product name</label>
          <input
            id="request-name"
            className="requests__input"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder={full ? 'Type to find a request to upvote' : 'e.g. Red Bull 250 ml'}
            onChange={(e) => {
              setName(e.target.value);
              if (notice?.tone !== 'error') setNotice(null);
            }}
          />
          <button type="submit" className="btn btn--yellow requests__submit" disabled={submitting || !poolId || (full && matches.length === 0)}>
            {submitting ? 'Sending…' : 'Request'}
          </button>
        </form>

        {matches.length > 0 && (
          <div className="requests__matches" aria-live="polite">
            <p className="requests__matches-title">Already requested. Upvote it instead?</p>
            <ul className="request-list request-list--compact">
              {matches.map((r) => (
                <RequestRow key={r.id} request={r} busy={pending.has(r.id)} onVote={toggleVote} />
              ))}
            </ul>
          </div>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </section>

      {added.length > 0 && (
        <section className="requests__added" aria-labelledby="added-title">
          <h2 id="added-title">Now available</h2>
          <ul>
            {added.map((r) => (
              <li key={r.id}><CheckIcon width={14} height={14} /> {r.name}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel requests__board" aria-labelledby="board-title">
        <div className="requests__board-head">
          <h2 id="board-title">Most wanted</h2>
          {requests !== null && <span className={`requests__count${full ? ' requests__count--full' : ''}`}>{open.length}/{maxOpen}</span>}
        </div>
        <p className="requests__rule muted small">Every night at 12 am the top {KEEP_AFTER_RESET} stay and the rest are cleared, so new requests get a chance.</p>

        {loadError ? (
          <Notice tone="error">
            {loadError} <button type="button" className="link-btn" onClick={() => void load()}>Try again</button>
          </Notice>
        ) : requests === null ? (
          <ul className="request-list" aria-busy="true" aria-label="Loading requests">
            {[0, 1, 2].map((i) => <li key={i} className="request-row request-row--skeleton" />)}
          </ul>
        ) : open.length === 0 ? (
          <div className="requests__empty">
            <p><strong>No requests yet</strong></p>
            <p className="muted small">Be the first to ask for something you’d like to see here.</p>
          </div>
        ) : (
          <ol className="request-list">
            {open.map((r, index) => (
              <RequestRow key={r.id} request={r} rank={index + 1} busy={pending.has(r.id)} onVote={toggleVote} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function RequestRow({
  request,
  rank,
  busy,
  onVote,
}: {
  request: ProductRequest;
  rank?: number;
  busy: boolean;
  onVote: (request: ProductRequest) => void;
}) {
  return (
    <li className="request-row">
      {rank !== undefined && <span className="request-row__rank" aria-hidden="true">{rank}</span>}
      <span className="request-row__name">{request.name}</span>
      <button
        type="button"
        className={`vote-btn${request.voted ? ' vote-btn--on' : ''}`}
        aria-pressed={request.voted}
        aria-label={`${request.voted ? 'Remove your upvote for' : 'Upvote'} ${request.name}, ${request.votes} ${request.votes === 1 ? 'vote' : 'votes'}`}
        disabled={busy}
        onClick={() => onVote(request)}
      >
        <ArrowUpIcon width={15} height={15} />
        <span>{request.votes}</span>
      </button>
    </li>
  );
}
