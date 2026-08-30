import { createContext } from 'react';
import type { AuthUser } from '../data/datas';

export interface AuthContextType {
  user: AuthUser | null;
  login: (userData: AuthUser) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);
