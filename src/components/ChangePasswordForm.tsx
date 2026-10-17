import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, readApiResponse } from '../data/api';

const empty = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function ChangePasswordForm() {
  const { user, viewRole } = useAuth();
  const [fields, setFields] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const reset = () => { setFields(empty); setError(''); setSuccess(''); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSuccess('');
    if (fields.newPassword !== fields.confirmPassword) { setError('New passwords do not match.'); return; }
    if (fields.newPassword.length < 8 || new TextEncoder().encode(fields.newPassword).length > 72
      || !/[A-Z]/.test(fields.newPassword) || !/[a-z]/.test(fields.newPassword)
      || !/[0-9]/.test(fields.newPassword) || !/[^A-Za-z0-9]/.test(fields.newPassword)) {
      setError('Use at least 8 characters with an uppercase letter, lowercase letter, number and special character, up to 72 UTF-8 bytes.'); return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/account/password`, {
        method: 'POST', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify(fields),
      });
      await readApiResponse(response, 'Unable to change your password.');
      setFields(empty); setSuccess('Password changed successfully. Other sessions have been signed out.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to change your password.'); }
    finally { setSaving(false); }
  };
  return <form className="settings-form settings-password-form" onSubmit={submit}>
    <fieldset disabled={saving}>
      <legend>Change password</legend>
      <p id="password-help">Use at least 8 characters including an uppercase letter, lowercase letter, number and special character. Maximum 72 UTF-8 bytes. Other sessions will be signed out after saving.</p>
      {error && <div role="alert" className="alert alert-danger">{error}</div>}
      {success && <div role="status" className="alert alert-success">{success}</div>}
      <label>Current password<input type="password" autoComplete="current-password" maxLength={128} required value={fields.currentPassword} onChange={e => { setFields({ ...fields, currentPassword: e.target.value }); setSuccess(''); }} /></label>
      <label>New password<input type="password" autoComplete="new-password" aria-describedby="password-help" minLength={8} maxLength={72} required value={fields.newPassword} onChange={e => { setFields({ ...fields, newPassword: e.target.value }); setSuccess(''); }} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" maxLength={72} required value={fields.confirmPassword} onChange={e => { setFields({ ...fields, confirmPassword: e.target.value }); setSuccess(''); }} /></label>
      <div className="settings-actions"><button type="submit">{saving ? 'Changing password...' : 'Change Password'}</button><button type="button" onClick={reset}>Cancel password change</button></div>
    </fieldset>
  </form>;
}
