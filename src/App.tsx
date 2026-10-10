import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import ProtectedRoute    from './components/ProtectedRoute';
import Login             from './pages/Login';
import Dashboard         from './pages/Dashboard';
import AdviserDashboard  from './pages/AdviserDashboard';
import Finder            from './pages/Finder';
import MyGroup           from './pages/MyGroup';
import Adviser           from './pages/Adviser';
import Library           from './pages/Library';
import Profile           from './pages/Profile';
import Advisee           from './pages/Advisee';
import AdviserGroup      from './pages/AdviserGroup';
import StudentList       from './pages/StudentList';
import Admin             from './pages/Admin';
import PasswordChange    from './pages/PasswordChange';
import './styles/global.css';

function Home() {
  const { effectiveRole } = useAuth();
  if (effectiveRole === 'admin' || effectiveRole === 'superadmin') return <Admin />;
  return effectiveRole === 'adviser' ? <AdviserDashboard /> : <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<Login />} />
          <Route path="/change-password" element={<ProtectedRoute><PasswordChange /></ProtectedRoute>} />
          <Route path="/"         element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/finder"   element={<ProtectedRoute roles={['student']}><Finder /></ProtectedRoute>} />
          <Route path="/mygroup"  element={<ProtectedRoute><MyGroup /></ProtectedRoute>} />
          <Route path="/adviser"  element={<ProtectedRoute><Adviser /></ProtectedRoute>} />
          <Route path="/library"  element={<ProtectedRoute><Library /></ProtectedRoute>} />
          <Route path="/profile"  element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/advisee"  element={<ProtectedRoute><Advisee /></ProtectedRoute>} />
          <Route path="/group"    element={<ProtectedRoute><AdviserGroup /></ProtectedRoute>} />
          <Route path="/students" element={<ProtectedRoute roles={['adviser']}><StudentList /></ProtectedRoute>} />
          <Route path="/admin"    element={<ProtectedRoute roles={['admin', 'superadmin']}><Admin /></ProtectedRoute>} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}