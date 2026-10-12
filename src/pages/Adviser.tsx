import { useEffect, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL, ApiResponseError, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import type { AdviserData } from '../data/datas';
import '../styles/adviser.css';

const PAGE_SIZE = 4;
type GroupApplicationContext = { GroupID: number; GroupName: string; OwnerID: number; FinalizedAt: string | null; MembershipStatus: string };
type AdviserApplication = { ApplicationID: number; GroupID: number; GroupName: string; Course: string; Applicant: string; Members: string[]; CreatedAt: string };
const displayRequestError = (error: unknown, fallback: string) => error instanceof ApiResponseError ? error.message : fallback;

export default function Adviser() {
  const { user, viewRole, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const [advisers, setAdvisers] = useState<AdviserData[]>([]);
  const [page, setPage]           = useState(1);
  const [modalAdviser, setModalAdviser]   = useState<AdviserData | null>(null);
  const [toast, setToast]         = useState('');
  const [loadError, setLoadError] = useState('');
  const [applying, setApplying] = useState(false);
  const [ownGroup, setOwnGroup] = useState<GroupApplicationContext | null>(null);
  const [groupApplication, setGroupApplication] = useState<{ Status: string; AdviserName: string } | null>(null);
  const [incomingApplications, setIncomingApplications] = useState<AdviserApplication[]>([]);
  const [editOpen, setEditOpen]   = useState(false);
  const [editBio, setEditBio]     = useState('');
  const [editGender, setEditGender] = useState('');
  const [editRequirements, setEditRequirements] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoadError('');
      try {
        const response = await fetch(`${API_BASE_URL}/advisers`, { headers: authHeaders(user, viewRole) });
        const records = await readApiResponse<{ UserID: number; Name: string; Bio?: string; Gender?: string; Requirements?: string; Course?: string; Availability: number; AssignedGroups?: number; HasCapacity?: boolean }[]>(response, 'Unable to load advisers. Please try again.');
        setAdvisers(records.map(record => ({
          id: String(record.UserID), name: record.Name, slots: record.AssignedGroups ?? 0, maxSlots: 10,
          course: record.Course || '', availability: 10, hasCapacity: record.HasCapacity,
          bio: record.Bio || 'No bio provided yet.', gender: record.Gender || '', requirements: record.Requirements ? record.Requirements.split('\n').filter(Boolean) : [],
        })));
        if (effectiveRole === 'student') {
          const groupResponse = await fetch(`${API_BASE_URL}/my-group`, { headers: authHeaders(user, viewRole) });
          const groupData = await readApiResponse<{ group?: GroupApplicationContext | null }>(groupResponse, 'Unable to check your group status. Please try again.');
          setOwnGroup(groupData.group || null);
          if (groupData.group?.MembershipStatus === 'Member') {
            const applicationResponse = await fetch(`${API_BASE_URL}/groups/${groupData.group.GroupID}/adviser-application`, { headers: authHeaders(user, viewRole) });
            try {
              const applicationData = await readApiResponse<{ application?: { Status: string; AdviserName: string } | null }>(applicationResponse, 'Application status lookup failed.');
              setGroupApplication(applicationData.application || null);
            } catch (error) {
              if (import.meta.env.DEV) console.error('Adviser page status request failed.', error);
              setGroupApplication(null);
            }
          } else {
            setGroupApplication(null);
          }
        } else {
          setOwnGroup(null);
          setGroupApplication(null);
        }
        if (effectiveRole === 'adviser') {
          const applicationResponse = await fetch(`${API_BASE_URL}/adviser/applications`, { headers: authHeaders(user, viewRole) });
          const applicationData = await readApiResponse<AdviserApplication[]>(applicationResponse, 'Unable to load adviser applications. Please try again.');
          setIncomingApplications(applicationData);
        }
      } catch (requestError) {
        if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to load adviser data.', requestError);
        setLoadError(displayRequestError(requestError, 'Unable to load adviser data. Please try again.'));
      }
    };
    void load();
  }, [user, viewRole, effectiveRole]);

  const pages = Math.max(1, Math.ceil(advisers.length / PAGE_SIZE));
  const slice = advisers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const canApply = effectiveRole === 'student' && ownGroup?.MembershipStatus === 'Member'
    && ownGroup.OwnerID === Number(user?.id) && Boolean(ownGroup.FinalizedAt);
  const hasActiveApplication = Boolean(groupApplication && groupApplication.Status !== 'Rejected');

  const confirmApply = async () => {
    if (!modalAdviser || !ownGroup || !canApply || applying) return;
    setApplying(true);
    setLoadError('');
    try {
      const response = await fetch(`${API_BASE_URL}/groups/${ownGroup.GroupID}/adviser-applications`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ adviserId: Number(modalAdviser.id) }),
      });
      const data = await readApiResponse<{ success?: boolean; application?: { Status: string; AdviserName: string } }>(response, 'Unable to apply for this adviser. Please try again.');
      if (!data.application) throw new ApiResponseError('Unable to apply for this adviser. Please try again.');
      setGroupApplication(data.application);
      setToast(`Application sent to ${data.application.AdviserName || modalAdviser.name}.`);
      setModalAdviser(null);
      setTimeout(() => setToast(''), 3000);
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to apply for adviser.', requestError);
      setLoadError(displayRequestError(requestError, 'Unable to apply for this adviser. Please try again.'));
    } finally {
      setApplying(false);
    }
  };

  const respondToApplication = async (applicationId: number, action: 'accept' | 'reject') => {
    try {
      const response = await fetch(`${API_BASE_URL}/adviser/applications/${applicationId}/respond`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action }),
      });
      await readApiResponse(response, 'Unable to process this application. Please try again.');
      setIncomingApplications(current => current.filter(application => application.ApplicationID !== applicationId));
      setToast(action === 'accept' ? 'Application accepted and group members assigned.' : 'Application rejected.');
      setTimeout(() => setToast(''), 3000);
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to process adviser application.', requestError);
      setLoadError(displayRequestError(requestError, 'Unable to process this application. Please try again.'));
    }
  };

  const openEdit = () => {
    const ownProfile = advisers.find(adviser => adviser.id === String(user?.id));
    setEditBio(ownProfile?.bio === 'No bio provided yet.' ? '' : ownProfile?.bio || '');
    setEditGender(ownProfile?.gender || '');
    setEditRequirements(ownProfile?.requirements.length ? [...ownProfile.requirements] : ['']);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/adviser/profile`, {
        method: 'PATCH', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ bio: editBio, gender: editGender, requirements: editRequirements }),
      });
      await readApiResponse(response, 'Unable to save adviser details. Please try again.');
      const savedRequirements = editRequirements.map(item => item.trim()).filter(Boolean);
      setAdvisers(current => current.map(adviser => adviser.id === String(user?.id) ? { ...adviser, bio: editBio || 'No bio provided yet.', gender: editGender, requirements: savedRequirements } : adviser));
      setEditOpen(false);
      setToast('Adviser details saved.');
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to save adviser details.', requestError);
      setToast(displayRequestError(requestError, 'Unable to save adviser details. Please try again.'));
    }
  };

  return (
    <Layout>
      <div className="adviser-body">
        {loadError && <div className="alert alert-danger py-2" role="alert">{loadError}</div>}
        {effectiveRole === 'student' && (
          <div className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2" role="status">
            {groupApplication
              ? `Adviser application: ${groupApplication.Status}${groupApplication.AdviserName ? ` — ${groupApplication.AdviserName}` : ''}`
              : canApply
                ? `Apply for an adviser for ${ownGroup?.GroupName || 'your finalized group'}.`
                : 'Finalize your group as its leader before applying for an adviser.'}
            {!ownGroup && <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/finder')}>Find or create a group</button>}
          </div>
        )}
        {effectiveRole === 'student' && canApply && !hasActiveApplication && advisers.length > 0 && advisers.every(adviser => adviser.hasCapacity === false) && (
          <div className="alert alert-warning py-2" role="status">No eligible advisers currently have capacity. Please try again later.</div>
        )}
        <div className="adviser-toolbar">
          <button className="adv-back-btn" onClick={() => window.history.back()}>
            <i className="ti ti-arrow-left"></i> BACK
          </button>
          <div className="adv-page-arrows">
            <button className="adv-arrow-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <i className="ti ti-arrow-left"></i>
            </button>
            <button className="adv-arrow-btn" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>
              <i className="ti ti-arrow-right"></i>
            </button>
          </div>
          {effectiveRole === 'adviser' && <button className="adv-back-btn" onClick={openEdit}><i className="ti ti-edit"></i> EDIT DETAILS</button>}
        </div>

        <div className="adviser-table-card">
          <table className="adviser-table">
            <thead>
              <tr>
                <th>Adviser</th>
                <th>Available Slots</th>
                <th>Requirements</th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr><td colSpan={3} className="adv-empty">No eligible advisers are available for your course.</td></tr>
              ) : slice.map(a => {
                const assignedGroups = a.slots ?? 0;
                const hasCapacity = a.hasCapacity ?? assignedGroups < 10;
                return (
                  <tr key={a.id}>
                    <td><span className="adv-name-link">{a.name}</span></td>
                    <td><span className="adv-capacity-value">--/10</span></td>
                    <td>
                      <button
                        className="adv-apply-link"
                        onClick={() => canApply && !hasActiveApplication && hasCapacity && setModalAdviser(a)}
                        disabled={!canApply || hasActiveApplication || !hasCapacity}
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {effectiveRole === 'adviser' && (
          <section className="adviser-applications">
            <h2>Group Adviser Applications</h2>
            {incomingApplications.length === 0 ? <p>No pending group applications.</p> : incomingApplications.map(application => (
              <article className="adviser-application-card" key={application.ApplicationID}>
                <div><strong>{application.GroupName}</strong><span>{application.Course} · Applicant: {application.Applicant}</span><span>Members: {application.Members.join(', ') || 'No members listed'}</span></div>
                <div className="d-flex gap-2">
                  <button className="adv-apply-link" onClick={() => void respondToApplication(application.ApplicationID, 'accept')}>Accept</button>
                  <button className="adv-apply-link" onClick={() => void respondToApplication(application.ApplicationID, 'reject')}>Reject</button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      <Modal show={editOpen} onHide={() => setEditOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-edit"></i></div>
          <div className="modal-title-text">Edit Adviser Details</div>
          <div className="modal-sub-text">Set the profile, requirements, and capacity students will see.</div>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <label className="jf-label">Bio<textarea className="jf-input" rows={3} value={editBio} onChange={event => setEditBio(event.target.value)} /></label>
          <label className="jf-label">Gender
            <select className="jf-input" value={editGender} onChange={event => setEditGender(event.target.value)}>
              <option value="">Select gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </label>
          <div className="jf-label">Requirements</div>
          {editRequirements.map((requirement, index) => (
            <div key={index} className="d-flex align-items-center gap-2">
              <span aria-label={`Requirement ${index + 1}`} style={{ minWidth: 24 }}>{index + 1}.</span>
              <input className="jf-input flex-grow-1" aria-label={`Requirement ${index + 1} description`} value={requirement} maxLength={250} onChange={event => setEditRequirements(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
              <Button variant="outline-danger" aria-label={`Delete requirement ${index + 1}`} onClick={() => setEditRequirements(current => current.filter((_, itemIndex) => itemIndex !== index))}><i className="ti ti-trash"></i></Button>
            </div>
          ))}
          <Button variant="outline-warning" onClick={() => setEditRequirements(current => [...current, ''])}><i className="ti ti-plus"></i> Add Requirement</Button>
        </Modal.Body>
        <Modal.Footer className="gap-2"><Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700 }} onClick={() => void saveEdit()}>Save</Button><Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)' }} onClick={() => setEditOpen(false)}>Cancel</Button></Modal.Footer>
      </Modal>

      {/*Apply Modal*/}
      <Modal show={!!modalAdviser} onHide={() => setModalAdviser(null)} centered className="jf-modal">
        {modalAdviser && (
          <>
            <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
              <div className="modal-icon mb-2"><i className="ti ti-user-circle"></i></div>
              <div className="modal-title-text">Apply to {modalAdviser.name}</div>
              <div className="modal-sub-text">Review the requirements before applying</div>
            </Modal.Header>
            <Modal.Body>
              <p className="adv-application-capacity">
                Adviser capacity: {modalAdviser.availability ?? modalAdviser.maxSlots} groups
              </p>
              <div className="d-flex flex-column gap-2">
                {modalAdviser.requirements.length
                  ? <ol className="adv-application-requirements">{modalAdviser.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ol>
                  : <p className="adv-application-no-requirements">No additional requirements specified.</p>}
              </div>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button className="flex-grow-1" disabled={applying} style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void confirmApply()}>
                {applying ? 'Submitting…' : 'Confirm Application'}
              </Button>
              <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setModalAdviser(null)}>
                Cancel
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
