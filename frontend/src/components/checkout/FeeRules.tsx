import { useId, useState } from 'react';
import type { StoreSettings } from '../../types/product';
import { describeFeeRules } from '../../utils/fees';

/** "How fees work": the full fee rules, hidden until tapped so the summary stays short. */
export default function FeeRules({ settings }: { settings: StoreSettings | null | undefined }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!settings) return null;
  return (
    <div className="fee-rules">
      <button type="button" className="link-btn fee-rules__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        How fees work <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <div id={id} className="fee-rules__body">
          <p>A small convenience fee is added to each order, based on the item total:</p>
          <ul>
            {describeFeeRules(settings).map((line) => <li key={line}>{line}</li>)}
          </ul>
          {/* Saying what the fee pays for makes it feel fair rather than tacked on. */}
          <p className="fee-rules__why">
            Items are sold at their printed price (MRP), so this fee is what pays for packing your order and bringing it to your room.
            {settings.lateNightFeeEnabled && ' The late-night fee keeps us open when the shops are shut.'}
          </p>
        </div>
      )}
    </div>
  );
}
