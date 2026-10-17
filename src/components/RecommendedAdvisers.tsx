import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, readApiResponse } from '../data/api';

type AdviserMatches = {
  recommendations: {
    adviser: { id: string; name: string; course: string; remainingSlots: number };
    reason: string; evidence: string;
  }[];
  message?: string; groupName?: string; canApply?: boolean; applicationHint?: string;
};

export default function RecommendedAdvisers() {
  const { user, viewRole } = useAuth();
  const [result, setResult] = useState<AdviserMatches>({ recommendations: [] });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const findMatches = async () => {
    if (!user || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setResult({ recommendations: [] });
    try {
      const response = await fetch(`${API_BASE_URL}/advisers/recommendations`, {
        method: 'POST', headers: authHeaders(user, viewRole), signal: controller.signal,
      });
      const data = await readApiResponse<AdviserMatches>(response, 'Unable to find adviser matches. Please try again.');
      if (!Array.isArray(data.recommendations)) throw new Error('Unable to read adviser matches. Please try again.');
      if (!controller.signal.aborted) { setResult(data); setLoaded(true); }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to find adviser matches.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      request.current = null;
    }
  };

  return <section className="adviser-rec-card recommended-advisers" aria-labelledby="recommended-advisers-heading" aria-busy={loading}>
    <div className="announce-head recommendation-panel-head">
      <div className="adviser-avatar" aria-hidden="true"><i className="ti ti-user"></i></div>
      <h2 id="recommended-advisers-heading" className="announce-title">Recommended adviser <span className="ai-badge">AI-powered</span></h2>
    </div>
    <div className="recommendation-toolbar">
      <p>Powered by Llama 3.2 1B</p>
      <button type="button" className="recommended-groups-action" onClick={() => void findMatches()} disabled={loading}>
        {loading ? 'Finding matches…' : error ? 'Try again' : loaded ? 'Refresh matches' : 'Find my adviser'}
      </button>
    </div>
    <div className="recommendation-panel-body" tabIndex={0} role="region" aria-label="Adviser recommendation results">
      {error ? <p className="recommended-groups-error" role="alert">{error}</p>
        : <p role="status">{loading ? 'Comparing your group title and description with adviser expertise. This may take a minute.'
          : result.message || 'Find advisers whose expertise fits your group title and description.'}</p>}
      {result.groupName && <p><strong>For {result.groupName}</strong></p>}
      {result.applicationHint && <p>{result.applicationHint} <Link to="/mygroup">View My Group →</Link></p>}
      <div className="recommended-advisers-list">
        {result.recommendations.map(({ adviser, reason, evidence }) => <article className="adviser-rec-item" key={adviser.id}>
          <div className="adviser-rec-info">
            <h3 className="adviser-rec-name">{adviser.name}</h3>
            <p className="recommended-group-meta">{adviser.course} · {adviser.remainingSlots} available {adviser.remainingSlots === 1 ? 'slot' : 'slots'}</p>
            <p>{reason}</p>
            <p className="adviser-rec-evidence">Profile expertise: “{evidence}”</p>
          </div>
          <Link className="adviser-rec-apply" to={`/adviser?adviser=${encodeURIComponent(adviser.id)}`}>
            {result.canApply ? 'Review & apply →' : 'View adviser →'}
          </Link>
        </article>)}
      </div>
      {!loading && <Link className="recommendation-browse" to="/adviser">Browse all advisers →</Link>}
    </div>
  </section>;
}
