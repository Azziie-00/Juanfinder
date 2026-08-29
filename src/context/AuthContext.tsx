import { createContext, useContext, useState, ReactNode } from 'react';
import { AuthUser } from '../data/datas';

interface AuthContextType {
  user: AuthUser | null;
  login:  (userData: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

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

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}