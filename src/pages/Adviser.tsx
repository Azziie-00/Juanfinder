import { useCallback, useEffect, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ApplicationDeadline, { type AdviserApplicationStatus } from '../components/ApplicationDeadline';
import { API_BASE_URL, ApiResponseError, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import type { AdviserData } from '../data/datas';
import { coursesMatch } from '../data/courses';
import '../styles/adviser.css';

const PAGE_SIZE = 4;
type GroupApplicationContext = { GroupID: number; GroupName: string; Course: string; OwnerID: number; FinalizedAt: string | null; MembershipStatus: string; AdviserID: number | null };
const displayRequestError = (error: unknown, fallback: string) => error instanceof ApiResponseError ? error.message : fallback;
const requirementMimeType = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'doc') return 'application/msword';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
};
const fileToBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export default function Adviser() {
  const { user, viewRole, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedApplicationId = searchParams.get('application');
  const [advisers, setAdvisers] = useState<AdviserData[]>([]);
  const [page, setPage]           = useState(1);
  const [modalAdviser, setModalAdviser]   = useState<AdviserData | null>(null);
  const [toast, setToast]         = useState('');
  const [loadError, setLoadError] = useState('');
  const [applying, setApplying] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [requirementFiles, setRequirementFiles] = useState<File[]>([]);
  const [ownGroup, setOwnGroup] = useState<GroupApplicationContext | null>(null);
  const [groupApplication, setGroupApplication] = useState<AdviserApplicationStatus | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<AdviserApplicationStatus | null>(null);
  const [selectedError, setSelectedError] = useState('');
  const [editOpen, setEditOpen]   = useState(false);
  const [editBio, setEditBio]     = useState('');
  const [editGender, setEditGender] = useState('');
  const [editRequirements, setEditRequirements] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => setRevision(current => current + 1);
    window.addEventListener('juan-finder:adviser-applications-changed', refresh);
    return () => window.removeEventListener('juan-finder:adviser-applications-changed', refresh);
  }, []);
  const refreshApplications = useCallback(() => {
    setRevision(current => current + 1);
    window.dispatchEvent(new Event('juan-finder:notifications-changed'));
  }, []);

  useEffect(() => {
    if (effectiveRole !== 'student') return;
    const interval = window.setInterval(() => setRevision(current => current + 1), 30000);
    const refresh = () => setRevision(current => current + 1);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [effectiveRole]);
  useEffect(() => {
    if (!selectedApplicationId || !user || effectiveRole !== 'student') return;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/adviser-applications/${encodeURIComponent(selectedApplicationId)}`, { headers: authHeaders(user, viewRole), signal: controller.signal })
      .then(response => readApiResponse<{ application: AdviserApplicationStatus }>(response, 'Unable to load this application.'))
      .then(data => { if (!controller.signal.aborted) { setSelectedApplication(data.application); setSelectedError(''); } })
      .catch(error => { if (!controller.signal.aborted) setSelectedError(error instanceof Error ? error.message : 'Unable to load this application.'); });
    return () => controller.abort();
  }, [selectedApplicationId, user, viewRole, effectiveRole, revision]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoadError('');
      setStatusLoaded(false);
      try {
        const response = await fetch(`${API_BASE_URL}/advisers`, { headers: authHeaders(user, viewRole) });
        const records = await readApiResponse<{ UserID: number; Name: string; Bio?: string; Gender?: string; Requirements?: string; Course?: string; Availability: number; AssignedGroups?: number; HasCapacity?: boolean }[]>(response, 'Unable to load advisers. Please try again.');
        setAdvisers(records.map(record => ({
          id: String(record.UserID), name: record.Name, slots: record.AssignedGroups ?? 0, maxSlots: record.Availability,
          course: record.Course || '', availability: record.Availability, hasCapacity: record.HasCapacity,
          bio: record.Bio || 'No bio provided yet.', gender: record.Gender || '', requirements: record.Requirements ? record.Requirements.split('\n').filter(Boolean) : [],
        })));
        if (effectiveRole === 'student') {
          const groupResponse = await fetch(`${API_BASE_URL}/my-group`, { headers: authHeaders(user, viewRole) });
          const groupData = await readApiResponse<{ group?: GroupApplicationContext | null }>(groupResponse, 'Unable to check your group status. Please try again.');
          setOwnGroup(groupData.group || null);
          if (groupData.group?.MembershipStatus === 'Member') {
            const applicationResponse = await fetch(`${API_BASE_URL}/groups/${groupData.group.GroupID}/adviser-application`, { headers: authHeaders(user, viewRole) });
            try {
              const applicationData = await readApiResponse<{ application?: AdviserApplicationStatus | null }>(applicationResponse, 'Application status lookup failed.');
              setGroupApplication(applicationData.application || null);
              setStatusLoaded(true);
            } catch (error) {
              if (import.meta.env.DEV) console.error('Adviser page status request failed.', error);
              setGroupApplication(null);
              throw error;
            }
          } else {
            setGroupApplication(null);
          }
        } else {
          setOwnGroup(null);
          setGroupApplication(null);
        }

      } catch (requestError) {
        if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to load adviser data.', requestError);
        setLoadError(displayRequestError(requestError, 'Unable to load adviser data. Please try again.'));
      }
    };
    void load();
  }, [user, viewRole, effectiveRole, revision]);

  const pages = Math.max(1, Math.ceil(advisers.length / PAGE_SIZE));
  const slice = advisers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const canApply = effectiveRole === 'student' && ownGroup?.MembershipStatus === 'Member'
    && ownGroup.OwnerID === Number(user?.id) && Boolean(ownGroup.FinalizedAt) && !ownGroup.AdviserID && statusLoaded;
  const hasActiveApplication = groupApplication?.Status === 'Pending' || groupApplication?.Status === 'Accepted';
  const groupBlockReason = !ownGroup ? 'Join or create a group before applying.'
    : ownGroup.OwnerID !== Number(user?.id) ? 'Only your group leader can apply.'
    : !ownGroup.FinalizedAt ? 'Finalize your group before applying.'
    : ownGroup.AdviserID ? 'Your group is already assigned to an adviser.'
    : !statusLoaded ? 'Unable to check application eligibility. Use Refresh to try again.'
    : hasActiveApplication ? 'Your group already has a pending or accepted application.' : '';

  const confirmApply = async () => {
    if (!modalAdviser || !ownGroup || !canApply || hasActiveApplication || applying || !coursesMatch(ownGroup.Course, modalAdviser.course)) return;
    setApplying(true);
    setLoadError('');
    try {
      const body = {
        adviserId: Number(modalAdviser.id),
        requirements: await Promise.all(requirementFiles.map(async file => ({ fileName: file.name, mimeType: requirementMimeType(file), data: await fileToBase64(file) }))),
      };
      const response = await fetch(`${API_BASE_URL}/groups/${ownGroup.GroupID}/adviser-applications`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await readApiResponse<{ success?: boolean; application?: AdviserApplicationStatus }>(response, 'Unable to apply for this adviser. Please try again.');
      if (!data.application) throw new ApiResponseError('Unable to apply for this adviser. Please try again.');
      setGroupApplication(data.application);
      setToast(requirementFiles.length
        ? `Application and requirements sent to ${data.application.AdviserName || modalAdviser.name}.`
        : `Application sent to ${data.application.AdviserName || modalAdviser.name}.`);
      setRequirementFiles([]);
      setModalAdviser(null);
      setTimeout(() => setToast(''), 3000);
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to apply for adviser.', requestError);
      setLoadError(displayRequestError(requestError, 'Unable to apply for this adviser. Please try again.'));
    } finally {
      setApplying(false);
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
        {effectiveRole === 'student' && selectedApplicationId && <section className="adviser-applications mb-3" aria-label="Selected application">
          <h2>Application details</h2>
          {selectedError ? <p role="alert">{selectedError}</p> : selectedApplication && String(selectedApplication.ApplicationID) === selectedApplicationId ? <>
            <p><strong>{selectedApplication.GroupName}</strong> — {selectedApplication.AdviserName}</p>
            <p>Status: <strong>{selectedApplication.Status}</strong></p>
            <ApplicationDeadline application={selectedApplication} onDeadline={refreshApplications} />
          </> : <p role="status">Loading application...</p>}
        </section>}
        {effectiveRole === 'student' && (
          <div className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2" role="status">
            {ownGroup?.AdviserID && !groupApplication
              ? 'Your group is assigned to an adviser.'
              : groupApplication
              ? `Adviser application: ${groupApplication.Status}${groupApplication.AdviserName ? ` — ${groupApplication.AdviserName}` : ''}`
              : canApply
                ? `Apply for an adviser for ${ownGroup?.GroupName || 'your finalized group'}.`
                : groupBlockReason}
            {!ownGroup && <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/finder')}>Find or create a group</button>}
          </div>
        )}
        {effectiveRole === 'student' && groupApplication && <ApplicationDeadline application={groupApplication} onDeadline={refreshApplications} />}
        {effectiveRole === 'student' && canApply && !hasActiveApplication && advisers.length > 0 && advisers.every(adviser => adviser.hasCapacity === false) && (
          <div className="alert alert-warning py-2" role="status">No eligible advisers currently have capacity. Please try again later.</div>
        )}
        <div className="adviser-toolbar">
          <button className="adv-back-btn" onClick={() => setRevision(current => current + 1)} disabled={applying}>Refresh</button>
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
                <tr><td colSpan={3} className="adv-empty">No active advisers are available.</td></tr>
              ) : slice.map(a => {
                const assignedGroups = a.slots ?? 0;
                const hasCapacity = a.hasCapacity ?? assignedGroups < a.maxSlots;
                const matchingCourse = coursesMatch(ownGroup?.Course, a.course);
                const courseConfigured = Boolean(a.course?.trim() && a.course.trim().toLowerCase() !== 'unspecified');
                const blockedReason = groupBlockReason || (!courseConfigured
                  ? 'Adviser course is not configured. Ask an admin to set it.'
                  : !matchingCourse ? `Your group course (${ownGroup?.Course || 'not configured'}) must match the adviser course (${a.course}).`
                  : !hasCapacity ? 'This adviser has no remaining slots.' : '');
                return (
                  <tr key={a.id}>
                    <td><span className="adv-name-link">{a.name}</span><div className="small">{a.course || 'Course not configured'}</div></td>
                    <td><span className="adv-capacity-value">{Math.max(0, a.maxSlots - assignedGroups)}/{a.maxSlots}</span></td>
                    <td>
                      <button
                        className="adv-apply-link"
                        title={blockedReason || undefined}
                        aria-describedby={effectiveRole === 'student' && blockedReason ? `apply-reason-${a.id}` : undefined}
                        onClick={() => canApply && !hasActiveApplication && hasCapacity && matchingCourse && setModalAdviser(a)}
                        disabled={!canApply || hasActiveApplication || !hasCapacity || !matchingCourse}
                      >
                        Apply
                      </button>
                      {effectiveRole === 'student' && blockedReason && <small id={`apply-reason-${a.id}`} className="d-block mt-1">{blockedReason}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
      <Modal show={!!modalAdviser} onHide={() => { setModalAdviser(null); setRequirementFiles([]); setLoadError(''); }} centered className="jf-modal">
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
              <div className="adv-requirement-upload">
                <label className="jf-label" htmlFor="adviser-requirement-file">Application Requirements (optional)</label>
                <input
                  id="adviser-requirement-file"
                  className="form-control"
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple
                  disabled={applying}
                  onChange={event => {
                    const selected = Array.from(event.currentTarget.files || []);
                    event.currentTarget.value = '';
                    const combined = [...requirementFiles, ...selected];
                    if (combined.length > 5) { setLoadError('You can upload at most 5 files.'); return; }
                    if (selected.some(file => !requirementMimeType(file))) { setLoadError('Choose PDF, DOC, or DOCX requirements files.'); return; }
                    if (selected.some(file => file.size === 0)) { setLoadError('Empty files cannot be uploaded.'); return; }
                    if (combined.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) { setLoadError('Application files must total no more than 10 MB.'); return; }
                    setLoadError(''); setRequirementFiles(combined);
                  }}
                />
                {requirementFiles.map((file, index) => <div className="adv-requirement-selected" key={index}>
                  <span>{file.name}</span>
                  <button type="button" aria-label={'Remove ' + file.name} onClick={() => { setRequirementFiles(current => current.filter((_, i) => i !== index)); setLoadError(''); }} disabled={applying}>Remove</button>
                </div>)}
                <small>{requirementFiles.length}/5 files; {(requirementFiles.reduce((total, file) => total + file.size, 0) / (1024 * 1024)).toFixed(2)} / 10 MB total. PDF or Word files.</small>
                {loadError && <div className="alert alert-danger mb-0" role="alert">{loadError}</div>}
              </div>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button className="flex-grow-1" disabled={applying} style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void confirmApply()}>
                {applying ? 'Submitting…' : 'Confirm Application'}
              </Button>
              <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => { setModalAdviser(null); setRequirementFiles([]); }}>
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
