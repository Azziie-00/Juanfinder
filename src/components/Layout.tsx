import { useState, useRef, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { getInitials, NOTIFICATIONS } from '../data/datas';

const STUDENT_NAV_LINKS = [
  { to:'/',        icon:'ti-layout-dashboard', label:'Dashboard' },
  { to:'/finder',  icon:'ti-users',            label:'Finder'    },
  { to:'/adviser', icon:'ti-user-circle',      label:'Adviser'   },
  { to:'/mygroup', icon:'ti-users-group',      label:'My Group'  },
  { to:'/library', icon:'ti-books',            label:'Library'   },
];

const ADVISER_NAV_LINKS = [
  { to:'/',         icon:'ti-home',        label:'Dashboard'    },
  { to:'/adviser',  icon:'ti-user-circle', label:'Adviser Profile' },
  { to:'/advisee',  icon:'ti-users',       label:'Advisee'      },
  { to:'/group',    icon:'ti-settings',    label:'Group'        },
  { to:'/students', icon:'ti-list-details',label:'Student List' },
];

const ADMIN_NAV_LINKS = [
  { to:'/',       icon:'ti-layout-dashboard', label:'Dashboard' },
];

const ROLE_LABEL: Record<string, string> = { student:'Student', adviser:'Adviser', admin:'Admin', superadmin:'Super Admin' };

export default function Layout({ children }: { children: ReactNode }) {
  const { user, viewRole, effectiveRole, switchViewRole, logout } = useAuth();
  const navigate = useNavigate();
  const [hasMyGroup, setHasMyGroup] = useState(() => Boolean(sessionStorage.getItem('jf_mygroup')));
  const [ddOpen, setDdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const initials  = getInitials(user?.name || 'JD');
  const roleLabel = ROLE_LABEL[effectiveRole || 'student'] || 'Student';
  const navLinks  = effectiveRole === 'admin' || effectiveRole === 'superadmin' ? ADMIN_NAV_LINKS : effectiveRole === 'adviser' ? ADVISER_NAV_LINKS : STUDENT_NAV_LINKS.filter((link) => link.to !== '/mygroup' || hasMyGroup);
  const unreadCount = NOTIFICATIONS.filter(n => !n.read).length;

  const switchDemoRole = (role: string) => {
    switchViewRole(role === 'superadmin' ? null : role as 'student' | 'adviser' | 'admin');
    navigate('/');
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const updateGroupLink = () => setHasMyGroup(Boolean(sessionStorage.getItem('jf_mygroup')));
    window.addEventListener('jf-mygroup-updated', updateGroupLink);
    return () => window.removeEventListener('jf-mygroup-updated', updateGroupLink);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-system">STI Education System</div>
          <div className="logo-brand">JuanFinder</div>
        </div>
        <nav className="sidebar-nav">
          {navLinks.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <i className={`ti ${icon}`}></i> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="nav-item"><i className="ti ti-help-circle"></i> Help</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar d-flex align-items-center justify-content-between">
          <div className="topbar-title">JuanFinder</div>
          <div className="d-flex align-items-center gap-2">
            {import.meta.env.DEV && user?.role === 'superadmin' && (
              <div className="demo-role-control" title="Temporary preview; signed-in identity remains Super Admin">
                <i className="ti ti-switch-2" aria-hidden="true"></i>
                <span>Preview</span>
                <select
                  aria-label="Preview role"
                  value={viewRole || 'superadmin'}
                  onChange={(event) => switchDemoRole(event.target.value)}
                >
                  <option value="superadmin">Super Admin</option>
                  <option value="student">Student</option>
                  <option value="adviser">Adviser</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}
            <div ref={notifRef} style={{ position: 'relative' }}>
              <i className="ti ti-bell fs-5" style={{ color:'rgba(255,255,255,.65)', cursor:'pointer' }} onClick={() => setNotifOpen(o => !o)}></i>
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}

              {notifOpen && (
                <div className="notif-dd">
                  <div className="notif-dd-list">
                    {NOTIFICATIONS.map(n => (
                      <div key={n.id} className={`notif-dd-item${n.read ? '' : ' unread'}`}>
                        <div className="notif-dd-avatar"><i className="ti ti-user"></i></div>
                        <div className="notif-dd-body">
                          <div className="notif-dd-name">{n.name}</div>
                          <div className="notif-dd-action">{n.action}</div>
                          <div className="notif-dd-time">{n.time}</div>
                        </div>
                        <i className="ti ti-check notif-dd-check"></i>
                      </div>
                    ))}
                  </div>
                  <div className="notif-dd-footer">
                    <span>See all</span>
                    <span><i className="ti ti-settings"></i> Configure</span>
                  </div>
                </div>
              )}
            </div>

            <div ref={ddRef} style={{ position: 'relative' }} className="d-flex align-items-center gap-2">
              <div className="topbar-avatar">{initials}</div>
              <div>
                <div className="user-name-text">{user?.name || 'Student'}</div>
                <div className="user-role-text">{roleLabel}</div>
              </div>
              <i className={`ti ti-chevron-down user-chevron${ddOpen ? ' open' : ''}`} onClick={() => setDdOpen(o => !o)}></i>

              {ddOpen && (
                <div className="user-dd">
                  <div className="user-dd-header">
                    <div className="user-dd-avatar">{initials}</div>
                    <div>
                      <div className="user-dd-name">{user?.name}</div>
                      <div className="user-dd-role">{roleLabel}</div>
                    </div>
                  </div>
                  <div className="user-dd-divider"></div>
                  <div className="user-dd-item" onClick={() => { setDdOpen(false); navigate('/profile'); }}><i className="ti ti-user"></i> My Profile</div>
                  <div className="user-dd-item"><i className="ti ti-settings"></i> Settings</div>
                  <div className="user-dd-divider"></div>
                  <div className="user-dd-item logout" onClick={() => { logout(); navigate('/login'); }}>
                    <i className="ti ti-logout"></i> Log Out
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
