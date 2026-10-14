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

interface RecommendedGroupsProps {
  unavailable: boolean;
  onMatchesChange: (groups: GroupData[]) => void;
  onJoinGroup: (group: GroupData) => Promise<void>;
}

export default function RecommendedGroups({ unavailable, onMatchesChange, onJoinGroup }: RecommendedGroupsProps) {
  const { user, viewRole } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Find open groups where your profile skills can contribute.');
  const [error, setError] = useState('');
  const [needsSkills, setNeedsSkills] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const joinPending = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const loadRecommendations = async () => {
    if (!user || request.current || unavailable || joinPending.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setRecommendations([]);
    onMatchesChange([]);
    setJoinError('');
    setNeedsSkills(false);
    try {
      const response = await fetch(`${API_BASE_URL}/groups/recommendations`, {
        method: 'POST', headers: authHeaders(user, viewRole), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to get recommendations. Please try again.');
      if (!controller.signal.aborted) {
        setRecommendations(data.recommendations);
        onMatchesChange(data.recommendations.map((item: Recommendation) => item.group));
        setNeedsSkills(Boolean(data.needsSkills));
        setMessage(data.message || 'Open groups that match your saved profile skills.');
        setLoaded(true);
      }
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Unable to get recommendations. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      request.current = null;
    }
  };

  const requestToJoin = async (group: GroupData) => {
    if (joinPending.current || unavailable) return;
    joinPending.current = true;
    setJoining(group.id);
    setJoinError('');
    try {
      await onJoinGroup(group);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Unable to send your join request. Please try again.');
    } finally {
      joinPending.current = false;
      setJoining(null);
    }
  };

  return (
    <section className="groups-card recommended-groups" aria-labelledby="recommended-groups-heading" aria-busy={loading}>
      <div className="recommended-groups-header">
        <div>
          <h2 id="recommended-groups-heading" className="groups-title">Recommended groups <span className="ai-badge">AI-powered</span></h2>
          <p>Skill matches powered by Llama 3.2 1B</p>
        </div>
        {!unavailable && <button className="recommended-groups-action" onClick={() => void loadRecommendations()} disabled={loading || joining !== null}>
          {loading ? 'Finding matches…' : error ? 'Try again' : loaded ? 'Refresh matches' : 'Find my matches'}
        </button>}
      </div>
      {unavailable ? <div className="recommended-groups-status" role="status">
        <p>You already have a group or a pending join request.</p>
        <Link to="/mygroup">View My Group →</Link>
      </div> : <>
      {error ? <p className="recommended-groups-error" role="alert">{error}</p> : (
        <p role="status">{loading ? 'Comparing your saved skills with open groups. This may take a minute.' : message}</p>
      )}
      {needsSkills && <Link to="/profile">Add skills to my profile →</Link>}
      {joinError && <p className="recommended-groups-error" role="alert">{joinError}</p>}
      <div className="recommended-groups-grid">
        {recommendations.map(({ group, reason, matchedSkills }) => (
          <article className="group-card recommended-group-card" key={group.id}>
            <div className="recommended-group-meta">{group.course} · {group.maxMembers - group.members} open {group.maxMembers - group.members === 1 ? 'place' : 'places'}</div>
            <h3>{group.name}</h3>
            <p className="recommended-group-description">{group.desc}</p>
            <p>{reason}</p>
            <div className="recommended-group-skills" aria-label="Matching profile skills">
              {matchedSkills.map(skill => <span key={skill}>{skill}</span>)}
            </div>
            <button className="group-card-join" onClick={() => void requestToJoin(group)} disabled={joining !== null}>
              {joining === group.id ? 'Sending request…' : 'Request to join →'}
            </button>
          </article>
        ))}
      </div>
      </>}
    </section>
  );
}
