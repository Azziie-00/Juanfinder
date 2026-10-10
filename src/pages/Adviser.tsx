import { useEffect, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import type { AdviserData } from '../data/datas';
import '../styles/adviser.css';

const PAGE_SIZE = 4;

export default function Adviser() {
  const { user, viewRole, effectiveRole } = useAuth();
  const [advisers, setAdvisers] = useState<AdviserData[]>([]);
  const [page, setPage]           = useState(1);
  const [applied, setApplied]     = useState<Set<string>>(new Set());
  const [modalAdviser, setModalAdviser]   = useState<AdviserData | null>(null);
  const [detailAdviser, setDetailAdviser] = useState<AdviserData | null>(null);
  const [toast, setToast]         = useState('');
  const [editOpen, setEditOpen]   = useState(false);
  const [editBio, setEditBio]     = useState('');
  const [editGender, setEditGender] = useState('');
  const [editRequirements, setEditRequirements] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_BASE_URL}/advisers`, { headers: authHeaders(user, viewRole) })
      .then(async response => response.ok ? response.json() : [])
      .then(records => setAdvisers((records as { UserID: number; Name: string; Bio?: string; Gender?: string; Requirements?: string }[]).map(record => ({
        id: String(record.UserID), name: record.Name, slots: null, maxSlots: 10,
        bio: record.Bio || 'No bio provided yet.', gender: record.Gender || '', requirements: record.Requirements ? record.Requirements.split('\n').filter(Boolean) : [],
      }))));
  }, [user, viewRole]);

  const pages = Math.max(1, Math.ceil(advisers.length / PAGE_SIZE));
  const slice = advisers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const confirmApply = () => {
    if (!modalAdviser) return;
    setApplied(a => new Set(a).add(modalAdviser.id));
    setToast(`Application sent to ${modalAdviser.name}!`);
    setModalAdviser(null);
    setTimeout(() => setToast(''), 3000);
  };

  const openEdit = () => {
    const ownProfile = advisers.find(adviser => adviser.id === String(user?.id));
    setEditBio(ownProfile?.bio === 'No bio provided yet.' ? '' : ownProfile?.bio || '');
    setEditGender(ownProfile?.gender || '');
    setEditRequirements(ownProfile?.requirements.length ? [...ownProfile.requirements] : ['']);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const response = await fetch(`${API_BASE_URL}/adviser/profile`, {
      method: 'PATCH', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bio: editBio, gender: editGender, requirements: editRequirements }),
    });
    const data = await response.json();
    if (!response.ok) {
      setToast(data.message || 'Unable to save adviser requirements.');
      return;
    }
    const savedRequirements = editRequirements.map(item => item.trim()).filter(Boolean);
    setAdvisers(current => current.map(adviser => adviser.id === String(user?.id) ? { ...adviser, bio: editBio || 'No bio provided yet.', gender: editGender, requirements: savedRequirements } : adviser));
    setEditOpen(false);
    setToast('Adviser details saved.');
  };

  return (
    <Layout>
      <div className="adviser-body">
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
          {effectiveRole === 'adviser' && <button className="adv-back-btn" onClick={openEdit}><i className="ti ti-edit"></i> EDIT REQUIREMENTS</button>}
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
                <tr><td colSpan={3} className="adv-empty">No advisers found.</td></tr>
              ) : slice.map(a => {
                const isApplied = applied.has(a.id);
                return (
                  <tr key={a.id}>
                    <td><span className="adv-name-link" onClick={() => setDetailAdviser(a)}>{a.name}</span></td>
                    <td><span className="adv-slots">{a.slots ?? '--'}/{a.maxSlots}</span></td>
                    <td>
                      <button
                        className={`adv-apply-link${isApplied ? ' applied' : ''}`}
                        onClick={() => !isApplied && setModalAdviser(a)}
                        disabled={isApplied}
                      >
                        {isApplied ? 'Applied' : 'Apply'}
                      </button>
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
          <div className="modal-sub-text">Students will see these requirements.</div>
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
              <div className="d-flex flex-column gap-2">
                {modalAdviser.requirements.map((r, i) => (
                  <div key={i} style={{ fontSize:13, fontWeight:600, color:'var(--amber)', background:'rgba(255,255,255,.05)', borderRadius:30, padding:'10px 16px', textAlign:'center' }}>
                    {r}
                  </div>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={confirmApply}>
                Confirm Application
              </Button>
              <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setModalAdviser(null)}>
                Cancel
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/*Detail Modal*/}
      <Modal show={!!detailAdviser} onHide={() => setDetailAdviser(null)} centered size="lg" className="adv-detail-modal">
        {detailAdviser && (
          <Modal.Body className="p-0">
            <div className="adv-detail-inner">
              <div className="adv-detail-left">
                <div className="adv-detail-header with-icon">
                  <div className="adv-detail-header-icon"><i className="ti ti-users-group"></i></div>
                  <div className="adv-detail-header-text">ADVISER</div>
                </div>
                <div className="adv-detail-avatar"><i className="ti ti-user"></i></div>
                <div className="adv-detail-name-pill">ADVISER | {detailAdviser.name.toUpperCase()}</div>
                <div className="adv-detail-bio-box">
                  <div className="adv-detail-bio-label">BIO</div>
                  <div className="adv-detail-bio-text">{detailAdviser.bio || 'No bio provided yet.'}</div>
                </div>
              </div>
              <div className="adv-detail-right">
                <div className="adv-detail-header">
                  <div className="adv-detail-header-text">REQUIREMENTS</div>
                </div>
                <div className="adv-req-list">
                  {detailAdviser.requirements.map((r, i) => (
                    <div key={i} className="adv-req-pill">Requirement {i + 1} — {r}</div>
                  ))}
                </div>
                <div className="adv-detail-footer">
                  <button className="adv-detail-back-btn" onClick={() => setDetailAdviser(null)}>
                    <i className="ti ti-arrow-left"></i> BACK
                  </button>
                </div>
              </div>
            </div>
          </Modal.Body>
        )}
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
