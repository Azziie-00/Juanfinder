import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/admin.css';

type AdminUser = { UserID: number; UserCode: string; Username: string; Name: string; FirstName?: string; LastName?: string; Role: string; IsActive: boolean; Status?: string; ExpiresAt?: string | null; CreatedAt: string; Course?: string; AdviseeCount?: number };
type AdminGroup = { GroupID: number; GroupName: string; Course: string; Status: string; MemberCount: number; MaxMembers: number };
type AdminPortfolio = { PortfolioID: number; UserID: number; Course: string; Title: string; Category: string; Description: string; FileName: string; FileType: string; FileSize: number; CreatedAt: string; StudentName: string; StudentCode: string };
type GroupMemberData = {
  group: { GroupID: number; GroupName: string; Finalized: boolean; MaxMembers: number; OwnerID: number };
  members: { UserID: number; UserCode: string; Name: string }[];
  availableStudents: { UserID: number; UserCode: string; Name: string }[];
  audit: { Student: string; Admin: string; Action: string; ChangedAt: string }[];
};
type Summary = { users: number; activeUsers: number; students: number; advisers: number; groups: number; openGroups: number };

const USER_ID_PATTERN = /^\d{1,11}$/;

const validateUserId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 'User ID is required.';
  if (!USER_ID_PATTERN.test(trimmed)) return 'User ID must contain only numeric digits and cannot exceed 11 characters.';
  return '';
};

const validatePassword = (value: string) => {
  const trimmed = value;
  const missing: string[] = [];
  if (!/[A-Z]/.test(trimmed)) missing.push('one uppercase letter');
  if (!/[a-z]/.test(trimmed)) missing.push('one lowercase letter');
  if (!/\d/.test(trimmed)) missing.push('one number');
  if (!/[^A-Za-z0-9]/.test(trimmed)) missing.push('one special character');
  if (missing.length === 0) return '';
  return `Password must include ${missing.join(', ')}.`;
};

