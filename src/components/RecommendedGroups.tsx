import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL } from '../data/api';
import type { GroupData } from '../data/datas';

interface Recommendation {
  group: GroupData;
  reason: string;
  matchedSkills: string[];
}

export default function RecommendedGroups({ onViewGroup }: { onViewGroup: (group: GroupData) => void }) {
  const { user, viewRole } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Find open groups where your profile skills can contribute.');
  const [error, setError] = useState('');
  const [needsSkills, setNeedsSkills] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const loadRecommendations = async () => {
    if (!user || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setRecommendations([]);
    setNeedsSkills(false);
    try {
      const response = await fetch(`${API_BASE_URL}/groups/recommendations`, {
        method: 'POST', headers: authHeaders(user, viewRole), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to get recommendations. Please try again.');
      if (!controller.signal.aborted) {
        setRecommendations(data.recommendations);
        setNeedsSkills(Boolean(data.needsSkills));
        setMessage(data.message || 'Suggested for your skills. Review a group before requesting to join.');
        setLoaded(true);
      }
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Unable to get recommendations. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      request.current = null;
    }
  };

  return (
    <section className="recommended-groups" aria-labelledby="recommended-groups-heading" aria-busy={loading}>
      <div className="recommended-groups-header">
        <div>
          <h2 id="recommended-groups-heading"><i className="ti ti-sparkles" aria-hidden="true" /> Recommended groups</h2>
          <p>Skill matches powered by Llama 3.1</p>
        </div>
        <button className="recommended-groups-action" onClick={() => void loadRecommendations()} disabled={loading}>
          {loading ? 'Finding matches…' : error ? 'Try again' : loaded ? 'Refresh matches' : 'Find my matches'}
        </button>
      </div>
      {error ? <p className="recommended-groups-error" role="alert">{error}</p> : (
        <p role="status">{loading ? 'Comparing your saved skills with open groups. This may take a minute.' : message}</p>
      )}
      {needsSkills && <Link to="/profile">Add skills to my profile →</Link>}
      <div className="recommended-groups-grid">
        {recommendations.map(({ group, reason, matchedSkills }) => (
          <article className="recommended-group-card" key={group.id}>
            <div className="recommended-group-meta">{group.course} · {group.maxMembers - group.members} open {group.maxMembers - group.members === 1 ? 'place' : 'places'}</div>
            <h3>{group.name}</h3>
            <p>{reason}</p>
            <div className="recommended-group-skills" aria-label="Matching profile skills">
              {matchedSkills.map(skill => <span key={skill}>{skill}</span>)}
            </div>
            <button className="recommended-groups-action" onClick={() => onViewGroup(group)}>View group</button>
          </article>
        ))}
      </div>
    </section>
  );
}
