import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, readApiResponse } from '../data/api';
import '../styles/workspace.css';

type ProfileForm = { firstName: string; lastName: string; bio: string; gender: string; birthdate: string; socials: string; skills: string; requirements: string[] };
const empty: ProfileForm = { firstName: '', lastName: '', bio: '', gender: '', birthdate: '', socials: '', skills: '', requirements: [] };
type ProfileResponse = { FirstName: string; LastName: string; Bio: string; Gender: string; Birthdate: string; Socials: string; Skills: string[]; Requirements: string };

export default function Settings() {
  const { user, viewRole, effectiveRole, updateUser } = useAuth();
  const isAdviser = effectiveRole === 'adviser';
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/profile`, { headers: authHeaders(user, viewRole), signal: controller.signal })
      .then(response => readApiResponse<ProfileResponse>(response, 'Unable to load your profile.'))
      .then(data => {
        const value = { firstName: data.FirstName || '', lastName: data.LastName || '', bio: data.Bio || '', gender: data.Gender || '', birthdate: data.Birthdate || '', socials: data.Socials || '', skills: (data.Skills || []).join(', '), requirements: (data.Requirements || '').split('\n').filter(Boolean) };
        if (!controller.signal.aborted) { setForm(value); setSaved(value); }
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, viewRole]); // Fetch persisted fields when the signed-in identity changes.

  const change = (key: keyof ProfileForm, value: string) => { setForm(current => ({ ...current, [key]: value })); setSuccess(''); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      const body = isAdviser ? { bio: form.bio, gender: form.gender, requirements: form.requirements } : { ...form, skills: form.skills.split(',').map(s => s.trim()).filter(Boolean) };
      const response = await fetch(`${API_BASE_URL}${isAdviser ? '/adviser/profile' : '/profile'}`, { method: 'PATCH', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      await readApiResponse(response, 'Unable to save your profile.');
      // Reload the API's canonical values rather than retaining untrimmed form input.
      const persisted = await fetch(`${API_BASE_URL}/profile`, { headers: authHeaders(user, viewRole) }).then(r => readApiResponse<ProfileResponse>(r, 'Changes saved, but profile refresh failed. Reload Settings to verify.'));
      const value = { ...form, firstName: persisted.FirstName || '', lastName: persisted.LastName || '', bio: persisted.Bio || '', gender: persisted.Gender || '', birthdate: persisted.Birthdate || '', socials: persisted.Socials || '', skills: (persisted.Skills || []).join(', '), requirements: (persisted.Requirements || '').split('\n').filter(Boolean) };
      setForm(value); setSaved(value);
      if (!isAdviser && user) updateUser({ ...user, name: `${value.firstName} ${value.lastName}`.trim() });
      setSuccess('Profile updated successfully. Your changes are visible in My Profile.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save your profile.'); }
    finally { setSaving(false); }
  };

  return <Layout><main className="settings-page">
    <header><h1>Settings</h1><p>Edit your profile information.</p><Link to="/profile">View My Profile</Link></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {success && <div className="alert alert-success" role="status">{success}</div>}
    {loading ? <p role="status">Loading profile…</p> : <form className="settings-form" onSubmit={save}>
      <fieldset disabled={saving || (!!error && !saved.firstName)}>
        <legend>Profile details</legend>
        {!isAdviser && <div className="settings-name-fields">{(['firstName', 'lastName'] as const).map(key => <label key={key}>{key === 'firstName' ? 'First Name' : 'Last Name'}<input value={form[key]} maxLength={80} required onChange={e => change(key, e.target.value)} /></label>)}</div>}
        <label>Bio<textarea aria-label="Bio" rows={4} maxLength={2000} value={form.bio} onChange={e => change('bio', e.target.value)} /></label>
        <label>Gender<select aria-label="Gender" value={form.gender} onChange={e => change('gender', e.target.value)}><option value="">Not provided</option>{['Male', 'Female', 'Prefer not to say'].map(g => <option key={g}>{g}</option>)}</select></label>
        {!isAdviser && <>
          <label>Birthdate<input type="date" value={form.birthdate} max={new Date().toLocaleDateString('en-CA')} onChange={e => change('birthdate', e.target.value)} /></label>
          <label>Socials<input maxLength={500} value={form.socials} onChange={e => change('socials', e.target.value)} /></label>
          <label>Skills (comma separated)<input value={form.skills} onChange={e => change('skills', e.target.value)} /></label>
        </>}
        {isAdviser && <section aria-label="Requirements"><h2>Student requirements</h2>{form.requirements.map((requirement, i) => <div className="settings-requirement" key={i}><label>Requirement {i + 1}<input value={requirement} maxLength={250} onChange={e => setForm(current => ({ ...current, requirements: current.requirements.map((r, index) => index === i ? e.target.value : r) }))} /></label><button type="button" aria-label={`Remove requirement ${i + 1}`} onClick={() => setForm(current => ({ ...current, requirements: current.requirements.filter((_, index) => index !== i) }))}>Remove</button></div>)}<button type="button" disabled={form.requirements.length >= 20} onClick={() => setForm(current => ({ ...current, requirements: [...current.requirements, ''] }))}>Add Requirement</button></section>}
        <div className="settings-actions"><button type="submit">{saving ? 'Saving…' : 'Save Changes'}</button><button type="button" onClick={() => { setForm(saved); setError(''); setSuccess(''); }}>Cancel</button></div>
      </fieldset>
    </form>}
  </main></Layout>;
}
