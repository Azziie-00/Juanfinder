import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Array<'student' | 'adviser' | 'admin' | 'superadmin'> }) {
  const { user, effectiveRole } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (user.passwordChangeRequired && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!user.passwordChangeRequired && location.pathname === '/change-password') return <Navigate to="/" replace />;
  if (roles && (!effectiveRole || !roles.includes(effectiveRole))) return <Navigate to="/" replace />;
  return <>{children}</>;
}