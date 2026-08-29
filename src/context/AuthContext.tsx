import { useState, type ReactNode } from 'react';
import type { AuthUser } from '../data/datas';
import { AuthContext } from './authContext.instance';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = sessionStorage.getItem('jf_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const login = (userData: AuthUser) => {
    sessionStorage.setItem('jf_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    sessionStorage.removeItem('jf_user');
    sessionStorage.removeItem('jf_mygroup');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}