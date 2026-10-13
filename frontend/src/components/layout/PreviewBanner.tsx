import { previewMode } from '../../services/config';

/** Shown only in dev preview so mock data is never mistaken for live data. */
export default function PreviewBanner() {
  if (!previewMode) return null;
  return (
    <div className="preview-banner" role="note">
      Preview mode: showing sample data. Set <code>VITE_API_BASE_URL</code> to connect your backend.
    </div>
  );
}
