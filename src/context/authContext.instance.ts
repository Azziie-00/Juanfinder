import { createContext } from 'react';
import type { AuthUser } from '../data/datas';

export interface AuthContextType {
  user: AuthUser | null;
  viewRole: AuthUser['role'] | null;
  effectiveRole: AuthUser['role'] | null;
  switchViewRole: (role: AuthUser['role'] | null) => void;
  login: (userData: AuthUser) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function authHeaders(user: AuthUser | null, viewRole: AuthUser['role'] | null, headers: Record<string, string> = {}) {
  return {
    ...headers,
    ...(user ? { 'x-user-id': String(user.id) } : {}),
    ...(user?.role === 'superadmin' && viewRole ? { 'x-view-role': viewRole } : {}),
  };
}
