import { useState, useEffect } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { MyGroupData, GroupMember, PendingRequest, getInitials } from '../data/datas';
import '../styles/mygroup.css';

const DEMO_GROUP: MyGroupData = {
  id: 'g-owner-1', name: 'JuanFinder',
  desc: 'A capstone project platform that helps STI students view, create, manage groups and select an adviser for their capstone projects.',
  specialty: 'Full-Stack / AI', maxMembers: 4,
  skills: ['UI Designer', 'Database'],
  pending: [{ name:'Balingasa, Adrian', course:'BSIT · 3rd Year', id:'p1' }],
  members: [
    { name:'Juan Dela Cruz',    role:'owner'  },
    { name:'Balingasa, Adrian', role:'member' },
    { name:'Paul Zuniega',      role:'member' },
  ],
};

interface EditForm { name: string; desc: string; skills: string; max: string; }

export default function MyGroup() {
  const { user } = useAuth();
  const [group, setGroup]             = useState<MyGroupData | null>(null);
  const [isOwner, setIsOwner]         = useState(false);
  const [editOpen, setEditOpen]       = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [editForm, setEditForm]       = useState<EditForm>({ name:'', desc:'', skills:'', max:'4' });
  const [editError, setEditError]     = useState('');

  useEffect(() => {
    const saved = sessionStorage.getItem('jf_mygroup');
    let g: MyGroupData = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEMO_GROUP));
    if (!saved && user?.name) g.members[0].name = user.name;
    if (!saved) sessionStorage.setItem('jf_mygroup', JSON.stringify(g));
    setGroup(g);
    setIsOwner(g.members[0]?.name === (user?.name || 'Juan Dela Cruz'));
  }, [user]);

  const save = (updated: MyGroupData) => {
    setGroup(updated);
    sessionStorage.setItem('jf_mygroup', JSON.stringify(updated));
  };

  const openEdit = () => {
    if (!group) return;
    setEditForm({ name:group.name, desc:group.desc, skills:(group.skills||[]).join(', '), max:String(group.maxMembers) });
    setEditError('');
    setEditOpen(true);
  };

  const handleEditSave = () => {
    if (!group) return;
    if (!editForm.name) { setEditError('Group name is required.'); return; }
    const max = parseInt(editForm.max);
    if (max < group.members.length) { setEditError(`Max can't be less than current member count (${group.members.length}).`); return; }
    save({ ...group, name:editForm.name, desc:editForm.desc, maxMembers:max, skills:editForm.skills.split(',').map(s=>s.trim()).filter(Boolean) });
    setEditOpen(false);
  };

  const approvePending = (req: PendingRequest) => {
    if (!group) return;
    if (group.members.length >= group.maxMembers) { alert('Group is full.'); return; }
    const newMember: GroupMember = { name:req.name, role:'member' };
    save({ ...group, members:[...group.members, newMember], pending:group.pending.filter(p=>p.id!==req.id) });
  };

  const declinePending = (req: PendingRequest) => {
    if (!group) return;
    save({ ...group, pending:group.pending.filter(p=>p.id!==req.id) });
  };

  if (!group) return (
    <Layout>
      <div className="d-flex align-items-center justify-content-center flex-grow-1" style={{ background:'var(--bg-page)', color:'rgba(26,42,74,.4)' }}>
        Loading…
      </div>
    </Layout>
  );

  const slots      = group.maxMembers - group.members.length;
  const slotLabels = (group.skills || []).slice(0, Math.max(slots, 1));

  return (
    <Layout>
      <div className="mygroup-body">
        <div className="group-view">

          {/* LEFT CARD */}
          <div className="mg-left-card">
            <div className="mg-group-header">
              <div className="mg-group-icon"><i className="ti ti-users-group"></i></div>
              <span className="mg-group-title">GROUP</span>
            </div>
            <div className="mg-avatar-wrap">
              <div className="mg-owner-avatar">{getInitials(group.members[0]?.name || 'JD')}</div>
            </div>
            <div className="mg-group-name-box">{group.name.toUpperCase()}</div>
            <div className="mg-members-section">
              <div className="mg-members-label">GROUP MEMBER:</div>
              <div className="mg-members-list">
                {group.members.map((m, i) => (
                  <div key={i} className="mg-member-pill">
                    <span>{m.name}</span>
                    {m.role === 'owner' && <span className="owner-tag">Owner</span>}
                  </div>
                ))}
              </div>
              {isOwner && (group.pending || []).length > 0 && (
                <button className="mg-pending-badge" onClick={() => setPendingOpen(true)}>
                  <i className="ti ti-clock"></i>
                  <span>{group.pending.length} Pending</span>
                </button>
              )}
            </div>
          </div>

          {/* RIGHT CARD */}
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
              {isOwner && (
                <button className="mg-btn edit" onClick={openEdit}>
                  <i className="ti ti-circle-check"></i> EDIT
                </button>
              )}
              <button className="mg-btn back" onClick={() => window.history.back()}>
                <i className="ti ti-arrow-left"></i> BACK
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Edit Modal */}
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
          <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={handleEditSave}>Save Changes</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setEditOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {/* Pending Requests Modal */}
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