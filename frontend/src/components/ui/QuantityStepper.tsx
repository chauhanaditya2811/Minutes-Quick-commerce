interface Props {
  quantity: number;
  max: number;
  label: string;
  onChange: (next: number) => void;
}

export default function QuantityStepper({ quantity, max, label, onChange }: Props) {
  return (
    <div className="stepper" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" onClick={() => onChange(quantity - 1)} aria-label={`Decrease ${label}`}>
        −
      </button>
      <span aria-live="polite">{quantity}</span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={quantity >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}
