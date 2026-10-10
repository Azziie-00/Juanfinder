import { useState, useEffect } from 'react';
import { Modal, Button, Form, Table, Badge, Dropdown } from 'react-bootstrap';
import Layout from '../components/Layout';
import { getInitials } from '../data/datas';
import type { GroupData, StudentData } from '../data/datas';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/finder.css';

const PAGE_SIZE = 8;
const API = API_BASE_URL;
type FilterType = 'ALL' | 'STUDENT' | 'GROUP';

const ROLE_ICONS: Record<string, string> = {
  'ui designer':'ti-brush','front-end':'ti-layout','back-end':'ti-server',
  'database':'ti-database','developer':'ti-code','full-stack':'ti-stack',
  'ai':'ti-brain','iot':'ti-cpu','document':'ti-file-text',
  'cybersecurity':'ti-shield','data science':'ti-chart-bar',
};
const getRoleIcon = (s: string): string => {
  const l = s.toLowerCase();
  for (const [k,v] of Object.entries(ROLE_ICONS)) if (l.includes(k)) return v;
  return 'ti-star';
};

type RowItem = (StudentData & { _type: 'student' }) | (GroupData & { _type: 'group' });

interface CreateForm { name: string; course: string; specialty: string; max: string; desc: string; }

export default function Finder() {
  const { user, viewRole, effectiveRole }  = useAuth();
  const [filter, setFilter]       = useState<FilterType>('ALL');
  const [page, setPage]           = useState(1);
  const [groups, setGroups]       = useState<GroupData[]>([]);
  const [students, setStudents]   = useState<StudentData[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [hasGroup, setHasGroup]   = useState(false);
  const [toast, setToast]         = useState('');
  const [detailGroup, setDetailGroup]     = useState<GroupData | null>(null);
  const [detailStudent, setDetailStudent] = useState<StudentData | null>(null);
  const [roleModal, setRoleModal]         = useState<{ open: boolean; group: GroupData | null; skills: string[] }>({ open:false, group:null, skills:[] });
  const [selectedRole, setSelectedRole]   = useState<string | null>(null);
  const [createOpen, setCreateOpen]       = useState(false);
  const [createDone, setCreateDone]       = useState(false);
  const [form, setForm]                   = useState<CreateForm>({ name:'', course:user?.course || '', specialty:'', max:'4', desc:'' });
  const [formError, setFormError]         = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    const loadGroups = async () => {
      try {
        const response = await fetch(`${API}/groups`, { headers: authHeaders(user, viewRole) });
        if (!response.ok) throw new Error('Unable to load groups.');
        const records = await response.json() as { GroupID: number; GroupName: string; Course: string; Specialty: string; Description: string; OwnerID: number; Status: string; FinalizedAt?: string | null; MaxMembers: number; MemberCount: number; MemberNames?: string; IsMember: number; IsPending: number }[];
        setHasGroup(records.some((record) => record.IsMember === 1 || record.IsPending === 1));
        setGroups(records.map((record) => ({
          id: String(record.GroupID), name: record.GroupName, course: record.Course,
          specialty: record.Specialty, desc: record.Description, ownerId: record.OwnerID,
          members: record.MemberCount, maxMembers: record.MaxMembers, status: record.Status,
          finalizedAt: record.FinalizedAt,
          memberNames: record.MemberNames ? record.MemberNames.split('|') : [],
          _joined: record.IsMember === 1 || record.IsPending === 1,
          availability: `${Math.max(0, record.MaxMembers - record.MemberCount)} / ${record.MaxMembers}`,
        })));
      } catch (requestError) {
        setFormError(requestError instanceof Error ? requestError.message : 'Unable to load groups.');
      }
    };
    void loadGroups();
  }, [user, viewRole]);

  useEffect(() => {
    if (!user) return;
    const loadStudents = async () => {
      setStudentsLoading(true);
      setStudentsError('');
      try {
        const response = await fetch(`${API}/students`, { headers: authHeaders(user, viewRole) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load students.');
        setStudents(data as StudentData[]);
      } catch (requestError) {
        setStudentsError(requestError instanceof Error ? requestError.message : 'Unable to load students.');
      } finally {
        setStudentsLoading(false);
      }
    };
    void loadStudents();
  }, [user, viewRole]);

  // ── Data ──
  const getRows = (): RowItem[] => {
    let list: RowItem[];
    if (filter === 'STUDENT') list = students.map(student => ({ ...student, _type:'student' as const }));
    else list = groups.map(g => ({ ...g, _type:'group' as const }));
    return list;
  };
  const rows  = getRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleStudentCounts = students.reduce<Record<string, number>>((counts, student) => {
    counts[student.course] = (counts[student.course] || 0) + 1;
    return counts;
  }, {});

  // ── Join group ──
  const openRoleModal = (g: GroupData) => {
    const skills = g.specialty ? g.specialty.split('/').map(s => s.trim()) : ['Developer'];
    setRoleModal({ open:true, group:g, skills });
    setSelectedRole(null);
  };

  const confirmJoin = async () => {
    const g = roleModal.group!;
    if (!user) return;
    const response = await fetch(`${API}/groups/${g.id}/join`, {
      method: 'POST',
      headers: authHeaders(user, viewRole),
    });
    const data = await response.json() as { success?: boolean; pending?: boolean; message?: string };
    if (!response.ok) {
      setToast(data.message || 'Unable to join the group.');
      return;
    }
    setGroups(gs => gs.map(gr => gr.id === g.id
      ? { ...gr, _joined: true }
      : gr));
    const myG = {
      id: g.id, name: g.name, desc: g.desc, specialty: g.specialty,
      maxMembers: g.maxMembers,
      skills: g.specialty?.split('/').map(s => s.trim()) ?? [selectedRole ?? 'Developer'],
      pending: [{ id: g.id, name: user.name, course: g.course, userId: Number(user.id) }],
      members: (g.memberNames || []).map((memberName, index) => ({ name: memberName, role: (index === 0 ? 'owner' : 'member') as 'owner' | 'member' })),
      ownerId: g.ownerId,
      status: g.status,
    };
    setHasGroup(true);
    sessionStorage.setItem('jf_mygroup', JSON.stringify(myG));
    window.dispatchEvent(new Event('jf-mygroup-updated'));
    setRoleModal({ open:false, group:null, skills:[] });
    setDetailGroup(null);
    setToast(`Join request sent for "${g.name}".`);
  };

  // ── Create group ──
  const handleCreate = async () => {
    if (!user || effectiveRole !== 'student') {
      setFormError('Only students can create groups.');
      return;
    }
    setFormError('');
    if (!form.name)      { setFormError('Please enter a Group Name.'); return; }
    if (!form.course)    { setFormError('Your account needs a course assigned before you create a group.'); return; }
    if (!form.specialty) { setFormError('Please enter a Specialty / Focus.'); return; }
    const max = parseInt(form.max);
    const response = await fetch(`${API}/groups`, {
      method: 'POST',
      headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: form.name, course: form.course, specialty: form.specialty, maxMembers: max, description: form.desc }),
    });
    const data = await response.json() as { success?: boolean; message?: string; group?: { GroupID: number; GroupName: string; Course: string; Specialty: string; Description: string; OwnerID: number; Status: string; FinalizedAt: string | null; MaxMembers: number; MemberCount: number } };
    if (!response.ok || !data.group) { setFormError(data.message || 'Unable to create group.'); return; }
    const created = data.group;
    const newG: GroupData = {
      id: String(created.GroupID), name: created.GroupName, course: created.Course,
      specialty: created.Specialty, maxMembers: created.MaxMembers, members: created.MemberCount,
      desc: created.Description, ownerId: created.OwnerID, status: created.Status,
      availability: `${Math.max(0, created.MaxMembers - created.MemberCount)} / ${created.MaxMembers}`, _joined: true,
      memberNames: [user.name],
      _memberNames: [user.name],
    };
    setGroups(gs => [newG, ...gs]);
    setHasGroup(true);
    sessionStorage.setItem('jf_mygroup', JSON.stringify({
      id: newG.id, name: newG.name, desc: newG.desc, specialty: newG.specialty,
      maxMembers: max, skills: form.specialty.split('/').map(s => s.trim()),
      pending: [], members: [{ name: user?.name ?? 'You', role: 'owner' }],
      ownerId: Number(user.id), status: created.Status, finalizedAt: created.FinalizedAt || null,
    }));
    setCreateDone(true);
  };

  const closeCreate = () => {
    setCreateOpen(false); setCreateDone(false);
    setForm({ name:'', course:user?.course || '', specialty:'', max:'4', desc:'' }); setFormError('');
  };

  const cols = filter === 'GROUP'
    ? ['NAME','SPECIALTY','MEMBERS','COURSE','AVAILABILITY','STATUS']
    : filter === 'STUDENT'
    ? ['NAME','SPECIALTY','COURSE','GROUP','AVAILABILITY']
    : ['NAME','SPECIALTY','GROUP / MEMBERS','COURSE','AVAILABILITY'];

  return (
    <Layout>
      <div className="finder-body d-flex flex-column" style={{ flex:1, overflow:'hidden', background:'var(--bg-page)' }}>

        {/* Toolbar */}
        <div className="finder-toolbar d-flex align-items-center gap-2 flex-wrap px-3 py-2">
          <Dropdown>
            <Dropdown.Toggle as="button" className="filter-dropdown-btn">
              Filter by: <strong>{filter}</strong>
            </Dropdown.Toggle>
            <Dropdown.Menu as="ul" className="finder-dropdown-menu">
              {(['ALL','STUDENT','GROUP'] as FilterType[]).map(f => (
                <li key={f}>
                  <button className={`dropdown-item finder-dropdown-item${filter===f?' active':''}`}
                    onClick={() => { setFilter(f); setPage(1); }}>
                    {f}
                  </button>
                </li>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <div className="flex-grow-1"></div>
          {effectiveRole === 'student' && !hasGroup && (
            <Button className="create-group-btn" onClick={() => setCreateOpen(true)}>Create Group</Button>
          )}
          <button className="page-arrow" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
            <i className="ti ti-arrow-left"></i>
          </button>
          <button className="page-arrow" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>
            <i className="ti ti-arrow-right"></i>
          </button>
        </div>

        {filter === 'STUDENT' && (
          <section className="finder-course-summary" aria-label="Student counts by course">
            <strong>STUDENTS BY COURSE</strong>
            {studentsLoading && <span className="finder-course-count">Loading database students...</span>}
            {!studentsLoading && studentsError && <span className="finder-course-count finder-data-error" role="alert">{studentsError}</span>}
            {!studentsLoading && !studentsError && Object.entries(visibleStudentCounts).sort(([a], [b]) => a.localeCompare(b)).map(([course, count]) => (
              <span className="finder-course-count" key={course}>
                <b>{course}</b><span>{count} {count === 1 ? 'student' : 'students'}</span>
              </span>
            ))}
            {!studentsLoading && !studentsError && <span className="finder-course-total">{rows.length} total</span>}
          </section>
        )}

        {/*Table*/}
        <div className="table-wrap flex-grow-1" style={{ overflowY:'auto', overflowX:'auto', padding:'0 12px' }}>
          <Table className="finder-table mb-0">
            <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {slice.length === 0 ? (
                <tr><td colSpan={cols.length} className="text-center py-5" style={{ color:'rgba(26,42,74,.4)', fontStyle:'italic' }}>
                  {filter === 'STUDENT' && studentsLoading ? 'Loading students from database...' : filter === 'STUDENT' && studentsError ? studentsError : filter === 'STUDENT' ? 'No student accounts found in the database.' : 'No records found.'}
                </td></tr>
              ) : slice.map(row => {
                if (row._type === 'student') {
                  const s = row as StudentData & { _type: 'student' };
                  return (
                    <tr key={s.id} onClick={() => setDetailStudent(s)} style={{ cursor:'pointer' }}>
                      <td><span className="finder-name-link">{s.name}</span></td>
                      <td>{s.specialty}</td>
                      <td>{s.course}</td>
                      <td>{s.group === '--' ? <span style={{ opacity:.4 }}>--</span> : s.group}</td>
                      <td><span className="student-availability" aria-label={s.availability === '1' ? 'Available to join a group' : 'Already in a group'}>{s.availability}</span></td>
                    </tr>
                  );
                }
                const g = row as GroupData & { _type: 'group' };
                const isFull = g.status === 'Full';
                return (
                  <tr key={g.id} onClick={() => setDetailGroup(g)} style={{ cursor:'pointer' }}>
                    <td>
                      <span className="finder-name-link">{g.name}</span>
                      {filter === 'ALL' && <Badge bg="" className="ms-2" style={{ background:'rgba(46,109,164,.2)', color:'#2e6da4', fontSize:9 }}>GROUP</Badge>}
                    </td>
                    <td>{g.specialty}</td>
                    <td>{g.members}/{g.maxMembers}</td>
                    <td>{g.course}</td>
                    <td><span className={`avail-badge${isFull?' full':''}`} aria-label={`${Math.max(0, g.maxMembers - g.members)} open slots out of ${g.maxMembers}`}>
                      {Math.max(0, g.maxMembers - g.members)} / {g.maxMembers}
                    </span></td>
                    {filter === 'GROUP' && <td><span className={`status-pill ${g.status.toLowerCase()}`}>{g.status}</span></td>}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>

        {/*Footer*/}
        <div className="finder-footer d-flex align-items-center justify-content-between px-3 py-2">
          <button className="back-btn" onClick={() => window.history.back()}>
            <i className="ti ti-arrow-left me-1"></i> BACK
          </button>
          <span className="page-info">Page {page} of {pages} · {rows.length} records</span>
        </div>
      </div>

      {/* Group Detail Modal */}
      <Modal show={!!detailGroup} onHide={() => setDetailGroup(null)} centered size="lg" className="jf-group-detail-modal">
        {detailGroup && (() => {
          const g = groups.find(gr => gr.id === detailGroup.id) || detailGroup;
          const skills  = g.specialty ? g.specialty.split('/').map(s => s.trim()) : ['Developer'];
          const slots   = g.maxMembers - g.members;
          const members = g.memberNames ?? [];
          return (
            <Modal.Body className="p-0">
              <button className="gd-modal-x" onClick={() => setDetailGroup(null)}><i className="ti ti-x"></i></button>
              <div className="gd-inner">
                <div className="gd-left-card">
                  <div className="gd-group-header">
                    <div className="gd-group-icon"><i className="ti ti-users-group"></i></div>
                    <span className="gd-group-title">GROUP</span>
                  </div>
                  <div className="gd-avatar-wrap">
                    <div className="gd-owner-avatar">{getInitials(g.name)}</div>
                  </div>
                  <div className="gd-group-name-box">{g.name.toUpperCase()}</div>
                  <div className="gd-members-section">
                    <div className="gd-members-label">GROUP MEMBER:</div>
                    <div className="gd-members-list">
                      {members.map((n, i) => <div key={i} className={`gd-member-pill${i === 0 ? ' leader' : ''}`}>
                        {n}{i === 0 && <span className="gd-leader-tag">Leader</span>}
                      </div>)}
                    </div>
                  </div>
                </div>
                <div className="gd-right-card">
                  <div className="gd-desc-box">
                    <div className="gd-desc-title">Description:</div>
                    <div className="gd-desc-text">{g.desc}</div>
                  </div>
                  <div className="gd-info-row">
                    <div className="gd-info-box">
                      <div className="gd-info-label">SKILL THAT WE ARE LOOKING FOR:</div>
                      {skills.map((s, i) => <div key={i} className="gd-skill-pill">{s.toUpperCase()}</div>)}
                    </div>
                    <div className="gd-info-box">
                      <div className="gd-info-label">AVAILABLE SLOTS:</div>
                      {slots <= 0
                        ? <div className="gd-slot-pill" style={{ opacity:.45 }}>NO OPEN SLOTS</div>
                        : skills.slice(0, slots).map((s, i) => <div key={i} className="gd-slot-pill">{s.toUpperCase()}</div>)
                      }
                    </div>
                  </div>
                  <div className="gd-actions">
                    {g._joined || slots <= 0 || g.finalizedAt
                      ? <button className="gd-btn joined" disabled><i className="ti ti-clock me-1"></i>{g.finalizedAt ? 'Finalized' : g._joined ? 'Pending Approval' : 'Group Full'}</button>
                      : <button className="gd-btn join" onClick={() => openRoleModal(g)}><i className="ti ti-circle-check me-1"></i>VIEW GROUP / JOIN</button>
                    }
                    <button className="gd-btn back" onClick={() => setDetailGroup(null)}><i className="ti ti-arrow-left me-1"></i>BACK</button>
                  </div>
                </div>
              </div>
            </Modal.Body>
          );
        })()}
      </Modal>

      {/* Student Modal */}
      <Modal show={!!detailStudent} onHide={() => setDetailStudent(null)} centered className="jf-modal">
        {detailStudent && (() => {
          const s    = detailStudent;
          const init = getInitials(s.name);
          return (
            <>
              <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
                <div className="modal-avatar mb-2">{init}</div>
                <div className="modal-title-text">{s.name}</div>
                <div className="modal-sub-text">{s.course} · {s.year}</div>
              </Modal.Header>
              <Modal.Body>
                {([['Specialty', s.specialty],['Course & Year',`${s.course} · ${s.year}`],['Current Group', s.group==='--'?'Not in a group':s.group],['Status', s.status]] as [string,string][]).map(([l,v]) => (
                  <div className="detail-row" key={l}>
                    <div className="detail-row-label">{l}</div>
                    <div className="detail-row-value">{v}</div>
                  </div>
                ))}
                <div className="detail-row">
                  <div className="detail-row-label">Skills</div>
                  <div className="d-flex flex-wrap gap-1 mt-1">
                    {(s.skills || []).map((sk, i) => <span key={i} className="skill-tag">{sk}</span>)}
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                {s.status === 'Looking for group'
                  ? <Button className="w-100" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700 }}>Invite to Group →</Button>
                  : <Button className="w-100" disabled style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.35)' }}>Already in a Group</Button>
                }
              </Modal.Footer>
            </>
          );
        })()}
      </Modal>

      {/*Role Selection Modal*/}
      <Modal show={roleModal.open} onHide={() => setRoleModal({ open:false, group:null, skills:[] })} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2" style={{ background:'rgba(46,204,113,.2)', color:'var(--green)' }}><i className="ti ti-users-group"></i></div>
          <div className="modal-title-text">Choose Your Role</div>
          <div className="modal-sub-text">Select the role you want to fill in this group</div>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-2">
          {roleModal.group && roleModal.skills.slice(0, roleModal.group.maxMembers - roleModal.group.members).map(skill => (
            <button key={skill} className={`role-option-btn${selectedRole===skill?' selected':''}`} onClick={() => setSelectedRole(skill)}>
              <i className={`ti ${getRoleIcon(skill)}`}></i>
              <span>{skill}</span>
            </button>
          ))}
          {selectedRole && (
              <Button className="w-100 mt-2" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:800, borderRadius:12, padding:'12px' }} onClick={() => void confirmJoin()}>
              Confirm Role
            </Button>
          )}
        </Modal.Body>
      </Modal>

      {/*Create Group Modal*/}
      <Modal show={createOpen} onHide={closeCreate} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2" style={{ background:'rgba(245,158,11,.2)', color:'var(--amber)', fontSize:26 }}><i className="ti ti-users-group"></i></div>
          <div className="modal-title-text">Create a New Group</div>
          <div className="modal-sub-text">Fill in the details to start your capstone group</div>
        </Modal.Header>
        {createDone ? (
          <>
            <Modal.Body className="text-center py-4">
              <i className="ti ti-circle-check" style={{ fontSize:52, color:'var(--green)', display:'block', marginBottom:12 }}></i>
              <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>Group Created!</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,.45)', marginTop:6 }}>"{form.name}" has been added to the Finder.</div>
            </Modal.Body>
            <Modal.Footer>
              <Button className="w-100" style={{ background:'var(--navy-light)', border:'none', fontWeight:700, borderRadius:10 }}
                onClick={() => { closeCreate(); setFilter('GROUP'); setPage(1); }}>
                View in Finder
              </Button>
            </Modal.Footer>
          </>
        ) : (
          <>
            <Modal.Body>
              <Form className="d-flex flex-column gap-3">
                {([{ l:'Group Name', k:'name', ph:'e.g. EcoSort: Smart Waste Classification' },{ l:'Specialty / Focus', k:'specialty', ph:'e.g. AI / Computer Vision' }] as { l:string; k:keyof CreateForm; ph:string }[]).map(f => (
                  <Form.Group key={f.k}>
                    <Form.Label className="jf-label">{f.l}</Form.Label>
                    <Form.Control className="jf-input" type="text" placeholder={f.ph} value={form[f.k]} onChange={e => setForm(fm => ({ ...fm, [f.k]: e.target.value }))} />
                  </Form.Group>
                ))}
                <Form.Group>
                  <Form.Label className="jf-label">Course</Form.Label>
                  <Form.Select className="jf-input" value={form.course} onChange={e => setForm(fm => ({ ...fm, course: e.target.value }))}>
                    <option value="">Select Course…</option>
                    {['BSIT','BSCS','BSEMC','BSIS'].map(c => <option key={c}>{c}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label className="jf-label">Max Members <span style={{ fontWeight:400, color:'rgba(255,255,255,.35)', fontSize:10 }}>(min 2 · max 4)</span></Form.Label>
                  <Form.Select className="jf-input" value={form.max} onChange={e => setForm(fm => ({ ...fm, max: e.target.value }))}>
                    {['2','3','4'].map(v => <option key={v}>{v}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label className="jf-label">Description</Form.Label>
                  <Form.Control as="textarea" className="jf-input" rows={3} placeholder="Brief description of your project…" value={form.desc} onChange={e => setForm(fm => ({ ...fm, desc: e.target.value }))} />
                </Form.Group>
                {formError && (
                  <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ fontSize:12, borderRadius:8 }}>
                    <i className="ti ti-alert-circle"></i> {formError}
                  </div>
                )}
              </Form>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={() => void handleCreate()}>Create Group</Button>
              <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={closeCreate}>Cancel</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}