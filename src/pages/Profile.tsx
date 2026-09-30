import { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { PROFILE, type StudentProfile } from '../data/datas';
import '../styles/profile.css';

interface EditForm { bio: string; gender: string; socials: string; skills: string; }
interface ProjectForm { title: string; category: string; description: string; link: string; }

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<StudentProfile>(() => {
    const saved = sessionStorage.getItem('jf_profile');
    return saved ? JSON.parse(saved) : PROFILE;
  });

  const [projects, setProjects] = useState<Array<{ id: number; title: string; category: string; description: string; link: string }>>(() => {
    const savedProjects = sessionStorage.getItem('jf_portfolio');
    return savedProjects ? JSON.parse(savedProjects) : [];
  });

  const [editOpen, setEditOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  
  const [form, setForm] = useState<EditForm>({ bio:'', gender:'', socials:'', skills:'' });
  const [projectForm, setProjectForm] = useState<ProjectForm>({ title: '', category: 'Web', description: '', link: '' });
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

  const saveProject = () => {
    if (!projectForm.title.trim()) return;
    const newProj = {
      id: Date.now(),
      ...projectForm,
    };
    const updatedProjects = [newProj, ...projects];
    setProjects(updatedProjects);
    sessionStorage.setItem('jf_portfolio', JSON.stringify(updatedProjects));
    setPortfolioOpen(false);
    setProjectForm({ title: '', category: 'Web', description: '', link: '' });
    setToast('Project added to portfolio!');
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <Layout>
      <div className="profile-body">
        <div className="profile-grid">

          {/*Left - Profile card*/}
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

          {/* RIGHT — Misc / Info / Skills / Portfolio / Edit prompt */}
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

            {/* --- NEW PORTFOLIO SECTION (Empty State Ready) --- */}
            <div className="profile-info-card" style={{ marginTop: '1.25rem' }}>
              <div className="profile-info-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="profile-info-header-icon"><i className="ti ti-briefcase"></i></div>
                  <div className="profile-info-header-text">PORTFOLIO :</div>
                </div>
                <Button 
                  size="sm" 
                  style={{ background: 'var(--amber, #f59e0b)', border: 'none', color: '#111827', fontWeight: 700, fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '6px' }}
                  onClick={() => setPortfolioOpen(true)}
                >
                  <i className="ti ti-plus"></i> ADD PROJECT
                </Button>
              </div>
              <div className="profile-info-body" style={{ padding: '1.5rem', textAlign: 'center' }}>
                {projects.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                    No projects added to your portfolio yet. Click "Add Project" to showcase your work!
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', textAlign: 'left' }}>
                    {projects.map((p) => (
                      <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--amber, #f59e0b)', fontWeight: 700, marginBottom: '0.25rem' }}>{p.category.toUpperCase()}</div>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem', marginBottom: '0.25rem' }}>{p.title}</div>
                        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>{p.description}</div>
                        {p.link && (
                          <a href={p.link} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--amber, #f59e0b)', textDecoration: 'none' }}>
                            View Link <i className="ti ti-external-link"></i>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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

      {/* Edit Profile Modal */}
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

      {/* Add Portfolio Project Modal */}
      <Modal show={portfolioOpen} onHide={() => setPortfolioOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-briefcase"></i></div>
          <div className="modal-title-text">Add Project</div>
          <div className="modal-sub-text">Showcase your school or personal project</div>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-flex flex-column gap-3">
            <Form.Group>
              <Form.Label className="jf-label">Project Title</Form.Label>
              <Form.Control className="jf-input" type="text" placeholder="e.g. JuanFinder App" value={projectForm.title} onChange={e => setProjectForm(p => ({ ...p, title: e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Category</Form.Label>
              <Form.Select className="jf-input" value={projectForm.category} onChange={e => setProjectForm(p => ({ ...p, category: e.target.value }))}>
                {['Web', 'Mobile', 'UI/UX Design', 'Database', 'AI / ML'].map(c => <option key={c}>{c}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Description</Form.Label>
              <Form.Control as="textarea" className="jf-input" rows={2} placeholder="Brief description of the project" value={projectForm.description} onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="jf-label">Project Link (GitHub / Demo)</Form.Label>
              <Form.Control className="jf-input" type="text" placeholder="https://..." value={projectForm.link} onChange={e => setProjectForm(p => ({ ...p, link: e.target.value }))} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={saveProject}>Add Project</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setPortfolioOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}

