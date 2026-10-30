import { WHATSAPP_NUMBER } from '../../services/contact';

/** Floating bottom-right shortcut that opens a WhatsApp chat with Minutes. */
export default function WhatsAppButton() {
  return (
    <a
      className="whatsapp-fab"
      href={`https://wa.me/${WHATSAPP_NUMBER}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Minutes on WhatsApp"
      title="Chat on WhatsApp"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 11.6a8.6 8.6 0 0 1-12.7 7.6L3.5 20.5l1.4-4.1A8.6 8.6 0 1 1 20.5 11.6z" />
      </svg>
    </a>
  );
}
