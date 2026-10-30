import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BuildingIcon, CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from '../ui/Icons';

interface Option {
  id: string;
  name: string;
}

interface Props {
  label: string;
  hostels: Option[];
  value: string;
  onChange: (hostelId: string) => void;
  hint?: ReactNode;
  invalid?: boolean;
  disabled?: boolean;
}

/** With more hostels than this, the sheet gets a search box. */
const SEARCH_THRESHOLD = 6;
// Natural order, so "BH-2" comes before "BH-10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const simplify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * "Your hostel" at checkout. A native <select> with many hostels can run off a phone screen
 * without scrolling, so this opens the app's own sheet: a scrollable, searchable list.
 */
export default function HostelSelect({ label, hostels, value, onChange, hint, invalid, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const titleId = useId();

  const sorted = useMemo(() => [...hostels].sort((a, b) => byName.compare(a.name, b.name)), [hostels]);
  const visible = useMemo(() => {
    const q = simplify(query);
    return q ? sorted.filter((h) => simplify(h.name).includes(q)) : sorted;
  }, [sorted, query]);
  const selected = hostels.find((h) => h.id === value) ?? null;

  // While open: lock page scroll and focus the sheet (not the search box, so phones don't
  // pop the keyboard up); show the chosen hostel; return focus to the field on close.
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    dialogRef.current?.querySelector('.hostel-option--on')?.scrollIntoView({ block: 'center' });
    return () => {
      document.body.style.overflow = overflow;
      buttonRef.current?.focus();
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (id: string) => {
    onChange(id);
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="field">
      <span className="field__label" id={labelId}>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={`hostel-select${selected ? '' : ' hostel-select--empty'}`}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="hostel-select__value">{selected ? selected.name : 'Select your hostel'}</span>
        <ChevronDownIcon width={16} height={16} />
      </button>
      {hint && <p className="field__hint">{hint}</p>}

      {open && (
        <div className="hostel-modal" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="hostel-modal__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="hostel-picker">
              <div className="hostel-picker__head">
                <div className="hostel-picker__title">
                  <h2 id={titleId}>Choose your hostel</h2>
                </div>
                <button type="button" className="icon-btn hostel-picker__close" aria-label="Close" onClick={close}>
                  <CloseIcon />
                </button>
              </div>
              {hostels.length > SEARCH_THRESHOLD && (
                <label className="hostel-picker__search">
                  <SearchIcon width={16} height={16} />
                  <input
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
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (visible.length === 1) pick(visible[0].id);
                      else e.currentTarget.blur();
                    }}
                  />
                </label>
              )}
              <div className="hostel-picker__list hostel-select__list" role="listbox" aria-labelledby={titleId}>
                {visible.map((hostel) => {
                  const on = hostel.id === value;
                  return (
                    <button
                      key={hostel.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={`hostel-option${on ? ' hostel-option--on' : ''}`}
                      onClick={() => pick(hostel.id)}
                    >
                      <span className="hostel-option__icon" aria-hidden="true"><BuildingIcon width={18} height={18} /></span>
                      <span className="hostel-option__name">{hostel.name}</span>
                      <span className="hostel-option__check" aria-hidden="true">{on && <CheckIcon width={16} height={16} />}</span>
                    </button>
                  );
                })}
                {visible.length === 0 && <p className="muted small hostel-picker__none">No hostel matches “{query}”.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
