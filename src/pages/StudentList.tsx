import { useCallback, useEffect, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/adviser-groups.css';

type AdviserGroupRecord = {
  GroupID: number;
  GroupName: string;
  Course: string;
  MemberCount: number;
  Members: { UserID: number; Name: string; IsLeader: boolean }[];
};

export default function StudentList() {
  const { user, viewRole } = useAuth();
  const [groups, setGroups] = useState<AdviserGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchGroups = useCallback(async () => {
    if (!user) return [];
    const response = await fetch(`${API_BASE_URL}/adviser/groups`, { headers: authHeaders(user, viewRole) });
    return readApiResponse<AdviserGroupRecord[]>(response, 'Unable to load your assigned group members.');
  }, [user, viewRole]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGroups(await fetchGroups());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load your assigned group members.');
    } finally {
      setLoading(false);
    }
  }, [fetchGroups]);

  useEffect(() => {
    let active = true;
    fetchGroups().then(records => {
      if (active) setGroups(records);
    }).catch(requestError => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load your assigned group members.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fetchGroups]);

  return (
    <Layout>
      <main className="adviser-groups-page student-members-page">
        <header className="adviser-groups-header">
          <div>
            <div className="admin-eyebrow">ADVISER WORKSPACE</div>
            <h1>Student Members</h1>
            <p>Group members from capstone groups assigned to you.</p>
          </div>
          <button className="admin-refresh" type="button" aria-label="Refresh student members" onClick={() => void loadGroups()} disabled={loading}>
            <i className="ti ti-refresh" aria-hidden="true"></i>
          </button>
        </header>

        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}

        <section className="adviser-groups-card">
          <div className="adviser-groups-card-header">
            <div>
              <h2>Assigned Group Members</h2>
              <p>Each student is listed with their group.</p>
            </div>
            <span className="adviser-group-total">{groups.reduce((count, group) => count + group.MemberCount, 0)} students</span>
          </div>
          {loading ? (
            <div className="adviser-groups-state"><Spinner animation="border" size="sm" /> Loading student members…</div>
          ) : groups.length === 0 ? (
            <div className="adviser-groups-state">No group members have been assigned to you yet.</div>
          ) : (
            <div className="adviser-groups-table-wrap">
              <table className="adviser-groups-table student-member-table">
                <thead>
                  <tr><th>Student</th><th>Group name</th><th>Course</th></tr>
                </thead>
                <tbody>
                  {groups.flatMap(group => group.Members.map(member => (
                    <tr className="student-member-row" key={`${group.GroupID}-${member.UserID}`}>
                      <td data-label="Student"><strong>{member.Name}</strong>{member.IsLeader && <small className="student-leader-label">Leader</small>}</td>
                      <td data-label="Group name">{group.GroupName}</td>
                      <td data-label="Course">{group.Course || '?'}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}
