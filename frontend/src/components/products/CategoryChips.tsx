import { CATEGORIES, type CategoryId } from '../../data/productCategories';

interface Props {
  active: CategoryId | null;
  onChange: (id: CategoryId | null) => void;
}

export default function CategoryChips({ active, onChange }: Props) {
  return (
    <div className="chips" role="group" aria-label="Filter by category">
      <button type="button" className={`chip${active === null ? ' chip--on' : ''}`} aria-pressed={active === null} onClick={() => onChange(null)}>
        All
      </button>
      {CATEGORIES.map((c) => (
        <button key={c.id} type="button" className={`chip${active === c.id ? ' chip--on' : ''}`} aria-pressed={active === c.id} onClick={() => onChange(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
