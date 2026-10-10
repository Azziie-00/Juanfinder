import { useState, type ReactNode } from 'react';
import type { AuthUser } from '../data/datas';
import { AuthContext } from './authContext.instance';

const readSavedUser = (): AuthUser | null => {
  try {
    const raw = sessionStorage.getItem('jf_user');
    const saved = raw ? JSON.parse(raw) as AuthUser : null;
    if (saved?.sessionToken) return saved;
    sessionStorage.removeItem('jf_user');
    sessionStorage.removeItem('jf_view_role');
  } catch {
    sessionStorage.removeItem('jf_user');
    sessionStorage.removeItem('jf_view_role');
  }
  return null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readSavedUser);
  const [viewRole, setViewRole] = useState<AuthUser['role'] | null>(() => {
    try {
      const savedUser = sessionStorage.getItem('jf_user');
      const savedRole = sessionStorage.getItem('jf_view_role') as AuthUser['role'] | null;
      return savedUser && JSON.parse(savedUser).role === 'superadmin' && savedRole && savedRole !== 'superadmin' ? savedRole : null;
    } catch { return null; }
  });

  const login = (userData: AuthUser) => {
    sessionStorage.setItem('jf_user', JSON.stringify(userData));
    sessionStorage.removeItem('jf_view_role');
    setViewRole(null);
    setUser(userData);
  };

  const updateUser = (userData: AuthUser) => {
    sessionStorage.setItem('jf_user', JSON.stringify(userData));
    setUser(userData);
  };

  const switchViewRole = (role: AuthUser['role'] | null) => {
    if (user?.role !== 'superadmin' || !import.meta.env.DEV) return;
    const nextRole = role && role !== 'superadmin' ? role : null;
    if (nextRole) sessionStorage.setItem('jf_view_role', nextRole);
    else sessionStorage.removeItem('jf_view_role');
    setViewRole(nextRole);
  };

  const logout = () => {
    sessionStorage.removeItem('jf_user');
    sessionStorage.removeItem('jf_view_role');
    sessionStorage.removeItem('jf_mygroup');
    setViewRole(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, viewRole, effectiveRole: viewRole || user?.role || null, switchViewRole, login, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
