import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { PROFILE, type StudentProfile } from '../data/datas';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/profile.css';

interface EditForm { firstName: string; lastName: string; bio: string; gender: string; socials: string; skills: string; birthdate: string; }
interface PortfolioEntry { PortfolioID: number; Title: string; Category: string; Description: string; FileName: string; FileType: string; FileSize: number; }
interface ProjectForm { title: string; category: string; description: string; }
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function Profile() {
  const { user, viewRole, effectiveRole, updateUser } = useAuth();
  const isAdviser = effectiveRole === 'adviser';
  const [profile, setProfile] = useState<StudentProfile>(() => {
    return { ...PROFILE, studentId: user?.id ?? '', course: user?.course ?? PROFILE.course };
  });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [projects, setProjects] = useState<PortfolioEntry[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [editRequirements, setEditRequirements] = useState<string[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<EditForm>({ firstName:'', lastName:'', bio:'', gender:'', socials:'', skills:'', birthdate:'' });
  const [projectForm, setProjectForm] = useState<ProjectForm>({ title: '', category: 'Web', description: '' });
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!user) return;
    const headers = authHeaders(user, viewRole);
    const requests: [Promise<Response>, Promise<Response> | null] = [
      fetch(`${API_BASE_URL}/profile`, { headers }),
      isAdviser ? null : fetch(`${API_BASE_URL}/portfolio`, { headers }),
    ];
    Promise.all([requests[0], requests[1] || Promise.resolve(null)]).then(async ([profileResponse, portfolioResponse]) => {
      const profileData = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileData.message || 'Unable to load your profile.');
      const portfolioData = portfolioResponse ? await portfolioResponse.json() : [];
      if (portfolioResponse && !portfolioResponse.ok) throw new Error(portfolioData.message || 'Unable to load your portfolio.');
      setFirstName(profileData.FirstName || '');
      setLastName(profileData.LastName || '');
      setRequirements(String(profileData.Requirements || '').split('\n').map((item: string) => item.trim()).filter(Boolean));
      setProfile({
        studentId: String(profileData.UserCode || ''),
        course: profileData.Course || 'Unspecified',
        yearLevel: profileData.YearLevel || '',
        birthdate: profileData.Birthdate || '',
        gender: profileData.Gender || '',
        socials: profileData.Socials || '',
        bio: profileData.Bio || '',
        skills: profileData.Skills || [],
        lastLogin: PROFILE.lastLogin,
      });
      setProjects(portfolioData);
    }).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load your profile.');
    });
  }, [user, viewRole, isAdviser]);

  const name = user?.name || `${firstName} ${lastName}`.trim() || 'Student';
  const roleLabel = isAdviser ? 'Adviser' : `${profile.course} Student`;

  const openEdit = () => {
    if (isAdviser) {
      setEditRequirements(requirements.length ? [...requirements] : ['']);
      setEditOpen(true);
      return;
    }
    setForm({ firstName, lastName, bio: profile.bio, gender: profile.gender, socials: profile.socials, skills: profile.skills.join(', '), birthdate: profile.birthdate });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    setError('');
    try {
      if (isAdviser) {
        const response = await fetch(`${API_BASE_URL}/adviser/profile`, {
          method: 'PATCH',
          headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ bio: profile.bio, requirements: editRequirements }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to save adviser requirements.');
        setRequirements(editRequirements.map(item => item.trim()).filter(Boolean));
        setEditOpen(false);
        setToast('Requirements updated.');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/profile`, {
        method: 'PATCH',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...form,
          skills: form.skills.split(',').map(skill => skill.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save your profile.');
      const updated: StudentProfile = {
        ...profile,
        bio: form.bio,
        gender: form.gender,
        socials: form.socials,
        birthdate: form.birthdate,
        skills: form.skills.split(',').map(skill => skill.trim()).filter(Boolean),
      };
      setFirstName(form.firstName.trim());
      setLastName(form.lastName.trim());
      setProfile(updated);
      if (user) updateUser({ ...user, name: `${form.firstName.trim()} ${form.lastName.trim()}` });
      setEditOpen(false);
      setToast('Profile updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const saveProject = async () => {
    if (!projectForm.title.trim() || !file || !user) return;
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      setError('Choose a PDF, image, text, DOC, or DOCX file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File size must not exceed 10 MB.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error('Unable to read the selected file.'));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`${API_BASE_URL}/portfolio`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...projectForm, fileName: file.name, mimeType: file.type, data: encoded }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to upload the portfolio file.');
      setProjects(current => [data.portfolio, ...current]);
      setPortfolioOpen(false);
      setFile(null);
      setProjectForm({ title: '', category: 'Web', description: '' });
      setToast('Project added to your portfolio.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload the portfolio file.');
    } finally {
      setUploading(false);
    }
  };

  const openPreview = async (entry: PortfolioEntry) => {
    if (!user) return;
    const response = await fetch(`${API_BASE_URL}/portfolio/${entry.PortfolioID}/preview`, { headers: authHeaders(user, viewRole) });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Unable to preview this file.');
      return;
    }
    setPreview({ url: data.url, type: entry.FileType, name: entry.FileName });
  };

  const deleteProject = async (entry: PortfolioEntry) => {
    if (!user || !window.confirm(`Delete "${entry.Title}" from your portfolio?`)) return;
    const response = await fetch(`${API_BASE_URL}/portfolio/${entry.PortfolioID}`, {
      method: 'DELETE', headers: authHeaders(user, viewRole),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Unable to delete this portfolio entry.');
      return;
    }
    setProjects(current => current.filter(project => project.PortfolioID !== entry.PortfolioID));
  };

  return (
    <Layout>
      <div className="profile-body">
        {error && <div className="alert alert-danger py-2 mb-3" role="alert">{error}</div>}
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
                <div className="profile-info-header-text">{isAdviser ? 'REQUIREMENTS' : 'INFO :'}</div>
              </div>
              <div className="profile-info-body">
                {isAdviser ? (
                  requirements.length
                    ? requirements.map((requirement, index) => (
                      <div className="profile-info-row adviser-requirement-row" key={`${index}-${requirement}`}>
                        <div className="profile-info-value adviser-requirement-number">{index + 1}.</div>
                        <div className="profile-info-value adviser-requirement-text">{requirement}</div>
                      </div>
                    ))
                    : <div className="profile-info-row"><div className="profile-info-value">No requirements listed.</div></div>
                ) : ([
                    ['Student ID', profile.studentId],
                    ['Year level', profile.yearLevel],
                    ['Birthdate', profile.birthdate || 'Not provided'],
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

            {!isAdviser && <div className="profile-lower-row">
              <div className="profile-skills-card">
                <div className="profile-skills-header"><i className="ti ti-settings"></i> SKILLS :</div>
                <div className="profile-skills-body">
                  {profile.skills.map((s, i) => <div key={i} className="profile-skill-pill">{s.toUpperCase()}</div>)}
                </div>
              </div>
              <div className="profile-edit-prompt">
                <div className="profile-edit-prompt-text">DO YOU WANT TO EDIT YOUR PROFILE?</div>
              </div>
            </div>}

            {!isAdviser && <div className="profile-info-card" style={{ marginTop: '1.25rem' }}>
              <div className="profile-info-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="profile-info-header-icon"><i className="ti ti-briefcase"></i></div>
                  <div className="profile-info-header-text">MY PORTFOLIO</div>
                </div>
                <Button 
                  size="sm" 
                  style={{ background: 'var(--amber, #f59e0b)', border: 'none', color: '#111827', fontWeight: 700, fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '6px' }}
                  onClick={() => setPortfolioOpen(true)}
                >
                  <i className="ti ti-plus"></i> ADD PROJECT INTO PORTFOLIO
                </Button>
              </div>
              <div className="profile-info-body" style={{ padding: '1.5rem', textAlign: 'center' }}>
                {projects.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                  No portfolio files uploaded yet.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', textAlign: 'left' }}>
                    {projects.map((p) => (
                      <div key={p.PortfolioID} style={{ background: 'rgba(255,255,255,0.04)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--amber, #f59e0b)', fontWeight: 700, marginBottom: '0.25rem' }}>{p.Category.toUpperCase()}</div>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem', marginBottom: '0.25rem' }}>{p.Title}</div>
                        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>{p.Description || p.FileName}</div>
                        <div className="d-flex gap-2">
                          <Button size="sm" variant="outline-warning" onClick={() => void openPreview(p)}>Preview</Button>
                          <Button size="sm" variant="outline-danger" onClick={() => void deleteProject(p)}>Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>}

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
          <div className="modal-title-text">{isAdviser ? 'Edit Requirements' : 'Edit Profile'}</div>
          <div className="modal-sub-text">{isAdviser ? 'Update the requirements students will see.' : 'Update your bio and details'}</div>
        </Modal.Header>
        <Modal.Body>
          {isAdviser ? (
            <div className="d-flex flex-column gap-3">
              {editRequirements.map((requirement, index) => (
                <div className="d-flex align-items-center gap-2" key={index}>
                  <span className="adviser-requirement-number">{index + 1}.</span>
                  <Form.Control className="jf-input" aria-label={`Requirement ${index + 1}`} value={requirement} maxLength={250} onChange={event => setEditRequirements(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                  <Button variant="outline-danger" aria-label={`Remove requirement ${index + 1}`} onClick={() => setEditRequirements(current => current.filter((_, itemIndex) => itemIndex !== index))}><i className="ti ti-trash"></i></Button>
                </div>
              ))}
              <Button variant="outline-warning" onClick={() => setEditRequirements(current => [...current, ''])}><i className="ti ti-plus"></i> Add Requirement</Button>
            </div>
          ) : (
          <Form className="d-flex flex-column gap-3">
            <div className="d-flex gap-3">
              <Form.Group className="flex-fill">
                <Form.Label className="jf-label">First Name</Form.Label>
                <Form.Control className="jf-input" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName:e.target.value }))} maxLength={80} required />
              </Form.Group>
              <Form.Group className="flex-fill">
                <Form.Label className="jf-label">Last Name</Form.Label>
                <Form.Control className="jf-input" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName:e.target.value }))} maxLength={80} required />
              </Form.Group>
            </div>
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
              <Form.Label className="jf-label">Birthdate</Form.Label>
              <Form.Control className="jf-input" type="date" value={form.birthdate} onChange={e => setForm(f => ({ ...f, birthdate:e.target.value }))} />
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
          )}
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" disabled={saving} style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void saveEdit()}>{saving ? 'Saving…' : isAdviser ? 'Save Requirements' : 'Save Changes'}</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setEditOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {/* Add Portfolio Project Modal */}
      <Modal show={portfolioOpen} onHide={() => setPortfolioOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-briefcase"></i></div>
          <div className="modal-title-text">Add Project Into Portfolio</div>
          <div className="modal-sub-text">Upload a file to showcase your project (maximum 10 MB).</div>
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
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click(); }}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                const droppedFile = event.dataTransfer.files[0];
                if (droppedFile) setFile(droppedFile);
              }}
              style={{ border:'2px dashed rgba(255,255,255,.25)', borderRadius:10, padding:20, textAlign:'center', cursor:'pointer' }}
            >
              <i className="ti ti-upload" style={{ fontSize:24 }}></i>
              <div>{file ? file.name : 'Drag and drop a file here, or choose a file'}</div>
              <div style={{ fontSize:11, opacity:.65 }}>PDF, JPG, PNG, WEBP, TXT, DOC, DOCX</div>
            </div>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx"
              onChange={event => setFile(event.target.files?.[0] || null)}
            />
            {uploading && <div role="status">Uploading file…</div>}
          </Form>
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" disabled={uploading || !file || !projectForm.title.trim()} style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void saveProject()}>{uploading ? 'Uploading…' : 'Upload to Portfolio'}</Button>
          <Button className="flex-grow-1" disabled={uploading} style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setPortfolioOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={!!preview} onHide={() => setPreview(null)} centered size="lg" className="jf-modal">
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title className="modal-title-text">{preview?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ minHeight:300 }}>
          {preview?.type === 'application/pdf'
            ? <iframe title={`Preview ${preview.name}`} src={preview.url} style={{ width:'100%', height:'70vh', border:0 }} />
            : preview?.type.startsWith('image/')
              ? <img src={preview.url} alt={preview.name} style={{ maxWidth:'100%', maxHeight:'70vh', display:'block', margin:'auto' }} />
              : <div className="text-center"><p>Preview is not available for this file type.</p><a href={preview?.url} target="_blank" rel="noreferrer">Open or download {preview?.name}</a></div>}
        </Modal.Body>
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
