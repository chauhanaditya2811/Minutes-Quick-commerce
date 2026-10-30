import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Skeleton from 'react-loading-skeleton';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import Notice from '../ui/Notice';
import { BuildingIcon, CheckIcon, CloseIcon, PinIcon, SearchIcon } from '../ui/Icons';
import { WHATSAPP_NUMBER } from '../../services/contact';
import type { Hostel } from '../../services/api';

/** With more hostels than fit in the list box at once, a search box is shown. */
const SEARCH_THRESHOLD = 5;

const simplify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const initials = (name: string) =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((word) => word[0]).join('');

/**
 * How well a hostel matches what was typed (lower is better, null is no match): names that
 * start with it first, then a word that does, then initials ("srk" → "Shah Rukh Khan Hall"),
 * then anywhere in the name. Case, spaces and dashes don't matter ("bh2" finds "BH-2").
 */
const matchRank = (hostel: Hostel, query: string) => {
  const q = query.trim().toLowerCase();
  const name = hostel.name.toLowerCase();
  const compact = simplify(q);
  if (!compact) return 0;
  if (simplify(name).startsWith(compact)) return 0;
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(compact))) return 1;
  if (initials(name).startsWith(compact)) return 2;
  if (simplify(name).includes(compact)) return 3;
  return null;
};

const stockOf = (hostel: Hostel) => hostel.stockGroupId ?? hostel.id;

// Natural order, so "BH-2" comes before "BH-10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface Props {
  /** `page` blocks a store route until a hostel is chosen; `modal` changes an existing choice. */
  variant: 'page' | 'modal';
}

export default function HostelPicker({ variant }: Props) {
  const { hostels, hostelsLoading, hostelsError, reloadHostels, selectedHostel, selectionNotice, selectHostel, closePicker } =
    useHostel();
  const { lines, hostelId: cartHostelId } = useCart();
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<string>(selectedHostel?.id ?? '');
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);
  const [searching, setSearching] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const isModal = variant === 'modal';

  const visible = useMemo(() => {
    if (!query.trim()) {
      // Your current hostel first, then A to Z.
      const sorted = [...hostels].sort((a, b) => byName.compare(a.name, b.name));
      const current = sorted.find((h) => h.id === selectedHostel?.id);
      return current ? [current, ...sorted.filter((h) => h !== current)] : sorted;
    }
    return hostels
      .map((hostel) => ({ hostel, rank: matchRank(hostel, query) }))
      .filter((m): m is { hostel: Hostel; rank: number } => m.rank !== null)
      .sort((a, b) => a.rank - b.rank || byName.compare(a.hostel.name, b.hostel.name))
      .map((m) => m.hostel);
  }, [hostels, query, selectedHostel?.id]);
  const target = hostels.find((h) => h.id === choice) ?? null;
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
    if (target.id === selectedHostel?.id) {
      closePicker();
      return;
    }
    // Hostels sharing a stock keep the cart; only a different stock empties it.
    if (lines.length > 0 && cartHostelId !== stockOf(target) && !confirmingSwitch) {
      setConfirmingSwitch(true);
      return;
    }
    selectHostel(target); // the cart empties itself when its hostel changes
  };

  const choose = (id: string) => {
    setChoice(id);
    setConfirmingSwitch(false);
    // Picking a hostel while searching closes the phone keyboard and brings the button to
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
          <Heading id={titleId}>{isModal ? 'Change your hostel' : 'Where should we deliver?'}</Heading>
          <p className="muted">Choose your hostel to see what we can deliver to you right now.</p>
        </div>
        {isModal && (
          <button type="button" className="icon-btn hostel-picker__close" aria-label="Close" onClick={closePicker}>
            <CloseIcon />
          </button>
        )}
      </div>

      {selectionNotice && <Notice tone="warning">{selectionNotice}</Notice>}

      {hostelsLoading && hostels.length === 0 ? (
        <div className="hostel-picker__list" aria-busy="true" aria-label="Loading hostels">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={56} borderRadius={8} />)}
        </div>
      ) : hostelsError && hostels.length === 0 ? (
        <Notice tone="error">
          {hostelsError} <button type="button" className="link-btn" onClick={reloadHostels}>Try again</button>
        </Notice>
      ) : hostels.length === 0 ? (
        <div className="hostel-picker__empty">
          <BuildingIcon width={28} height={28} />
          <p><strong>No hostels are open for delivery yet.</strong></p>
          <p className="muted small">Please check back soon.</p>
        </div>
      ) : (
        <>
          {hostels.length > SEARCH_THRESHOLD && (
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
                  if (visible.length === 1) choose(visible[0].id);
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
            <legend className="sr-only">Hostel</legend>
            {visible.map((hostel) => {
              const checked = hostel.id === choice;
              return (
                <label key={hostel.id} className={`hostel-option${checked ? ' hostel-option--on' : ''}`}>
                  <input
                    type="radio"
                    name="hostel"
                    value={hostel.id}
                    checked={checked}
                    onChange={() => choose(hostel.id)}
                  />
                  <span className="hostel-option__icon" aria-hidden="true"><BuildingIcon width={18} height={18} /></span>
                  <span className="hostel-option__name">{hostel.name}</span>
                  {hostel.id === selectedHostel?.id && <span className="hostel-option__current">Current</span>}
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
          because it sells from a different stock.
        </Notice>
      )}

      <div className="hostel-picker__actions">
        <button ref={submitRef} type="submit" className="btn btn--yellow btn--block btn--lg" disabled={!target}>
          {confirmingSwitch ? 'Empty cart and switch' : isModal ? 'Deliver here' : 'Start shopping'}
        </button>
        {confirmingSwitch && (
          <button type="button" className="btn btn--outline btn--block" onClick={closePicker}>
            Keep {selectedHostel?.name ?? 'current hostel'}
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
