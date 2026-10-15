import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spinner } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/adviser-groups.css';

type AdviserGroupRecord = {
  GroupID: number;
  GroupName: string;
  Course: string;
  Status: string;
  FinalizedAt: string | null;
  MemberCount: number;
  MemberNames: string;
  Members: { UserID: number; Name: string; IsLeader: boolean }[];
};
type RequirementDocument = { DocumentID: number; FileName: string; FileType: string; FileSize: number; UploadedAt: string } | null;
type PendingApplication = {
  ApplicationID: number;
  GroupID: number;
  GroupName: string;
  Course: string;
  Applicant: string;
  Members: string[];
  CreatedAt: string;
  Requirement: RequirementDocument;
};

export default function AdviserGroup() {
  const { user, viewRole } = useAuth();
  const [groups, setGroups] = useState<AdviserGroupRecord[]>([]);
  const [applications, setApplications] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyApplication, setBusyApplication] = useState<number | null>(null);
  const [requirementsBusy, setRequirementsBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingOpen, setPendingOpen] = useState(false);

  const fetchGroupsAndApplications = useCallback(async () => {
    if (!user) return { groupRecords: [], pendingRecords: [] };
    const [groupsResponse, applicationsResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/adviser/groups`, { headers: authHeaders(user, viewRole) }),
      fetch(`${API_BASE_URL}/adviser/applications`, { headers: authHeaders(user, viewRole) }),
    ]);
    const [groupRecords, pendingRecords] = await Promise.all([
      readApiResponse<AdviserGroupRecord[]>(groupsResponse, 'Unable to load your accepted groups.'),
      readApiResponse<PendingApplication[]>(applicationsResponse, 'Unable to load pending applications.'),
    ]);
    return { groupRecords, pendingRecords };
  }, [user, viewRole]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const { groupRecords, pendingRecords } = await fetchGroupsAndApplications();
      setGroups(groupRecords);
      setApplications(pendingRecords);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load adviser groups.');
    } finally {
      setLoading(false);
    }
  }, [user, fetchGroupsAndApplications]);

  useEffect(() => {
    let active = true;
    fetchGroupsAndApplications().then(({ groupRecords, pendingRecords }) => {
      if (!active) return;
      setGroups(groupRecords);
      setApplications(pendingRecords);
    }).catch(requestError => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load adviser groups.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fetchGroupsAndApplications]);

  const respond = async (application: PendingApplication, action: 'accept' | 'reject') => {
    setBusyApplication(application.ApplicationID);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/adviser/applications/${application.ApplicationID}/respond`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action }),
      });
      await readApiResponse(response, 'Unable to process this application.');
      setNotice(action === 'accept' ? `${application.GroupName} accepted.` : `${application.GroupName} declined.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to process this application.');
    } finally {
      setBusyApplication(null);
    }
  };

  const openRequirement = async (application: PendingApplication) => {
    if (!application.Requirement) return;
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      setError('Allow pop-ups to open the uploaded requirements document.');
      return;
    }
    previewWindow.opener = null;
    setRequirementsBusy(application.ApplicationID);
    setError('');
    try {
      const response = await fetch(
        `${API_BASE_URL}/adviser/applications/${application.ApplicationID}/requirements/${application.Requirement.DocumentID}`,
        { headers: authHeaders(user, viewRole) },
      );
      const data = await readApiResponse<{ url: string }>(response, 'Unable to open this requirements document.');
      previewWindow.location.href = data.url;
    } catch (requestError) {
      previewWindow.close();
      setError(requestError instanceof Error ? requestError.message : 'Unable to open this requirements document.');
    } finally {
      setRequirementsBusy(null);
    }
  };

  return (
    <Layout>
      <main className="adviser-groups-page">
        <header className="adviser-groups-header">
          <div>
            <div className="admin-eyebrow">ADVISER WORKSPACE</div>
            <h1>Groups</h1>
            <p>Review groups that have been assigned to you.</p>
          </div>
          <div className="adviser-groups-header-actions">
            <Button className="adviser-pending-button" onClick={() => setPendingOpen(true)}>
              <i className="ti ti-clock" aria-hidden="true" /> Pending
              <span className="adviser-pending-count">{applications.length}</span>
            </Button>
            <Button variant="light" aria-label="Refresh groups" onClick={() => void load()} disabled={loading}>
              <i className="ti ti-refresh" aria-hidden="true" />
            </Button>
          </div>
        </header>

        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
        {notice && <div className="alert alert-success py-2" role="status">{notice}</div>}

        <section className="adviser-groups-card">
          <div className="adviser-groups-card-header">
            <div>
              <h2>Accepted Groups</h2>
              <p>Groups currently assigned to your adviser account.</p>
            </div>
            <span className="adviser-group-total">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
          </div>
          {loading ? (
            <div className="adviser-groups-state"><Spinner animation="border" size="sm" /> Loading groups…</div>
          ) : groups.length === 0 ? (
            <div className="adviser-groups-state">No accepted groups have been assigned to you yet.</div>
          ) : (
            <div className="adviser-groups-table-wrap">
              <table className="adviser-groups-table">
                <thead>
                  <tr><th>Group</th><th>Course</th><th>Members</th><th>Member Count</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {groups.map(group => (
                    <tr key={group.GroupID}>
                      <td><strong>{group.GroupName}</strong></td>
                      <td>{group.Course || '—'}</td>
                      <td>
                        <div className="adviser-group-member-list">
                          {group.Members?.length
                            ? group.Members.map(member => (
                              <span className="adviser-group-member" key={member.UserID}>
                                {member.Name}{member.IsLeader && <small>Leader</small>}
                              </span>
                            ))
                            : group.MemberNames.split('|').filter(Boolean).map(name => <span className="adviser-group-member" key={name}>{name}</span>)}
                        </div>
                      </td>
                      <td>{group.MemberCount}</td>
                      <td><span className="adviser-group-status">Accepted</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <Modal show={pendingOpen} onHide={() => setPendingOpen(false)} centered size="lg" scrollable className="jf-modal adviser-pending-modal">
        <Modal.Header closeButton closeVariant="white">
          <div>
            <div className="modal-title-text text-start">Pending Group Applications</div>
            <div className="modal-sub-text text-start">Review each group, its members, and uploaded requirements.</div>
          </div>
        </Modal.Header>
        <Modal.Body>
          {applications.length === 0 ? (
            <div className="adviser-groups-state">There are no pending group applications.</div>
          ) : applications.map(application => (
            <article className="adviser-pending-card" key={application.ApplicationID}>
              <div className="adviser-pending-card-heading">
                <div>
                  <h3>{application.GroupName}</h3>
                  <span>{application.Course || 'Course not specified'} · Applied {new Date(application.CreatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <dl className="adviser-pending-details">
                <div><dt>Applicant</dt><dd>{application.Applicant}</dd></div>
                <div><dt>Group members</dt><dd>{application.Members.length ? application.Members.join(', ') : 'No members listed'}</dd></div>
              </dl>
              <div className="adviser-pending-requirement">
                <strong>Uploaded requirements</strong>
                {application.Requirement ? (
                  <div className="adviser-requirement-file">
                    <i className="ti ti-file-text" aria-hidden="true" />
                    <span>{application.Requirement.FileName}</span>
                    <Button size="sm" variant="outline-warning" disabled={requirementsBusy === application.ApplicationID} onClick={() => void openRequirement(application)}>
                      {requirementsBusy === application.ApplicationID ? 'Opening…' : 'View / Download'}
                    </Button>
                  </div>
                ) : <span className="adviser-no-requirement">No file was uploaded with this application.</span>}
              </div>
              <div className="adviser-pending-actions">
                <Button variant="success" disabled={busyApplication === application.ApplicationID} onClick={() => void respond(application, 'accept')}>
                  {busyApplication === application.ApplicationID ? 'Saving…' : 'Accept'}
                </Button>
                <Button variant="outline-danger" disabled={busyApplication === application.ApplicationID} onClick={() => void respond(application, 'reject')}>Decline</Button>
              </div>
            </article>
          ))}
        </Modal.Body>
      </Modal>
    </Layout>
  );
}
