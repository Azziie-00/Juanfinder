import { useState, useRef, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { getInitials } from '../data/datas';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import NotificationBell from './NotificationBell';
import useWebsiteActivity from './useWebsiteActivity';

const STUDENT_NAV_LINKS = [
  { to:'/',        icon:'ti-layout-dashboard', label:'Dashboard' },
  { to:'/finder',  icon:'ti-users',            label:'Finder'    },
  { to:'/adviser', icon:'ti-user-circle',      label:'Adviser'   },
  { to:'/mygroup', icon:'ti-users-group',      label:'My Group'  },
  { to:'/library', icon:'ti-books',            label:'Library'   },
];

const ADVISER_NAV_LINKS = [
  { to:'/',         icon:'ti-home',        label:'Dashboard'    },
  { to:'/group',    icon:'ti-settings',    label:'Group'        },
  { to:'/students', icon:'ti-list-details',label:'Student Members' },
];

const ADMIN_NAV_LINKS = [
  { to:'/',       icon:'ti-layout-dashboard', label:'Dashboard' },
];

const ROLE_LABEL: Record<string, string> = { student:'Student', adviser:'Adviser', admin:'Admin', superadmin:'Super Admin', library:'Library' };

const mobileQuery = '(max-width: 768px)';
const subscribeToViewport = (listener: () => void) => {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const isMobileViewport = () => window.matchMedia(mobileQuery).matches;

export default function Layout({ children, hideSidebar = false }: { children: ReactNode; hideSidebar?: boolean }) {
  const { user, viewRole, effectiveRole, switchViewRole, logout } = useAuth();
  useWebsiteActivity();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useSyncExternalStore(subscribeToViewport, isMobileViewport, () => false);
  const assistantSelected = effectiveRole === 'student' && isMobile && location.pathname === '/'
    && new URLSearchParams(location.search).get('view') === 'juan-ai';
  const sidebarVisible = !hideSidebar && effectiveRole !== 'library';
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  const initials  = getInitials(user?.name || 'JD');
  const roleLabel = ROLE_LABEL[effectiveRole || 'student'] || 'Student';
  const studentLinks = isMobile && effectiveRole === 'student'
    ? [...STUDENT_NAV_LINKS, { to: '/?view=juan-ai', icon: 'ti-message-chatbot', label: 'JUAN-AI' }]
    : STUDENT_NAV_LINKS;
  const navLinks = effectiveRole === 'admin' || effectiveRole === 'superadmin' ? ADMIN_NAV_LINKS
    : effectiveRole === 'adviser' ? ADVISER_NAV_LINKS
    : studentLinks;

  const switchDemoRole = (role: string) => {
    switchViewRole(role === 'superadmin' ? null : role as 'student' | 'adviser' | 'admin' | 'library');
    navigate(role === 'library' ? '/library' : '/');
  };

  const signOut = () => {
    const finishLogout = () => {
      logout();
      navigate('/', { replace: true });
    };
    if (!user?.sessionToken) {
      finishLogout();
      return;
    }
    void fetch(`${API_BASE_URL}/logout`, { method: 'POST', headers: authHeaders(user, viewRole) })
      .then(async response => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          console.error('Server logout failed:', data.message || response.statusText);
        }
      })
      .catch(error => console.error('Server logout failed:', error))
      .finally(finishLogout);
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDdOpen(false); };
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', h); document.removeEventListener('keydown', escape); };
  }, []);

  return (
    <div className={`app${sidebarVisible ? '' : ' app-fullscreen'}${assistantSelected ? ' mobile-assistant-active' : ''}`}>
      {sidebarVisible && <aside className="sidebar">
        <div className="logo">
          <div className="logo-system">STI Education System</div>
          <div className="logo-brand">JuanFinder</div>
        </div>
        <nav className="sidebar-nav">
          {navLinks.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              aria-current={to === '/' && assistantSelected ? false : to === '/?view=juan-ai' && !assistantSelected ? false : undefined}
              className={({ isActive }) => `nav-item${(to === '/?view=juan-ai' ? assistantSelected : isActive && !(to === '/' && assistantSelected)) ? ' active' : ''}`}>
              <i className={`ti ${icon}`} aria-hidden="true"></i> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="nav-item"><i className="ti ti-help-circle"></i> Help</span>
        </div>
      </aside>}

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
                  <option value="library">Library</option>
                </select>
              </div>
            )}
            <NotificationBell key={`${user?.id}:${viewRole || user?.role}`} />

            <div ref={ddRef} style={{ position: 'relative' }} className="d-flex align-items-center gap-2">
              <button type="button" className="topbar-avatar user-avatar-toggle" aria-label="Account menu" aria-expanded={ddOpen} aria-controls="user-account-dropdown" onClick={() => setDdOpen(o => !o)}>{initials}</button>
              <div>
                <div className="user-name-text">{user?.name || 'Student'}</div>
                <div className="user-role-text">{roleLabel}</div>
              </div>
              <button type="button" className="user-menu-toggle" aria-label="Account options" aria-expanded={ddOpen} onClick={() => setDdOpen(o => !o)}><i aria-hidden="true" className={`ti ti-chevron-down user-chevron${ddOpen ? ' open' : ''}`}></i></button>

              {ddOpen && (
                <div className="user-dd" id="user-account-dropdown">
                  <div className="user-dd-header">
                    <div className="user-dd-avatar">{initials}</div>
                    <div>
                      <div className="user-dd-name">{user?.name}</div>
                      <div className="user-dd-role">{roleLabel}</div>
                    </div>
                  </div>
                  <div className="user-dd-divider"></div>
                  <NavLink className="user-dd-item" to="/profile" onClick={() => setDdOpen(false)}><i aria-hidden="true" className="ti ti-user"></i> My Profile</NavLink>
                  {['student', 'adviser', 'library'].includes(effectiveRole || '') && <NavLink className="user-dd-item" to="/settings" onClick={() => setDdOpen(false)}><i aria-hidden="true" className="ti ti-settings"></i> Settings</NavLink>}
                  <div className="user-dd-divider"></div>
                  <button type="button" className="user-dd-item logout" onClick={signOut}>
                    <i aria-hidden="true" className="ti ti-logout"></i> Log Out
                  </button>
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
