import { useState, useRef, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { getInitials } from '../data/datas';

const NAV_LINKS = [
  { to:'/',        icon:'ti-layout-dashboard', label:'Dashboard' },
  { to:'/finder',  icon:'ti-users',            label:'Finder'    },
  { to:'/adviser', icon:'ti-user-circle',      label:'Adviser'   },
  { to:'/mygroup', icon:'ti-users-group',      label:'My Group'  },
  { to:'/library', icon:'ti-books',            label:'Library'   },
];

const ROLE_LABEL: Record<string, string> = { student:'Student', adviser:'Adviser', admin:'Admin' };

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  const initials  = getInitials(user?.name || 'JD');
  const roleLabel = ROLE_LABEL[user?.role || 'student'] || 'Student';

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-system">STI Education System</div>
          <div className="logo-brand">JuanFinder</div>
        </div>
        <nav className="sidebar-nav">
          {NAV_LINKS.map(({ to, icon, label }) => (
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
          <div className="d-flex align-items-center gap-2" ref={ddRef} style={{ position: 'relative' }}>
            <i className="ti ti-bell fs-5" style={{ color:'rgba(255,255,255,.65)', cursor:'pointer' }}></i>
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
        </header>
        {children}
      </div>
    </div>
  );
}