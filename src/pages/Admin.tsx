import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import '../styles/admin.css';

type AdminUser = { UserID: number; UserCode: string; Username: string; Name: string; Role: string; IsActive: boolean; CreatedAt: string; Course?: string; AdviseeCount?: number };
type AdviserOption = { UserID: number; Name: string; UserCode: string; Username: string };
type AdminGroup = { GroupID: number; GroupName: string; Course: string; Status: string; MemberCount: number; MaxMembers: number };
type Summary = { users: number; activeUsers: number; students: number; advisers: number; groups: number; openGroups: number };

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/admin`;
export default function Admin() {
  const { user } = useAuth();
  const { viewRole } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [adviserOptions, setAdviserOptions] = useState<AdviserOption[]>([]);
  const [view, setView] = useState<'users' | 'groups' | 'advisers'>('users');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [newUser, setNewUser] = useState({ username: '', userCode: '', role: 'student', password: '', course: '', adviserId: '' });

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError('');
    try {
      const [summaryRes, usersRes, groupsRes, coursesRes, advisersRes] = await Promise.all([
        fetch(`${API}/summary`, { headers: authHeaders(user, viewRole) }), fetch(`${API}/users?page=${page}&limit=10&role=${view === 'advisers' ? 'adviser' : 'student'}`, { headers: authHeaders(user, viewRole) }), fetch(`${API}/groups`, { headers: authHeaders(user, viewRole) }), fetch(`${API}/courses`, { headers: authHeaders(user, viewRole) }), fetch(`${API}/advisers`, { headers: authHeaders(user, viewRole) }),
      ]);
      if (![summaryRes, usersRes, groupsRes, coursesRes, advisersRes].every((res) => res.ok)) throw new Error('The admin data could not be loaded.');
      setSummary(await summaryRes.json());
      const userData = await usersRes.json();
      setUsers(userData.items); setTotalUsers(userData.total); setUserPage(userData.page);
      setGroups(await groupsRes.json());
      setCourses(await coursesRes.json());
      setAdviserOptions(await advisersRes.json());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Cannot connect to the server.');
    } finally { setLoading(false); }
  }, [user, viewRole, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const toggleUser = async (record: AdminUser) => {
    const response = await fetch(`${API}/users/${record.UserID}/status`, { method: 'PATCH', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify({ active: !record.IsActive }) });
    if (response.ok) setUsers((current) => current.map((item) => item.UserID === record.UserID ? { ...item, IsActive: !item.IsActive } : item));
  };
  const addUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${API}/users`, { method: 'POST', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ...newUser, role: view === 'advisers' ? 'adviser' : newUser.role }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.message || `Unable to add user (HTTP ${response.status}).`); return; }
      setShowAddUser(false); setShowNewPassword(false); setQuery(''); setNewUser({ username: '', userCode: '', role: 'student', password: '', course: '', adviserId: '' }); await load(1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not connect to the server.');
    }
  };
  const removeUser = async (record: AdminUser) => {
    if (!window.confirm(`Remove ${record.Username}? This cannot be undone.`)) return;
    const response = await fetch(`${API}/users/${record.UserID}`, { method: 'DELETE', headers: authHeaders(user, viewRole) });
    if (response.ok) setUsers((current) => current.filter((item) => item.UserID !== record.UserID));
    else setError('Unable to remove user.');
  };
  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editUser) return;
    const response = await fetch(`${API}/users/${editUser.UserID}`, { method: 'PATCH', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify({ username: editUser.Username, userCode: editUser.UserCode, role: editUser.Role, password: editPassword }) });
    const data = await response.json();
    if (!response.ok) { setError(data.message || 'Unable to edit user.'); return; }
    setEditUser(null); setEditPassword(''); await load(userPage);
  };
  const removeGroup = async (group: AdminGroup) => {
    if (!window.confirm(`Delete ${group.GroupName}?`)) return;
    const response = await fetch(`${API}/groups/${group.GroupID}`, { method: 'DELETE', headers: authHeaders(user, viewRole) });
    if (response.ok) setGroups((current) => current.filter((item) => item.GroupID !== group.GroupID));
  };
  const filteredUsers = users.filter((item) => `${item.Name} ${item.UserCode} ${item.Username}`.toLowerCase().includes(query.toLowerCase()));
  const adviserUsers = users.filter((item) => `${item.Name} ${item.UserCode} ${item.Username}`.toLowerCase().includes(query.toLowerCase()));
  const filteredGroups = groups.filter((item) => item.Status === 'Full' && `${item.GroupName} ${item.Course} ${item.Status}`.toLowerCase().includes(query.toLowerCase()));

  if (view === 'advisers') return <Layout><main className="admin-body">
    <div className="admin-heading"><div><div className="admin-eyebrow">SYSTEM CONTROL</div><h1>Advisers</h1><p>Manage the adviser accounts shown to students.</p></div><button className="admin-refresh" onClick={() => void load(userPage)} title="Refresh advisers"><i className="ti ti-refresh"></i></button></div>
    {error && <div className="admin-alert"><i className="ti ti-alert-triangle"></i>{error}</div>}
    <section className="admin-panel"><div className="admin-panel-head"><div className="admin-tabs"><button onClick={() => setView('users')}><i className="ti ti-users"></i> Students</button><button onClick={() => setView('groups')}><i className="ti ti-users-group"></i> Groups</button><button className="active"><i className="ti ti-school"></i> Advisers</button></div><div className="admin-panel-actions"><button className="admin-add" onClick={() => setShowAddUser(true)}><i className="ti ti-user-plus"></i> Add adviser</button><div className="admin-search"><i className="ti ti-search"></i><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search advisers..." /></div></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>Adviser</th><th>Status</th><th>Advisees</th><th>Control</th></tr></thead><tbody>{adviserUsers.map((record) => <tr key={record.UserID}><td>{record.UserCode || record.UserID}</td><td><strong>{record.Name || record.Username}</strong><small>{record.Username}</small></td><td><span className={`admin-status ${record.IsActive ? 'on' : 'off'}`}>{record.IsActive ? 'Active' : 'Disabled'}</span></td><td>{record.AdviseeCount ?? 0}</td><td><button className="admin-action" onClick={() => setEditUser({ ...record })} title="Edit adviser"><i className="ti ti-edit"></i></button><button className="admin-action" onClick={() => void toggleUser(record)}>{record.IsActive ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table>{!loading && adviserUsers.length === 0 && <div className="admin-empty">No advisers found.</div>}</div>
    </section><div className="admin-footnote"><i className="ti ti-database"></i> Connected to JuanFinder Supabase data <span>Signed in as {user?.name}</span></div>
    {showAddUser && <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowAddUser(false)}><form className="admin-form" onSubmit={addUser}><div className="admin-form-head"><div><div className="admin-eyebrow">USER CONTROL</div><h2>Add adviser</h2></div><button type="button" className="admin-close" onClick={() => setShowAddUser(false)}><i className="ti ti-x"></i></button></div><label>Username<input required value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} /></label><label>ID / Adviser ID<input required value={newUser.userCode} onChange={(event) => setNewUser({ ...newUser, userCode: event.target.value })} /></label><input type="hidden" value="adviser" /><label>Password<input required minLength={6} type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, role: 'adviser', password: event.target.value })} /></label><div className="admin-form-actions"><button type="button" className="admin-cancel" onClick={() => setShowAddUser(false)}>Cancel</button><button type="submit" className="admin-submit"><i className="ti ti-user-plus"></i> Add adviser</button></div></form></div>}
  </main></Layout>;

  return <Layout><main className="admin-body">
    <div className="admin-heading"><div><div className="admin-eyebrow">SYSTEM CONTROL</div><h1>Administration</h1><p>Manage JuanFinder users and capstone groups.</p></div><button className="admin-refresh" onClick={() => void load(userPage)} title="Refresh data"><i className="ti ti-refresh"></i></button></div>
    {error && <div className="admin-alert"><i className="ti ti-alert-triangle"></i>{error}</div>}
    <div className="admin-stats">{[['ti-users','Total users', summary?.users ?? 0], ['ti-user-check','Active accounts', summary?.activeUsers ?? 0], ['ti-school','Advisers', summary?.advisers ?? 0], ['ti-users-group','Open groups', summary?.openGroups ?? 0]].map(([icon, label, value]) => <div className="admin-stat" key={label as string}><i className={`ti ${icon}`}></i><span>{loading ? '...' : value}</span><small>{label}</small></div>)}</div>
    <section className="admin-panel"><div className="admin-panel-head"><div className="admin-tabs"><button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><i className="ti ti-users"></i> Students</button><button className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}><i className="ti ti-users-group"></i> Groups</button><button onClick={() => setView('advisers')}><i className="ti ti-school"></i> Advisers</button></div><div className="admin-panel-actions">{view !== 'groups' && <button className="admin-add" onClick={() => setShowAddUser(true)}><i className="ti ti-user-plus"></i> Add student</button>}<div className="admin-search"><i className="ti ti-search"></i><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view}...`} /></div></div></div>
      {view === 'users' ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>User</th><th>Role</th><th>Status</th><th>Course</th><th>Control</th></tr></thead><tbody>{filteredUsers.map((record) => <tr key={record.UserID}><td>{record.UserCode || record.UserID}</td><td><strong>{record.Name || record.Username}</strong><small>{record.Username}</small></td><td><span className={`admin-role ${record.Role}`}>{record.Role}</span></td><td><span className={`admin-status ${record.IsActive ? 'on' : 'off'}`}>{record.IsActive ? 'Active' : 'Disabled'}</span></td><td>{record.Course || '-'}</td><td><button className="admin-action" onClick={() => setEditUser({ ...record })} title="Edit user"><i className="ti ti-edit"></i></button><button className="admin-action" onClick={() => void toggleUser(record)}>{record.IsActive ? 'Disable' : 'Enable'}</button><button className="admin-action danger" onClick={() => void removeUser(record)}>Remove</button></td></tr>)}</tbody></table>{!loading && filteredUsers.length === 0 && <div className="admin-empty"><i className="ti ti-users-off"></i><strong>No users found</strong><span>There are no accounts on this page.</span></div>}{totalUsers > 0 && <div className="admin-pagination"><span>Showing {Math.min((userPage - 1) * 10 + 1, totalUsers)}-{Math.min(userPage * 10, totalUsers)} of {totalUsers} users</span><button disabled={userPage === 1 || loading} onClick={() => void load(userPage - 1)}><i className="ti ti-chevron-left"></i> Previous</button><button disabled={userPage * 10 >= totalUsers || loading} onClick={() => void load(userPage + 1)}>Next <i className="ti ti-chevron-right"></i></button></div>}</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Group</th><th>Course</th><th>Members</th><th>Lock status</th><th></th></tr></thead><tbody>{filteredGroups.map((group) => <tr key={group.GroupID}><td><strong>{group.GroupName}</strong></td><td>{group.Course}</td><td>{group.MemberCount} / {group.MaxMembers}</td><td><span className="admin-status off"><i className="ti ti-lock"></i> Full / Locked</span></td><td><button className="admin-action danger" onClick={() => void removeGroup(group)}>Delete</button></td></tr>)}</tbody></table>{!loading && filteredGroups.length === 0 && <div className="admin-empty"><i className="ti ti-lock-off"></i><strong>No full groups</strong><span>Groups appear here once all member slots are filled.</span></div>}{view !== 'groups' && totalUsers > 0 && <div className="admin-pagination"><span>Showing {Math.min((userPage - 1) * 10 + 1, totalUsers)}-{Math.min(userPage * 10, totalUsers)} of {totalUsers} users</span><button disabled={userPage === 1 || loading} onClick={() => void load(userPage - 1)}><i className="ti ti-chevron-left"></i> Previous</button><button disabled={userPage * 10 >= totalUsers || loading} onClick={() => void load(userPage + 1)}>Next <i className="ti ti-chevron-right"></i></button></div>}</div>}
    </section><div className="admin-footnote"><i className="ti ti-database"></i> Connected to JuanFinder Supabase data <span>Signed in as {user?.name}</span></div>
    {showAddUser && <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowAddUser(false)}><form className="admin-form" onSubmit={addUser}><div className="admin-form-head"><div><div className="admin-eyebrow">USER CONTROL</div><h2>Add student</h2></div><button type="button" className="admin-close" onClick={() => setShowAddUser(false)}><i className="ti ti-x"></i></button></div><label>Username<input required value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} /></label><label>ID / Student ID<input required value={newUser.userCode} onChange={(event) => setNewUser({ ...newUser, userCode: event.target.value })} /></label><label>Role<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option value="student">Student</option><option value="adviser">Adviser</option><option value="admin">Admin</option></select></label>{newUser.role === 'student' && <><label>Course<select required value={newUser.course} onChange={(event) => setNewUser({ ...newUser, course: event.target.value })}><option value="">Select course</option>{courses.length ? courses.map((course) => <option key={course} value={course}>{course}</option>) : <option disabled value="">No courses in database</option>}</select></label><label>Adviser (optional)<select value={newUser.adviserId} onChange={(event) => setNewUser({ ...newUser, adviserId: event.target.value })}><option value="">No adviser assigned</option>{adviserOptions.map((adviser) => <option key={adviser.UserID} value={adviser.UserID}>{adviser.Name}</option>)}</select></label></>}
    <label>Password<div className="admin-password-field"><input required minLength={6} type={showNewPassword ? 'text' : 'password'} value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} /><button type="button" className="admin-password-toggle" onClick={() => setShowNewPassword((visible) => !visible)} title={showNewPassword ? 'Hide password' : 'Show password'}><i className={`ti ${showNewPassword ? 'ti-eye-off' : 'ti-eye'}`}></i></button></div></label>
    <div className="admin-form-actions"><button type="button" className="admin-cancel" onClick={() => setShowAddUser(false)}>Cancel</button><button type="submit" className="admin-submit"><i className="ti ti-user-plus"></i> Add student</button></div></form></div>}
    {editUser && <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setEditUser(null)}><form className="admin-form" onSubmit={saveUser}><div className="admin-form-head"><div><div className="admin-eyebrow">USER CONTROL</div><h2>Edit user</h2></div><button type="button" className="admin-close" onClick={() => setEditUser(null)}><i className="ti ti-x"></i></button></div><label>Username<input required value={editUser.Username} onChange={(event) => setEditUser({ ...editUser, Username: event.target.value })} /></label><label>ID / Student ID<input required value={editUser.UserCode} onChange={(event) => setEditUser({ ...editUser, UserCode: event.target.value })} /></label><label>Role<select value={editUser.Role} onChange={(event) => setEditUser({ ...editUser, Role: event.target.value })}><option value="student">Student</option><option value="adviser">Adviser</option><option value="admin">Admin</option></select></label><label>New password (optional)<input minLength={6} type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} /></label><div className="admin-form-actions"><button type="button" className="admin-cancel" onClick={() => setEditUser(null)}>Cancel</button><button type="submit" className="admin-submit"><i className="ti ti-device-floppy"></i> Save changes</button></div></form></div>}
  </main></Layout>;
}