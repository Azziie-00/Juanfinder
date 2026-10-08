import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Array<'student' | 'adviser' | 'admin' | 'superadmin'> }) {
  const { user, effectiveRole } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && (!effectiveRole || !roles.includes(effectiveRole))) return <Navigate to="/" replace />;
  return <>{children}</>;
}