const createInternalUsername = (firstName: string, lastName: string, userId: string) => {
  const base = `${firstName.trim()}.${lastName.trim()}`
    .replace(/[^a-zA-Z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
    .toLowerCase();
  const safeUserId = userId.trim();
  return (base || 'user') + (safeUserId ? `.${safeUserId}` : '');
};
const toLocalDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const API = `${API_BASE_URL}/admin`;

export default function Admin() {
  const { user, viewRole } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [view, setView] = useState<'users' | 'groups' | 'advisers' | 'portfolios'>('users');
  const [portfolioCourse, setPortfolioCourse] = useState('');
  const [portfolioResult, setPortfolioResult] = useState<{ course: string; items: AdminPortfolio[] } | null>(null);
  const [portfolioPreview, setPortfolioPreview] = useState<{ url: string; name: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [manageGroup, setManageGroup] = useState<GroupMemberData | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<{ name: string; password: string; expiresAt: string } | null>(null);
  const [membershipAction, setMembershipAction] = useState<'add' | 'remove'>('add');
  const [membershipStudentId, setMembershipStudentId] = useState('');
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [newUser, setNewUser] = useState({
    firstName: '',
    lastName: '',
    username: '',
    userCode: '',
    role: 'student',
    password: '',
    course: '',
    expiresAt: '',
  });

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, usersRes, groupsRes, coursesRes] = await Promise.all([
        fetch(`${API}/summary`, { headers: authHeaders(user, viewRole) }),
        fetch(`${API}/users?page=${nextPage}&limit=10&role=${view === 'advisers' ? 'adviser' : 'student'}`, { headers: authHeaders(user, viewRole) }),
        fetch(`${API}/groups`, { headers: authHeaders(user, viewRole) }),
        fetch(`${API}/courses`, { headers: authHeaders(user, viewRole) }),
      ]);

      if (![summaryRes, usersRes, groupsRes, coursesRes].every((res) => res.ok)) {
        throw new Error('The admin data could not be loaded.');
      }

      const summaryData = await summaryRes.json();
      const userData = await usersRes.json();
      setSummary(summaryData);
      setUsers(userData.items ?? []);
      setPage(userData.page ?? nextPage);
      setGroups(await groupsRes.json());
      setCourses(await coursesRes.json());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Cannot connect to the server.');
    } finally {
      setLoading(false);
    }
  }, [user, viewRole, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (view !== 'portfolios' || !portfolioCourse) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/portfolio?course=${encodeURIComponent(portfolioCourse)}`, { headers: authHeaders(user, viewRole) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load course portfolios.');
        return data as AdminPortfolio[];
      })
      .then(data => { if (!cancelled) setPortfolioResult({ course: portfolioCourse, items: data }); })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load course portfolios.'); });
    return () => { cancelled = true; };
  }, [view, portfolioCourse, user, viewRole]);

  const toggleUser = async (record: AdminUser) => {
    const response = await fetch(`${API}/users/${record.UserID}/status`, {
      method: 'PATCH',
      headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ active: !record.IsActive }),
    });

    if (response.ok) {
      setUsers((current) => current.map((item) => item.UserID === record.UserID ? { ...item, IsActive: !item.IsActive } : item));
    }
  };

  const addUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const idError = validateUserId(newUser.userCode);
    if (idError) {
      setError(idError);
      return;
    }

    const passwordError = validatePassword(newUser.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    const firstName = newUser.firstName.trim();
    const lastName = newUser.lastName.trim();
    if (!firstName || !lastName) {
      setError('First name and last name are required.');
      return;
    }

    try {
      const payload = {
        ...newUser,
        firstName,
        lastName,
        username: createInternalUsername(firstName, lastName, newUser.userCode),
        role: view === 'advisers' ? 'adviser' : newUser.role,
        expiresAt: newUser.expiresAt || null,
      };

      const response = await fetch(`${API}/users`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || `Unable to add user (HTTP ${response.status}).`);
        return;
      }

      setShowAddUser(false);
      setNewUser({ firstName: '', lastName: '', username: '', userCode: '', role: 'student', password: '', course: '', expiresAt: '' });
      await load(1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not connect to the server.');
    }
  };

  const removeUser = async (record: AdminUser) => {
    if (!window.confirm(`Remove ${record.Username}? This cannot be undone.`)) return;
    const response = await fetch(`${API}/users/${record.UserID}`, {
      method: 'DELETE',
      headers: authHeaders(user, viewRole),
    });

    if (response.ok) {
      setUsers((current) => current.filter((item) => item.UserID !== record.UserID));
    } else {
      setError('Unable to remove user.');
    }
  };

  const issueTemporaryAccess = async (record: AdminUser) => {
    if (!window.confirm(`Issue temporary access to ${record.Name}? The account expires in seven days and requires a password change at next sign-in.`)) return;
    try {
      const response = await fetch(`${API}/users/${record.UserID}/temporary-access`, {
        method: 'POST',
        headers: authHeaders(user, viewRole),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Unable to issue temporary access.');
        return;
      }
      setTemporaryCredential({ name: record.Name, password: data.temporaryPassword, expiresAt: data.expiresAt });
      await load(page);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to issue temporary access.');
    }
  };

  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editUser) return;

    const response = await fetch(`${API}/users/${editUser.UserID}`, {
      method: 'PATCH',
      headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: editUser.Username,
        userCode: editUser.UserCode,
        role: editUser.Role,
        password: editPassword,
        firstName: editUser.FirstName || editUser.Name.trim().split(/\s+/)[0],
        lastName: editUser.LastName || editUser.Name.trim().split(/\s+/).slice(1).join(' '),
        expiresAt: editExpiresAt || null,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Unable to edit user.');
      return;
    }

    setEditUser(null);
    setEditPassword('');
    await load(page);
  };

  const removeGroup = async (group: AdminGroup) => {
    if (!window.confirm(`Delete ${group.GroupName}?`)) return;
    const response = await fetch(`${API}/groups/${group.GroupID}`, {
      method: 'DELETE',
      headers: authHeaders(user, viewRole),
    });

    if (response.ok) {
      setGroups((current) => current.filter((item) => item.GroupID !== group.GroupID));
    }
  };

  const loadGroupMembers = async (group: AdminGroup) => {
    setError('');
    const response = await fetch(`${API}/groups/${group.GroupID}/members`, { headers: authHeaders(user, viewRole) });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Unable to load group members.');
      return;
    }
    setManageGroup(data);
    setMembershipAction(data.members.length >= data.group.MaxMembers ? 'remove' : 'add');
    setMembershipStudentId('');
  };

  const changeFinalizedMembership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manageGroup || !membershipStudentId) return;
    const response = await fetch(`${API}/groups/${manageGroup.group.GroupID}/members`, {
      method: 'POST',
      headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ studentId: Number(membershipStudentId), action: membershipAction }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message || 'Unable to change finalized group membership.');
      return;
    }
    const group = groups.find((item) => item.GroupID === manageGroup.group.GroupID);
    if (group) await loadGroupMembers(group);
    await load(page);
  };

  const previewPortfolio = async (entry: AdminPortfolio) => {
    try {
      const response = await fetch(`${API_BASE_URL}/portfolio/${entry.PortfolioID}/preview?course=${encodeURIComponent(entry.Course)}`, {
        headers: authHeaders(user, viewRole),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Unable to open this portfolio file.');
        return;
      }
      setPortfolioPreview({ url: data.url, name: entry.FileName });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to open this portfolio file.');
    }
  };

  const filteredUsers = users.filter((item) => `${item.Name} ${item.UserCode} ${item.Username}`.toLowerCase().includes(query.toLowerCase()));
  const adviserUsers = users.filter((item) => `${item.Name} ${item.UserCode} ${item.Username}`.toLowerCase().includes(query.toLowerCase()));
  const filteredGroups = groups.filter((item) => `${item.GroupName} ${item.Course} ${item.Status}`.toLowerCase().includes(query.toLowerCase()));
  const portfolios = portfolioResult?.course === portfolioCourse ? portfolioResult.items : [];

  const renderUsersTable = (items: AdminUser[]) => (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>User</th>
            <th>Status</th>
            <th>Expiration</th>
            <th>Course</th>
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          {items.map((record) => (
            <tr key={record.UserID}>
              <td>{record.UserCode || record.UserID}</td>
              <td>
                <strong>{record.Name || record.Username}</strong>
                <small>{record.Username}</small>
              </td>
              <td>
                <span className={`admin-status ${record.IsActive ? 'on' : 'off'}`}>{record.Status || (record.IsActive ? 'Active' : 'Disabled')}</span>
              </td>
              <td>{record.ExpiresAt ? new Date(record.ExpiresAt).toLocaleString() : 'No expiration'}</td>
              <td>{record.Course || '—'}</td>
              <td>
                <button className="admin-action" onClick={() => { setEditUser({ ...record }); setEditExpiresAt(toLocalDateTime(record.ExpiresAt)); }} title="Edit user"><i className="ti ti-edit"></i></button>
                <button className="admin-action" disabled={record.Status === 'Expired'} onClick={() => void toggleUser(record)}>{record.IsActive ? 'Disable' : 'Enable'}</button>
                <button className="admin-action" onClick={() => void issueTemporaryAccess(record)} title="Issue seven-day temporary access"><i className="ti ti-clock"></i></button>
                <button className="admin-action danger" onClick={() => void removeUser(record)} title="Delete user"><i className="ti ti-trash"></i></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 && <div className="admin-empty">No users found.</div>}
    </div>
  );

  return (
    <Layout hideSidebar>
      <main className="admin-body">
        <div className="admin-heading">
          <div>
            <div className="admin-eyebrow">SYSTEM CONTROL</div>
            <h1>{view === 'advisers' ? 'Advisers' : view === 'groups' ? 'Groups' : view === 'portfolios' ? 'Student Portfolios' : 'Administration'}</h1>
            <p>{view === 'advisers' ? 'Manage the adviser accounts shown to students.' : view === 'groups' ? 'Review capstone groups and team health.' : view === 'portfolios' ? 'Review student work within a selected course.' : 'Manage JuanFinder users and capstone groups.'}</p>
          </div>
          <button className="admin-refresh" onClick={() => void load(page)} title="Refresh data"><i className="ti ti-refresh"></i></button>
        </div>

        {error && <div className="admin-alert"><i className="ti ti-alert-triangle"></i>{error}</div>}

        {view !== 'groups' && (
          <div className="admin-stats">
            {[
              ['ti-users', 'Total users', summary?.users ?? 0],
              ['ti-user-check', 'Active accounts', summary?.activeUsers ?? 0],
              ['ti-school', 'Advisers', summary?.advisers ?? 0],
              ['ti-users-group', 'Open groups', summary?.openGroups ?? 0],
            ].map(([icon, label, value]) => (
              <div className="admin-stat" key={label as string}>
                <i className={`ti ${icon}`}></i>
                <span>{loading ? '...' : value}</span>
                <small>{label}</small>
              </div>
            ))}
          </div>
        )}

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div className="admin-tabs">
              <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><i className="ti ti-users"></i> Students</button>
              <button className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}><i className="ti ti-users-group"></i> Groups</button>
              <button className={view === 'advisers' ? 'active' : ''} onClick={() => setView('advisers')}><i className="ti ti-school"></i> Advisers</button>
              <button className={view === 'portfolios' ? 'active' : ''} onClick={() => setView('portfolios')}><i className="ti ti-folder"></i> Portfolios</button>
            </div>
            <div className="admin-panel-actions">
              {view === 'portfolios' ? (
                <select className="admin-course-select" aria-label="Select course for portfolio review" value={portfolioCourse} onChange={(event) => setPortfolioCourse(event.target.value)}>
                  <option value="">Select Course</option>
                  {courses.map((course) => <option key={course} value={course}>{course}</option>)}
                </select>
              ) : <button className="admin-add" onClick={() => setShowAddUser(true)}><i className="ti ti-user-plus"></i> Add User</button>}
              <div className="admin-search">
                <i className="ti ti-search"></i>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'groups' ? 'Search groups...' : view === 'advisers' ? 'Search advisers...' : view === 'portfolios' ? 'Search portfolios...' : 'Search students...'} />
              </div>
            </div>
          </div>

          {view === 'groups' ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Course</th>
                    <th>Status</th>
                    <th>Members</th>
                    <th>Control</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGroups.map((group) => (
                    <tr key={group.GroupID}>
                      <td>
                        <strong>{group.GroupName}</strong>
                      </td>
                      <td>{group.Course}</td>
                      <td><span className={`admin-status ${group.Status === 'Full' ? 'off' : 'on'}`}>{group.Status}</span></td>
                      <td>{group.MemberCount}/{group.MaxMembers}</td>
                      <td>
                        {group.Status === 'Finalized' && <button className="admin-action" onClick={() => void loadGroupMembers(group)} title="Manage finalized group members"><i className="ti ti-users"></i></button>}
                        <button className="admin-action danger" onClick={() => void removeGroup(group)} title="Delete group"><i className="ti ti-trash"></i></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filteredGroups.length === 0 && <div className="admin-empty">No groups found.</div>}
            </div>
          ) : view === 'portfolios' ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Student</th><th>Course</th><th>Project</th><th>Category</th><th>File</th><th>Uploaded</th><th>Control</th></tr></thead>
                <tbody>
                  {portfolios.filter(entry => `${entry.StudentName} ${entry.StudentCode} ${entry.Title} ${entry.Category} ${entry.FileName}`.toLowerCase().includes(query.toLowerCase())).map(entry => (
                    <tr key={entry.PortfolioID}>
                      <td><strong>{entry.StudentName}</strong><small>{entry.StudentCode}</small></td>
                      <td>{entry.Course}</td><td>{entry.Title}</td><td>{entry.Category}</td><td>{entry.FileName}</td>
                      <td>{new Date(entry.CreatedAt).toLocaleDateString()}</td>
                      <td><button className="admin-action" onClick={() => void previewPortfolio(entry)} title="Open private portfolio file"><i className="ti ti-eye"></i></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && portfolioCourse && portfolios.length === 0 && <div className="admin-empty">No portfolios are available for this course.</div>}
              {!portfolioCourse && <div className="admin-empty">Select a course to review its portfolios.</div>}
            </div>
          ) : (
            renderUsersTable(view === 'advisers' ? adviserUsers : filteredUsers)
          )}
        </section>

        <div className="admin-footnote">
          <i className="ti ti-database"></i> Connected to JuanFinder Supabase data <span>Signed in as {user?.name}</span>
        </div>

        {showAddUser && (
          <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowAddUser(false)}>
            <form className="admin-form" onSubmit={addUser}>
              <div className="admin-form-head">
                <div>
                  <div className="admin-eyebrow">USER CONTROL</div>
                  <h2>Add User</h2>
                </div>
                <button type="button" className="admin-close" onClick={() => setShowAddUser(false)}><i className="ti ti-x"></i></button>
              </div>

              <div className="admin-form-grid">
                <label>
                  First Name
                  <input required value={newUser.firstName} onChange={(event) => setNewUser({ ...newUser, firstName: event.target.value })} />
                </label>
                <label>
                  Last Name
                  <input required value={newUser.lastName} onChange={(event) => setNewUser({ ...newUser, lastName: event.target.value })} />
                </label>
              </div>

              <label>
                User ID
                <input required value={newUser.userCode} inputMode="numeric" pattern="[0-9]*" maxLength={11} onChange={(event) => setNewUser({ ...newUser, userCode: event.target.value.replace(/\D/g, '').slice(0, 11) })} />
              </label>

              <label>
                Role
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="student">Student</option>
                  <option value="adviser">Adviser</option>
                </select>
              </label>

              <label>
                Course
                <select className="admin-course-select" value={newUser.course} onChange={(event) => setNewUser({ ...newUser, course: event.target.value })}>
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option key={course} value={course}>{course}</option>
                  ))}
                </select>
              </label>

              <label>
                Expires At (optional)
                <input type="datetime-local" value={newUser.expiresAt} onChange={(event) => setNewUser({ ...newUser, expiresAt: event.target.value })} />
              </label>

              <label>
                Password
                <div className="admin-password-field">
                  <input required minLength={8} type={showNewPassword ? 'text' : 'password'} value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
                  <button className="admin-password-toggle" type="button" aria-label={showNewPassword ? 'Hide password' : 'Show password'} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)}>
                    <i className={`ti ${showNewPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true"></i>
                  </button>
                </div>
              </label>

              <div className="admin-password-help">Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.</div>

              <div className="admin-form-actions">
                <button type="button" className="admin-cancel" onClick={() => setShowAddUser(false)}>Cancel</button>
                <button type="submit" className="admin-submit"><i className="ti ti-user-plus"></i> Add User</button>
              </div>
            </form>
          </div>
        )}

        {editUser && (
          <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setEditUser(null)}>
            <form className="admin-form" onSubmit={saveUser}>
              <div className="admin-form-head">
                <div>
                  <div className="admin-eyebrow">USER CONTROL</div>
                  <h2>Edit User</h2>
                </div>
                <button type="button" className="admin-close" onClick={() => setEditUser(null)}><i className="ti ti-x"></i></button>
              </div>

              <label>
                User ID
                <input value={editUser.UserCode} onChange={(event) => setEditUser({ ...editUser, UserCode: event.target.value })} />
              </label>

              <label>
                Username
                <input value={editUser.Username} onChange={(event) => setEditUser({ ...editUser, Username: event.target.value })} />
              </label>

              <label>
                First Name
                <input value={editUser.FirstName || editUser.Name.trim().split(/\s+/)[0]} onChange={(event) => {
                  const first = event.target.value;
                  const last = editUser.LastName || editUser.Name.trim().split(/\s+/).slice(1).join(' ');
                  setEditUser({ ...editUser, FirstName: first, Name: `${first} ${last}`.trim() });
                }} />
              </label>

              <label>
                Last Name
                <input value={editUser.LastName || editUser.Name.trim().split(/\s+/).slice(1).join(' ')} onChange={(event) => {
                  const last = event.target.value;
                  const first = editUser.FirstName || editUser.Name.trim().split(/\s+/)[0];
                  setEditUser({ ...editUser, LastName: last, Name: `${first} ${last}`.trim() });
                }} />
              </label>

              <label>
                Password
                <input type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="Leave blank to keep current password" />
              </label>

              <label>
                Expires At (leave blank for no expiration)
                <input type="datetime-local" value={editExpiresAt} onChange={(event) => setEditExpiresAt(event.target.value)} />
              </label>

              <div className="admin-form-actions">
                <button type="button" className="admin-cancel" onClick={() => setEditUser(null)}>Cancel</button>
                <button type="submit" className="admin-submit"><i className="ti ti-check"></i> Save Changes</button>
              </div>
            </form>
          </div>
        )}

        {manageGroup && (
          <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setManageGroup(null)}>
            <form className="admin-form" onSubmit={(event) => void changeFinalizedMembership(event)}>
              <div className="admin-form-head">
                <div>
                  <div className="admin-eyebrow">FINALIZED GROUP OVERRIDE</div>
                  <h2>{manageGroup.group.GroupName}</h2>
                </div>
                <button type="button" className="admin-close" onClick={() => setManageGroup(null)}><i className="ti ti-x"></i></button>
              </div>
              <p>Admin membership changes are audited. The group leader cannot be removed, and group capacity remains enforced.</p>
              <strong>Current members ({manageGroup.members.length}/{manageGroup.group.MaxMembers})</strong>
              <ul>{manageGroup.members.map((member) => <li key={member.UserID}>{member.Name} ({member.UserCode})</li>)}</ul>
              <label>
                Action
                <select value={membershipAction} onChange={(event) => { setMembershipAction(event.target.value as 'add' | 'remove'); setMembershipStudentId(''); }}>
                  <option value="add">Add student</option>
                  <option value="remove">Remove student</option>
                </select>
              </label>
              <label>
                Student
                <select required value={membershipStudentId} onChange={(event) => setMembershipStudentId(event.target.value)}>
                  <option value="">Select student</option>
                  {(membershipAction === 'add' ? manageGroup.availableStudents : manageGroup.members.filter((member) => member.UserID !== manageGroup.group.OwnerID)).map((student) => (
                    <option key={student.UserID} value={student.UserID}>{student.Name} ({student.UserCode})</option>
                  ))}
                </select>
              </label>
              <strong>Recent audit history</strong>
              {manageGroup.audit.length
                ? <ul>{manageGroup.audit.map((entry, index) => <li key={`${entry.ChangedAt}-${index}`}>{entry.Action} {entry.Student} by {entry.Admin} — {new Date(entry.ChangedAt).toLocaleString()}</li>)}</ul>
                : <p>No administrative membership changes recorded.</p>}
              <div className="admin-form-actions">
                <button type="button" className="admin-cancel" onClick={() => setManageGroup(null)}>Close</button>
                <button type="submit" className="admin-submit" disabled={!membershipStudentId}>Apply Change</button>
              </div>
            </form>
          </div>
        )}

        {temporaryCredential && (
          <div className="admin-overlay">
            <section className="admin-form" aria-labelledby="temporary-access-heading">
              <div className="admin-form-head">
                <div>
                  <div className="admin-eyebrow">ONE-TIME CREDENTIAL</div>
                  <h2 id="temporary-access-heading">Temporary access issued</h2>
                </div>
              </div>
              <p>Share this password securely with {temporaryCredential.name}. It will expire {new Date(temporaryCredential.expiresAt).toLocaleString()} and must be changed at first sign-in. This value will not be shown again.</p>
              <label>
                Temporary password
                <input readOnly value={temporaryCredential.password} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <div className="admin-form-actions">
                <button type="button" className="admin-cancel" onClick={() => void navigator.clipboard.writeText(temporaryCredential.password).catch(() => setError('Clipboard access is unavailable; select and copy the password manually.'))}>Copy password</button>
                <button type="button" className="admin-submit" onClick={() => setTemporaryCredential(null)}>Done</button>
              </div>
            </section>
          </div>
        )}

        {portfolioPreview && (
          <div className="admin-overlay" onMouseDown={(event) => event.target === event.currentTarget && setPortfolioPreview(null)}>
            <section className="admin-form" aria-labelledby="portfolio-preview-heading">
              <div className="admin-form-head">
                <div><div className="admin-eyebrow">PRIVATE PORTFOLIO FILE</div><h2 id="portfolio-preview-heading">{portfolioPreview.name}</h2></div>
                <button type="button" className="admin-close" onClick={() => setPortfolioPreview(null)}><i className="ti ti-x"></i></button>
              </div>
              <p>This signed file link is temporary and expires in one minute.</p>
              <div className="admin-form-actions">
                <a className="admin-submit" href={portfolioPreview.url} target="_blank" rel="noopener noreferrer">Open file</a>
                <button type="button" className="admin-cancel" onClick={() => setPortfolioPreview(null)}>Close</button>
              </div>
            </section>
          </div>
        )}
      </main>
    </Layout>
  );
}
