import { useEffect, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/adviser.css';
import '../styles/adviser-groups.css';

type AdviserGroupRecord = { GroupID: number; GroupName: string; Course: string; MemberCount: number };

export default function AdviserGroup() {
  const { user, viewRole } = useAuth();
  const [groups, setGroups] = useState<AdviserGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (!user) return;
      try {
        const response = await fetch(API_BASE_URL + '/adviser/groups', { headers: authHeaders(user, viewRole), signal: controller.signal });
        const records = await readApiResponse<AdviserGroupRecord[]>(response, 'Unable to load your accepted groups.');
        if (!controller.signal.aborted) { setGroups(records); setError(''); }
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Unable to load adviser groups.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('juan-finder:adviser-applications-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.removeEventListener('juan-finder:adviser-applications-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [user, viewRole]);
  return <Layout><main className="adviser-body">
    <header className="adviser-toolbar"><h1 className="h4 m-0">Groups</h1></header>
    {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
    <section className="adviser-table-card adviser-group-summary" aria-label="Accepted groups">
      <table className="adviser-table">
        <thead><tr><th>Group name</th><th>Course</th><th>Member count</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={3}><Spinner animation="border" size="sm" /> Loading groups...</td></tr>
          : groups.length === 0 ? <tr><td colSpan={3} className="adv-empty">No accepted groups have been assigned to you yet.</td></tr>
          : groups.map(group => <tr key={group.GroupID}><td>{group.GroupName}</td><td>{group.Course || '?'}</td><td>{group.MemberCount}</td></tr>)}</tbody>
      </table>
    </section>
  </main></Layout>;
}
