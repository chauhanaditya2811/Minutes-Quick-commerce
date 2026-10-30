import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Skeleton from 'react-loading-skeleton';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import Notice from '../ui/Notice';
import { BuildingIcon, CheckIcon, CloseIcon, PinIcon, SearchIcon } from '../ui/Icons';
import { WHATSAPP_NUMBER } from '../../services/contact';
import type { Pool } from '../../services/api';

/** With more places than fit in the list box at once, a search box is shown. */
const SEARCH_THRESHOLD = 5;
/** How many of a pool's hostels are named under it before "+N more". */
const NAMED_HOSTELS = 2;

// Natural order, so "BH-2" comes before "BH-10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const simplify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const initials = (name: string) =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((word) => word[0]).join('');

/**
 * How well a name matches what was typed (lower is better, null is no match): names that
 * start with it first, then a word that does, then initials ("srk" → "Shah Rukh Khan Hall"),
 * then anywhere in the name. Case, spaces and dashes don't matter ("bh2" finds "BH-2").
 */
const nameRank = (name: string, query: string) => {
  const lower = name.toLowerCase();
  const compact = simplify(query);
  if (!compact) return 0;
  if (simplify(lower).startsWith(compact)) return 0;
  if (lower.split(/[^a-z0-9]+/).some((word) => word.startsWith(compact))) return 1;
  if (initials(lower).startsWith(compact)) return 2;
  if (simplify(lower).includes(compact)) return 3;
  return null;
};

/**
 * A pool matches by its own name or by any of its hostels ("bh2" finds "Boys' Hostels"); the
 * matching hostel is returned so the list can say why the pool was found.
 */
const matchPool = (pool: Pool, query: string) => {
  const own = nameRank(pool.name, query);
  let best: { rank: number; via: string | null } | null = own === null ? null : { rank: own, via: null };
  for (const hostel of pool.hostels) {
    const rank = nameRank(hostel.name, query);
    if (rank !== null && (!best || rank < best.rank)) best = { rank, via: hostel.name };
  }
  return best;
};

/** "BH-1, BH-2, BH-3 +9 more" under a pool that serves several hostels. */
const servedBy = (pool: Pool) => {
  const names = [...pool.hostels].sort((a, b) => byName.compare(a.name, b.name)).map((h) => h.name);
  const shown = names.slice(0, NAMED_HOSTELS).join(', ');
  return names.length > NAMED_HOSTELS ? `${shown} +${names.length - NAMED_HOSTELS} more` : shown;
};

interface Props {
  /** `page` blocks a store route until a place is chosen; `modal` changes an existing choice. */
  variant: 'page' | 'modal';
}

/**
 * "Where should we deliver?": customers choose a pool (one shared stock, e.g. "Boys' Hostels"
 * or a single hostel). Their exact hostel is asked at checkout, from that pool's hostels.
 */
