import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import '../styles/admin.css';

export default function PasswordChange() {
  const { user, viewRole, updateUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError('Password must include one uppercase letter, one lowercase letter, one number, and one special character.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/password/change`, {
        method: 'POST',
        headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to update your password.');
      updateUser({ ...user, passwordChangeRequired: false });
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <main className="d-flex flex-grow-1 align-items-center justify-content-center p-3">
        <form onSubmit={event => void save(event)} className="admin-form" style={{ maxWidth: 480 }}>
          <h1 className="modal-title-text">Set a new password</h1>
          <p className="modal-sub-text">For account security, change your temporary password before continuing.</p>
          {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
          <label>
            New Password
            <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          <label>
            Confirm Password
            <input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={event => setConfirm(event.target.value)} />
          </label>
          <div className="admin-password-help">Use uppercase, lowercase, a number, and a special character.</div>
          <button className="admin-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save New Password'}</button>
        </form>
      </main>
    </Layout>
  );
}
