import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login     from './pages/Login';
import Dashboard from './pages/Dashboard';
import Finder    from './pages/Finder';
import MyGroup   from './pages/MyGroup';
import Adviser   from './pages/Adviser';
import Library   from './pages/Library';
import Profile   from './pages/Profile';
import './styles/global.css';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"   element={<Login />} />
          <Route path="/"        element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/finder"  element={<ProtectedRoute><Finder /></ProtectedRoute>} />
          <Route path="/mygroup" element={<ProtectedRoute><MyGroup /></ProtectedRoute>} />
          <Route path="/adviser" element={<ProtectedRoute><Adviser /></ProtectedRoute>} />
          <Route path="/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}