export default function HostelPicker({ variant }: Props) {
  const { pools, poolsLoading, poolsError, reloadPools, selectedPool, selectionNotice, selectPool, closePicker } = useHostel();
  const { lines, hostelId: cartPoolId } = useCart();
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<string>(selectedPool?.id ?? '');
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);
  const [searching, setSearching] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const isModal = variant === 'modal';

  const visible = useMemo(() => {
    if (!query.trim()) {
      // Your current choice first, then A to Z.
      const sorted = [...pools].sort((a, b) => byName.compare(a.name, b.name));
      const current = sorted.find((p) => p.id === selectedPool?.id);
      return (current ? [current, ...sorted.filter((p) => p !== current)] : sorted).map((pool) => ({ pool, via: null as string | null }));
    }
    return pools
      .map((pool) => ({ pool, match: matchPool(pool, query) }))
      .filter((m): m is { pool: Pool; match: { rank: number; via: string | null } } => m.match !== null)
      .sort((a, b) => a.match.rank - b.match.rank || byName.compare(a.pool.name, b.pool.name))
      .map(({ pool, match }) => ({ pool, via: match.via }));
  }, [pools, query, selectedPool?.id]);
  const target = pools.find((p) => p.id === choice) ?? null;
  const cartUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Phone keyboards: track how much of the screen is still visible so the sheet and the list
  // stay above the keyboard (iOS keeps the page height and overlays the keyboard instead).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement.style;
    const update = () => {
      root.setProperty('--visual-height', `${viewport.height}px`);
      root.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.removeProperty('--visual-height');
      root.removeProperty('--keyboard-inset');
    };
  }, []);

  // Modal behaviour: focus inside, lock page scroll, restore focus on close. Focus goes to the
  // sheet itself, not the search box, so phones don't pop the keyboard up before anyone types.
  useEffect(() => {
    if (!isModal) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [isModal]);

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePicker();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (target.id === selectedPool?.id) {
      closePicker();
      return;
    }
    // The cart belongs to one pool's stock, so switching pool empties it.
    if (lines.length > 0 && cartPoolId !== target.id && !confirmingSwitch) {
      setConfirmingSwitch(true);
      return;
    }
    selectPool(target); // the cart empties itself when its pool changes
  };

  const choose = (id: string) => {
    setChoice(id);
    setConfirmingSwitch(false);
    // Picking while searching closes the phone keyboard and brings the button to
    // continue into view.
    if (searching || document.activeElement === searchRef.current) {
      searchRef.current?.blur();
      window.setTimeout(() => submitRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 250);
    }
  };

  // Typing on a phone: bring the search box to the top so the results fit above the keyboard.
  const startSearching = () => {
    setSearching(true);
    window.setTimeout(() => searchRef.current?.closest('label')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
  };

  const Heading = isModal ? 'h2' : 'h1';
  const body = (
    <form className={`hostel-picker${searching ? ' hostel-picker--searching' : ''}`} onSubmit={submit} aria-labelledby={titleId}>
      <div className="hostel-picker__head">
        <span className="hostel-picker__icon" aria-hidden="true"><PinIcon width={22} height={22} /></span>
        <div className="hostel-picker__title">
          <Heading id={titleId}>{isModal ? 'Change where you live' : 'Where should we deliver?'}</Heading>
          <p className="muted">Choose where you live to see what we can deliver right now. You’ll pick your exact hostel at checkout.</p>
        </div>
        {isModal && (
          <button type="button" className="icon-btn hostel-picker__close" aria-label="Close" onClick={closePicker}>
            <CloseIcon />
          </button>
        )}
      </div>

      {selectionNotice && <Notice tone="warning">{selectionNotice}</Notice>}

      {poolsLoading && pools.length === 0 ? (
        <div className="hostel-picker__list" aria-busy="true" aria-label="Loading places">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={56} borderRadius={8} />)}
        </div>
      ) : poolsError && pools.length === 0 ? (
        <Notice tone="error">
          {poolsError} <button type="button" className="link-btn" onClick={reloadPools}>Try again</button>
        </Notice>
      ) : pools.length === 0 ? (
        <div className="hostel-picker__empty">
          <BuildingIcon width={28} height={28} />
          <p><strong>No hostels are open for delivery yet.</strong></p>
          <p className="muted small">Please check back soon.</p>
        </div>
      ) : (
        <>
          {pools.length > SEARCH_THRESHOLD && (
            <label className="hostel-picker__search">
              <SearchIcon width={16} height={16} />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search your hostel"
                aria-label="Search hostels"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={startSearching}
                // Wait for the tap that caused the blur to land before the intro text returns,
                // otherwise the list shifts under the finger and the wrong hostel is picked.
                onBlur={() => window.setTimeout(() => setSearching(false), 200)}
                onKeyDown={(e) => {
                  // Enter / the keyboard's search key never submits an older choice: it picks the
                  // only match if there is one, and otherwise just closes the keyboard.
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (visible.length === 1) choose(visible[0].pool.id);
                  else e.currentTarget.blur();
                }}
              />
              {query && (
                <button
                  type="button"
                  className="hostel-picker__clear"
                  aria-label="Clear search"
                  // Keep focus (and the keyboard) in the search box while clearing it.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setQuery('')}
                >
                  <CloseIcon width={14} height={14} />
                </button>
              )}
            </label>
          )}
          <fieldset className="hostel-picker__list" aria-describedby={visible.length === 0 ? `${titleId}-none` : undefined}>
            <legend className="sr-only">Where you live</legend>
            {visible.map(({ pool, via }) => {
              const checked = pool.id === choice;
              const several = pool.hostels.length > 1;
              return (
                <label key={pool.id} className={`hostel-option${checked ? ' hostel-option--on' : ''}`}>
                  <input
                    type="radio"
                    name="pool"
                    value={pool.id}
                    checked={checked}
                    onChange={() => choose(pool.id)}
                  />
                  <span className="hostel-option__icon" aria-hidden="true"><BuildingIcon width={18} height={18} /></span>
                  <span className="hostel-option__name">
                    {pool.name}
                    {(several || via) && (
                      <span className="hostel-option__sub">
                        {via && via !== pool.name ? `Includes ${via}` : `${pool.hostels.length} hostels · ${servedBy(pool)}`}
                      </span>
                    )}
                  </span>
                  {pool.id === selectedPool?.id && <span className="hostel-option__current">Current</span>}
                  <span className="hostel-option__check" aria-hidden="true">{checked && <CheckIcon width={16} height={16} />}</span>
                </label>
              );
            })}
            {visible.length === 0 && (
              <div className="hostel-picker__none" id={`${titleId}-none`} role="status">
                <p><strong>Your hostel isn’t listed here yet.</strong></p>
                <p className="muted small">Check the spelling, or tell us where you are and we’ll look at adding it.</p>
                <a
                  className="btn btn--outline btn--sm hostel-picker__ask"
                  href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi Minutes! Please add my hostel: ${query.trim()}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Message us on WhatsApp
                </a>
              </div>
            )}
          </fieldset>
        </>
      )}

      {confirmingSwitch && target && (
        <Notice tone="warning">
          Switching to <strong>{target.name}</strong> will empty your cart ({cartUnits} {cartUnits === 1 ? 'item' : 'items'}),
          because it’s stocked separately.
        </Notice>
      )}

      <div className="hostel-picker__actions">
        <button ref={submitRef} type="submit" className="btn btn--yellow btn--block btn--lg" disabled={!target}>
          {confirmingSwitch ? 'Empty cart and switch' : isModal ? 'Deliver here' : 'Start shopping'}
        </button>
        {confirmingSwitch && (
          <button type="button" className="btn btn--outline btn--block" onClick={closePicker}>
            Keep {selectedPool?.name ?? 'current choice'}
          </button>
        )}
      </div>
    </form>
  );

  if (!isModal) return <section className="hostel-gate"><div className="hostel-gate__card">{body}</div></section>;

  return (
    <div className="hostel-modal" onMouseDown={(e) => e.target === e.currentTarget && closePicker()}>
      <div className="hostel-modal__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onKeyDown={onDialogKeyDown}>
        {body}
      </div>
    </div>
  );
}
