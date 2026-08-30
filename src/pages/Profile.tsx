import { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { PROFILE, type StudentProfile } from '../data/datas';
import '../styles/profile.css';

interface EditForm { bio: string; gender: string; socials: string; skills: string; }

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<StudentProfile>(() => {
    const saved = sessionStorage.getItem('jf_profile');
    return saved ? JSON.parse(saved) : PROFILE;
  });
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ bio:'', gender:'', socials:'', skills:'' });
  const [toast, setToast] = useState('');

  const name = user?.name || 'Juan Dela Cruz';
  const roleLabel = `${profile.course} Student`;

  const openEdit = () => {
    setForm({ bio: profile.bio, gender: profile.gender, socials: profile.socials, skills: profile.skills.join(', ') });
    setEditOpen(true);
  };

  const saveEdit = () => {
    const updated: StudentProfile = {
      ...profile,
      bio: form.bio,
      gender: form.gender,
      socials: form.socials,
      skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
    };
    setProfile(updated);
    sessionStorage.setItem('jf_profile', JSON.stringify(updated));
    setEditOpen(false);
    setToast('Profile updated!');
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <Layout>
      <div className="profile-body">
        <div className="profile-grid">

          {/* LEFT — Profile card */}
          <div className="profile-left">
            <div className="profile-header">
              <div className="profile-header-icon"><i className="ti ti-user"></i></div>
              <div className="profile-header-text">PROFILE</div>
            </div>
            <div className="profile-avatar"><i className="ti ti-user"></i></div>
            <div>
              <div className="profile-name">{name}</div>
              <div className="profile-role">{roleLabel}</div>
            </div>
            <div className="profile-bio-card">
              <div className="profile-bio-header"><i className="ti ti-edit"></i> BIO</div>
              <div className="profile-bio-body">{profile.bio || 'No bio provided yet.'}</div>
            </div>
          </div>

          {/* RIGHT — Misc / Info / Skills / Edit prompt */}
          <div className="profile-right">
            <div className="profile-misc-card">
              <div className="profile-misc-title">MISCELLANEOUS</div>
              <div className="profile-misc-sub">Last login: {profile.lastLogin}</div>
            </div>

            <div className="profile-info-card">
              <div className="profile-info-header">
                <div className="profile-info-header-icon"><i className="ti ti-info-circle"></i></div>
                <div className="profile-info-header-text">INFO :</div>
              </div>
              <div className="profile-info-body">
                {([
                  ['Student ID', profile.studentId],
                  ['Year level', profile.yearLevel],
                  ['Birthdate', profile.birthdate],
                  ['Gender', profile.gender],
                  ['Socials', profile.socials],
                ] as [string, string][]).map(([label, value]) => (
                  <div className="profile-info-row" key={label}>
                    <div className="profile-info-label">{label}</div>
                    <div className="profile-info-colon">:</div>
                    <div className="profile-info-value">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="profile-lower-row">
              <div className="profile-skills-card">
                <div className="profile-skills-header"><i className="ti ti-settings"></i> SKILLS :</div>
                <div className="profile-skills-body">
                  {profile.skills.map((s, i) => <div key={i} className="profile-skill-pill">{s.toUpperCase()}</div>)}
                </div>
              </div>
              <div className="profile-edit-prompt">
                <div className="profile-edit-prompt-text">DO YOU WANT TO EDIT YOUR PROFILE?</div>
              </div>
            </div>

            <div className="profile-actions">
              <button className="profile-btn edit" onClick={openEdit}>
                <span className="profile-btn-icon"><i className="ti ti-check"></i></span> EDIT
              </button>
              <button className="profile-btn back" onClick={() => window.history.back()}>
                <span className="profile-btn-icon"><i className="ti ti-arrow-left"></i></span> BACK
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Edit Modal */}
      <Modal show={editOpen} onHide={() => setEditOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-edit"></i></div>
          <div className="modal-title-text">Edit Profile</div>
          <div className="modal-sub-text">Update your bio and details</div>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-flex flex-column gap-3">
            <Form.Group>
              <Form.Label className="jf-label">Bio</Form.Label>
              <Form.Control as="textarea" className="jf-input" rows={3} value={form.bio} onChange={e => setForm(f => ({ ...f, bio:e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Gender</Form.Label>
              <Form.Select className="jf-input" value={form.gender} onChange={e => setForm(f => ({ ...f, gender:e.target.value }))}>
                {['Male','Female','Prefer not to say'].map(g => <option key={g}>{g}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Socials</Form.Label>
              <Form.Control className="jf-input" type="text" value={form.socials} onChange={e => setForm(f => ({ ...f, socials:e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Skills <span style={{ fontWeight:400, fontSize:10, color:'rgba(255,255,255,.35)' }}>— comma separated</span></Form.Label>
              <Form.Control className="jf-input" type="text" placeholder="e.g. UI Designer, Database" value={form.skills} onChange={e => setForm(f => ({ ...f, skills:e.target.value }))} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={saveEdit}>Save Changes</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setEditOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
