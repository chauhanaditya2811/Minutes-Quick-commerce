import { useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useHostel } from '../../context/HostelContext';
import { loadGuestHostel } from '../../services/guestCheckout';
import { api } from '../../services/api';
import { CheckIcon, StarIcon } from '../ui/Icons';
import Notice from '../ui/Notice';

const MESSAGE_MAX = 1000;
const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** Private feedback for the Minutes team: an optional rating, a message and an optional phone. */
export default function FeedbackForm() {
  const { selectedPool } = useHostel();
  const { profile } = useAuth();
  // Feedback mentions the customer's own hostel when we know it (saved profile or last guest order).
  const knownHostel = [profile?.hostelId, selectedPool ? loadGuestHostel(selectedPool.id) : '']
    .find((id) => id && selectedPool?.hostels.some((h) => h.id === id));
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    const contactPhone = phone.replace(/\s+/g, '');
    if (text.length < 5) {
      setError('Write a few words so we know what to improve.');
      return;
    }
    if (contactPhone && !/^[6-9]\d{9}$/.test(contactPhone)) {
      setError('Enter a 10-digit mobile number starting with 6, 7, 8 or 9, or leave it empty.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.sendFeedback({
        hostelId: knownHostel || undefined,
        message: text,
        ...(rating ? { rating } : {}),
        ...(contactPhone ? { contactPhone } : {}),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <section className="panel feedback-thanks" aria-live="polite">
        <span className="feedback-thanks__icon" aria-hidden="true"><CheckIcon width={22} height={22} /></span>
        <h2>Thanks for your feedback</h2>
        <p className="muted">We read every message and use it to make Minutes better.</p>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => {
            setSent(false);
            setMessage('');
            setRating(0);
            setPhone('');
          }}
        >
          Send more feedback
        </button>
      </section>
    );
  }

  const shown = hover || rating;

  return (
    <form className="panel feedback-form" onSubmit={submit} noValidate>
      <fieldset className="rating">
        <legend>How was your experience? <span className="muted">(optional)</span></legend>
        <div className="rating__stars" onMouseLeave={() => setHover(0)}>
          {RATING_LABELS.map((label, index) => {
            const value = index + 1;
            return (
              <button
                key={value}
                type="button"
                className={`rating__star${value <= shown ? ' rating__star--on' : ''}`}
                aria-label={`${value} of 5, ${label}`}
                aria-pressed={rating === value}
                onMouseEnter={() => setHover(value)}
                onClick={() => setRating(rating === value ? 0 : value)}
              >
                <StarIcon width={28} height={28} />
              </button>
            );
          })}
          <span className="rating__label" aria-hidden="true">{shown ? RATING_LABELS[shown - 1] : ''}</span>
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="feedback-message">How can we do better?</label>
        <textarea
          id="feedback-message"
          rows={5}
          maxLength={MESSAGE_MAX}
          value={message}
          placeholder="Delivery times, products, prices, the app… anything helps."
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="field__hint feedback-form__count">{message.length}/{MESSAGE_MAX}</p>
      </div>

      <div className="field">
        <label htmlFor="feedback-phone">Phone <span className="muted">(optional)</span></label>
        <input
          id="feedback-phone"
          type="tel"
          inputMode="numeric"
          maxLength={12}
          value={phone}
          placeholder="If you’d like us to get back to you"
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className="btn btn--yellow btn--block btn--lg" disabled={sending}>
        {sending ? 'Sending…' : 'Send feedback'}
      </button>
      <p className="feedback-form__private muted small">Only the Minutes team can see your feedback.</p>
    </form>
  );
}
