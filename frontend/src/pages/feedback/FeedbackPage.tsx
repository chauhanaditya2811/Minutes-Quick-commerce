import { useSearchParams } from 'react-router-dom';
import { useHostel } from '../../context/HostelContext';
import ProductRequestBoard from '../../components/feedback/ProductRequestBoard';
import FeedbackForm from '../../components/feedback/FeedbackForm';

const TABS = [
  { id: 'requests', label: 'Request a product' },
  { id: 'feedback', label: 'Share feedback' },
] as const;

/** Customer feedback: a hostel's upvotable product request board and a private feedback form. */
export default function FeedbackPage() {
  const { selectedPool } = useHostel();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'feedback' ? 'feedback' : 'requests';

  return (
    <div className="page feedback-page">
      <header className="feedback-page__head">
        <h1>Feedback</h1>
        <p className="muted">Tell us what to stock at {selectedPool?.name} and how we can do better.</p>
      </header>

      <div className="segmented" role="tablist" aria-label="Feedback">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`feedback-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`feedback-panel-${t.id}`}
            className={`segmented__option${tab === t.id ? ' segmented__option--on' : ''}`}
            onClick={() => setParams(t.id === 'requests' ? {} : { tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`feedback-panel-${tab}`} aria-labelledby={`feedback-tab-${tab}`}>
        {tab === 'requests' ? <ProductRequestBoard /> : <FeedbackForm />}
      </div>
    </div>
  );
}
