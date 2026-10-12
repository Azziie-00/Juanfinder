import { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL, ApiResponseError, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import { getInitials } from '../data/datas';
import type { MyGroupData, GroupMember, PendingRequest } from '../data/datas';
import '../styles/mygroup.css';

const API = API_BASE_URL;
const LOAD_GROUP_ERROR = 'Unable to load your group information. Please try again.';
const displayError = (error: unknown, fallback: string) => error instanceof ApiResponseError ? error.message : fallback;

interface EditForm { name: string; desc: string; skills: string; max: string; }

export default function MyGroup() {
  const { user, viewRole } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<MyGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen]       = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState<'Member' | 'Pending'>('Member');
  const [editForm, setEditForm]       = useState<EditForm>({ name:'', desc:'', skills:'', max:'4' });
  const [editError, setEditError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [adviserApplication, setAdviserApplication] = useState<{ Status: string; AdviserName: string } | null>(null);
  const isFinalized = Boolean(group?.finalizedAt);

  const save = (updated: MyGroupData) => {
    setGroup(updated);
    sessionStorage.setItem('jf_mygroup', JSON.stringify(updated));
    window.dispatchEvent(new Event('jf-mygroup-updated'));
  };

  const loadGroup = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setActionError('');
    try {
      const response = await fetch(`${API}/my-group`, { headers: authHeaders(user, viewRole) });
      const data = await readApiResponse<{ group: { GroupID: number; GroupName: string; Course: string; Specialty: string; Description: string; OwnerID: number; Status: string; FinalizedAt: string | null; MaxMembers: number; MembershipStatus: string; members: { UserID: number; Name: string; Role: string }[]; pending: { RequestID: number; UserID: number; Name: string; UserCode: string; ExpiresAt: string }[] } | null }>(response, LOAD_GROUP_ERROR);
      if (!data || !Object.prototype.hasOwnProperty.call(data, 'group')) throw new ApiResponseError(LOAD_GROUP_ERROR);
      if (!data.group) {
        setGroup(null);
        setMembershipStatus('Member');
        setAdviserApplication(null);
        sessionStorage.removeItem('jf_mygroup');
        window.dispatchEvent(new Event('jf-mygroup-updated'));
        return;
      }
      const remote = data.group;
      setMembershipStatus(remote.MembershipStatus === 'Pending' ? 'Pending' : 'Member');
      const nextGroup: MyGroupData = {
        id: String(remote.GroupID), name: remote.GroupName, desc: remote.Description,
        specialty: remote.Specialty, maxMembers: remote.MaxMembers,
        skills: remote.Specialty.split('/').map(skill => skill.trim()).filter(Boolean),
        members: remote.members.map(member => ({ name: member.Name, role: (member.UserID === remote.OwnerID ? 'owner' : 'member') as 'owner' | 'member' })),
        pending: remote.pending.map(request => ({ id: String(request.RequestID), name: request.Name, course: request.UserCode, userId: request.UserID, expiresAt: request.ExpiresAt })),
        ownerId: remote.OwnerID, status: remote.Status, finalizedAt: remote.FinalizedAt,
      };
      save(nextGroup);
      if (remote.MembershipStatus === 'Member') {
        const applicationResponse = await fetch(`${API}/groups/${encodeURIComponent(nextGroup.id)}/adviser-application`, { headers: authHeaders(user, viewRole) });
        try {
          const applicationData = await readApiResponse<{ application?: { Status: string; AdviserName: string } | null }>(applicationResponse, 'Application status lookup failed.');
          setAdviserApplication(applicationData.application || null);
        } catch (error) {
          if (import.meta.env.DEV) console.error('My Group adviser status request failed.', error);
          setAdviserApplication(null);
        }
      } else {
        setAdviserApplication(null);
      }
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to load group information.', requestError);
      setActionError(displayError(requestError, LOAD_GROUP_ERROR));
    } finally {
      setLoading(false);
    }
  }, [user, viewRole]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadGroup(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGroup]);

  const isOwner = group?.ownerId === Number(user?.id);

  const openEdit = () => {
    if (!group) return;
    setEditForm({ name:group.name, desc:group.desc, skills:(group.skills||[]).join(', '), max:String(group.maxMembers) });
    setEditError('');
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!group) return;
    if (!editForm.name.trim()) { setEditError('Group name is required.'); return; }
    const max = Number.parseInt(editForm.max, 10);
    if (max < group.members.length) { setEditError(`Max can't be less than current member count (${group.members.length}).`); return; }
    try {
      const response = await fetch(`${API}/groups/${group.id}`, {
        method: 'PATCH',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: editForm.name, description: editForm.desc, specialty: editForm.skills, maxMembers: max }),
      });
      await readApiResponse(response, 'Unable to save group changes.');
      save({ ...group, name:editForm.name, desc:editForm.desc, maxMembers:max, skills:editForm.skills.split(',').map(s=>s.trim()).filter(Boolean) });
      setEditOpen(false);
    } catch (error) {
      if (import.meta.env.DEV && !(error instanceof ApiResponseError)) console.error('Unable to save group changes.', error);
      setEditError(displayError(error, 'Unable to save group changes. Please try again.'));
    }
  };

  const finalizeGroup = async () => {
    if (!group || finalizing || !window.confirm('Are you sure you want to finalize this group? Once finalized, group details and membership cannot be changed by students.')) return;
    setFinalizing(true);
    setActionError('');
    try {
      const response = await fetch(`${API}/groups/${group.id}/finalize`, { method: 'POST', headers: authHeaders(user, viewRole) });
      await readApiResponse(response, 'Unable to finalize this group. Please try again.');
      await loadGroup();
    } catch (requestError) {
      if (import.meta.env.DEV && !(requestError instanceof ApiResponseError)) console.error('Unable to finalize group.', requestError);
      setActionError(displayError(requestError, 'Unable to finalize this group. Please try again.'));
    } finally {
      setFinalizing(false);
    }
  };

  const deleteGroup = async () => {
    if (!group || !window.confirm(`Delete "${group.name}"? This removes the group and its membership records.`)) return;
    try {
      const response = await fetch(`${API}/groups/${group.id}`, { method: 'DELETE', headers: authHeaders(user, viewRole) });
      await readApiResponse(response, 'Unable to delete this group. Please try again.');
      setGroup(null);
      sessionStorage.removeItem('jf_mygroup');
      window.dispatchEvent(new Event('jf-mygroup-updated'));
    } catch (error) {
      if (import.meta.env.DEV && !(error instanceof ApiResponseError)) console.error('Unable to delete group.', error);
      setActionError(displayError(error, 'Unable to delete this group. Please try again.'));
    }
  };

  const approvePending = async (req: PendingRequest) => {
    if (!group) return;
    if (group.members.length >= group.maxMembers) { alert('Group is full.'); return; }
    try {
      const response = await fetch(`${API}/groups/${group.id}/requests/${req.id}/approve`, { method: 'POST', headers: authHeaders(user, viewRole) });
      await readApiResponse(response, 'Unable to approve this join request. Please try again.');
      const newMember: GroupMember = { name:req.name, role:'member' };
      save({ ...group, members:[...group.members, newMember], pending:group.pending.filter(p=>p.id!==req.id) });
    } catch (error) {
      if (import.meta.env.DEV && !(error instanceof ApiResponseError)) console.error('Unable to approve join request.', error);
      setActionError(displayError(error, 'Unable to approve this join request. Please try again.'));
    }
  };

  const declinePending = async (req: PendingRequest) => {
    if (!group) return;
    try {
      const response = await fetch(`${API}/groups/${group.id}/requests/${req.id}`, { method: 'DELETE', headers: authHeaders(user, viewRole) });
      await readApiResponse(response, 'Unable to decline this join request. Please try again.');
      save({ ...group, pending:group.pending.filter(p=>p.id!==req.id) });
    } catch (error) {
      if (import.meta.env.DEV && !(error instanceof ApiResponseError)) console.error('Unable to decline join request.', error);
      setActionError(displayError(error, 'Unable to decline this join request. Please try again.'));
    }
  };

  if (loading) return (
    <Layout>
      <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 gap-2" style={{ background:'var(--bg-page)', color:'rgba(26,42,74,.4)' }}>
        <span>Loading your group…</span>
      </div>
    </Layout>
  );
  if (!group) return (
    <Layout>
      <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 gap-2 p-4 text-center" style={{ background:'var(--bg-page)', color:'rgba(26,42,74,.65)' }}>
        {actionError && <div className="alert alert-danger py-2 mb-2" role="alert">{actionError}</div>}
        <i className="ti ti-users-group" style={{ fontSize:40, opacity:.45 }}></i>
        <strong>{actionError ? 'Unable to load your group information.' : 'You are not currently a member of any group.'}</strong>
        <span>{actionError ? 'Try loading your group again.' : 'Create a group or join an existing group to get started.'}</span>
        {actionError && <button className="mg-btn back mt-2" onClick={() => void loadGroup()}>RETRY</button>}
        <button className="mg-btn edit mt-2" onClick={() => navigate('/finder')}><i className="ti ti-search"></i> FIND OR CREATE A GROUP</button>
      </div>
    </Layout>
  );

  const slots      = group.maxMembers - group.members.length;
  const slotLabels = (group.skills || []).slice(0, Math.max(slots, 1));

  return (
    <Layout>
      <div className="mygroup-body">
        {actionError && <div className="alert alert-danger py-2 mb-3" role="alert">{actionError}</div>}
        <div className="group-view">

          {/*Left Card*/}
          <div className="mg-left-card">
            <div className="mg-group-header">
              <div className="mg-group-icon"><i className="ti ti-users-group"></i></div>
              <span className="mg-group-title">GROUP</span>
            </div>
            <div className="mg-avatar-wrap">
              <div className="mg-owner-avatar">{getInitials(group.members[0]?.name || 'JD')}</div>
            </div>
            <div className="mg-group-name-box">{group.name.toUpperCase()}</div>
            <div className="mg-member-count">{group.members.length}/{group.maxMembers} MEMBERS</div>
            <div className="mg-leader-name">Leader: {group.members.find(member => member.role === 'owner')?.name || 'Not assigned'}</div>
            {membershipStatus === 'Pending' && (
              <div className="text-center mt-2" style={{ color:'var(--amber)', fontSize:12, fontWeight:700 }}>PENDING APPROVAL</div>
            )}
            {isFinalized && <div className="text-center mt-2" style={{ color:'var(--green)', fontSize:12, fontWeight:700 }}>FINALIZED — MEMBERSHIP LOCKED</div>}
            {!isFinalized && <div className="text-center mt-2" style={{ color:'var(--navy)', fontSize:12, fontWeight:700 }}>{group.status || 'Open'} GROUP</div>}
            <div className="mg-members-section">
              <div className="mg-members-label">GROUP MEMBER:</div>
              <div className="mg-members-list">
                {group.members.map((m, i) => (
                  <div key={i} className="mg-member-pill">
                    <span>{m.name}</span>
                    {m.role === 'owner' && <span className="owner-tag">Group Leader</span>}
                  </div>
                ))}
              </div>
              {isOwner && !isFinalized && (group.pending || []).length > 0 && (
                <button className="mg-pending-badge" onClick={() => setPendingOpen(true)}>
                  <i className="ti ti-clock"></i>
                  <span>{group.pending.length} Pending</span>
                </button>
              )}
            </div>
          </div>

          {/*Right Card*/}
          <div className="mg-right-card">
            <div className="mg-desc-box">
              <div className="mg-desc-title">Description:</div>
              <div className="mg-desc-text">{group.desc}</div>
            </div>
            <div className="mg-info-row">
              <div className="mg-info-box">
                <div className="mg-info-label">SKILL THAT WE ARE LOOKING FOR:</div>
                <div className="mg-skill-list">
                  {(group.skills || []).map((s, i) => <div key={i} className="mg-skill-pill">{s}</div>)}
                </div>
              </div>
              <div className="mg-info-box">
                <div className="mg-info-label">AVAILABLE SLOTS:</div>
                <div className="mg-slot-list">
                  {slots <= 0
                    ? <div className="mg-slot-pill" style={{ opacity:.45 }}>No open slots</div>
                    : slotLabels.map((s, i) => <div key={i} className="mg-slot-pill">{s}</div>)
                  }
                </div>
              </div>
            </div>
            <div className="mg-actions">
              {isOwner && membershipStatus === 'Member' && !isFinalized && (
                <button className="mg-btn edit" onClick={openEdit}>
                  <i className="ti ti-circle-check"></i> EDIT
                </button>
              )}
              {isOwner && membershipStatus === 'Member' && !isFinalized && (
                <>
                  <button className="mg-btn edit" disabled={finalizing} onClick={() => void finalizeGroup()}><i className="ti ti-lock"></i> {finalizing ? 'Finalizing…' : 'Finalize Group'}</button>
                  <button className="mg-btn edit" onClick={() => void deleteGroup()}><i className="ti ti-trash"></i> DELETE GROUP</button>
                </>
              )}
              {isFinalized && membershipStatus === 'Member' && (
                adviserApplication && adviserApplication.Status !== 'Rejected'
                  ? <span className="mg-application-status">Adviser application: {adviserApplication.Status}{adviserApplication.AdviserName ? ` — ${adviserApplication.AdviserName}` : ''}</span>
                : isOwner && <button className="mg-btn edit" onClick={() => navigate(`/adviser?groupId=${encodeURIComponent(group.id)}`)}><i className="ti ti-user-plus"></i> {adviserApplication ? 'Apply Again' : 'Apply for Adviser'}</button>
              )}
              <button className="mg-btn back" onClick={() => window.history.back()}>
                <i className="ti ti-arrow-left"></i> BACK
              </button>
            </div>
          </div>

        </div>
      </div>

      {/*Edit Modal*/}
      <Modal show={editOpen} onHide={() => setEditOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-edit"></i></div>
          <div className="modal-title-text">Edit Group</div>
          <div className="modal-sub-text">Update your group's information</div>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-flex flex-column gap-3">
            <Form.Group>
              <Form.Label className="jf-label">Group Name</Form.Label>
              <Form.Control className="jf-input" type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name:e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Description</Form.Label>
              <Form.Control as="textarea" className="jf-input" rows={3} value={editForm.desc} onChange={e => setEditForm(f => ({ ...f, desc:e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Skills Looking For <span style={{ fontWeight:400, fontSize:10, color:'rgba(255,255,255,.35)' }}>— comma separated</span></Form.Label>
              <Form.Control className="jf-input" type="text" placeholder="e.g. UI Designer, Database" value={editForm.skills} onChange={e => setEditForm(f => ({ ...f, skills:e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Max Members <span style={{ fontWeight:400, fontSize:10, color:'rgba(255,255,255,.35)' }}>(2–4)</span></Form.Label>
              <Form.Select className="jf-input" value={editForm.max} onChange={e => setEditForm(f => ({ ...f, max:e.target.value }))}>
                {['2','3','4'].map(v => <option key={v}>{v}</option>)}
              </Form.Select>
            </Form.Group>
            {editError && (
              <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ fontSize:12, borderRadius:8 }}>
                <i className="ti ti-alert-circle"></i> {editError}
              </div>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void handleEditSave()}>Save Changes</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setEditOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {/*Pending Requests Modal*/}
      <Modal show={pendingOpen} onHide={() => setPendingOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2" style={{ background:'rgba(245,158,11,.15)', color:'var(--amber)' }}><i className="ti ti-clock"></i></div>
          <div className="modal-title-text">Join Requests</div>
          <div className="modal-sub-text">Students requesting to join your group</div>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-2">
          {(group.pending || []).length === 0 ? (
            <div className="text-center py-3" style={{ color:'rgba(255,255,255,.35)', fontSize:13 }}>
              <i className="ti ti-inbox d-block mb-2" style={{ fontSize:32, opacity:.3 }}></i>
              No pending join requests.
            </div>
          ) : (group.pending || []).map(req => (
            <div key={req.id} className="pending-card">
              <div className="pending-avatar">{getInitials(req.name)}</div>
              <div className="pending-info">
                <div className="pending-name">{req.name}</div>
                <div className="pending-sub">{req.course}</div>
                {req.expiresAt && <div className="pending-sub">Expires {new Date(req.expiresAt).toLocaleString()}</div>}
              </div>
              <div className="d-flex gap-2">
                <button className="pending-btn approve" onClick={() => approvePending(req)}>Approve</button>
                <button className="pending-btn decline" onClick={() => declinePending(req)}>Decline</button>
              </div>
            </div>
          ))}
        </Modal.Body>
      </Modal>
    </Layout>
  );
}