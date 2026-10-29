import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Skeleton from 'react-loading-skeleton';
import { useCart } from '../../context/CartContext';
import { useHostel } from '../../context/HostelContext';
import Notice from '../ui/Notice';
import { BuildingIcon, CheckIcon, CloseIcon, PinIcon, SearchIcon } from '../ui/Icons';

const SEARCH_THRESHOLD = 6;

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isModal = variant === 'modal';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? hostels.filter((h) => h.name.toLowerCase().includes(q)) : hostels;
  }, [hostels, query]);
  const target = hostels.find((h) => h.id === choice) ?? null;
  const cartUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Modal behaviour: focus inside, lock page scroll, restore focus on close.
  useEffect(() => {
    if (!isModal) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
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
    if (lines.length > 0 && cartHostelId !== target.id && !confirmingSwitch) {
      setConfirmingSwitch(true);
      return;
    }
    selectHostel(target); // the cart empties itself when its hostel changes
  };

  const choose = (id: string) => {
    setChoice(id);
    setConfirmingSwitch(false);
  };

  const Heading = isModal ? 'h2' : 'h1';
  const body = (
    <form className="hostel-picker" onSubmit={submit} aria-labelledby={titleId}>
      <div className="hostel-picker__head">
        <span className="hostel-picker__icon" aria-hidden="true"><PinIcon width={22} height={22} /></span>
        <div className="hostel-picker__title">
          <Heading id={titleId}>{isModal ? 'Change your hostel' : 'Where should we deliver?'}</Heading>
          <p className="muted">Each hostel has its own stock. Choose yours to see what’s available right now.</p>
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
                type="search"
                placeholder="Search hostels"
                aria-label="Search hostels"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <fieldset className="hostel-picker__list">
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
            {visible.length === 0 && <p className="muted small hostel-picker__none">No hostels match “{query}”.</p>}
          </fieldset>
        </>
      )}

      {confirmingSwitch && target && (
        <Notice tone="warning">
          Switching to <strong>{target.name}</strong> will empty your cart ({cartUnits} {cartUnits === 1 ? 'item' : 'items'}),
          because stock differs between hostels.
        </Notice>
      )}

      <div className="hostel-picker__actions">
        <button type="submit" className="btn btn--yellow btn--block btn--lg" disabled={!target}>
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
      <div className="hostel-modal__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onKeyDown={onDialogKeyDown}>
        {body}
      </div>
    </div>
  );
}
