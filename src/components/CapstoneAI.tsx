import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';

type MemberProfile = {
  user_id: number;
  profile: {
    skills?: string[];
    tools_and_technologies?: string[];
    project_experience?: string[];
    research_interests?: string[];
    problem_areas?: string[];
    experience_level?: string;
    evidence_summary?: string[];
    missing_information?: string[];
  };
  source_filename: string;
  updated_at: string;
};

type TitleCandidate = {
  title: string;
  description: string;
  problem: string;
  proposed_solution: string;
  relevant_member_skills: string[];
  skills_to_learn: string[];
  intended_users: string[];
  feasibility: 'high' | 'medium' | string;
  reason_for_fit: string;
};

type GenerateResult = {
  shared_strengths?: string[];
  skill_gaps?: string[];
  titles: TitleCandidate[];
};

type ApiError = { message?: string; detail?: string };

export default function CapstoneAI({ groupId }: { groupId: string }) {
  const { user, viewRole } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<TitleCandidate | null>(null);
  const [busy, setBusy] = useState<'load' | 'analyze' | 'generate' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const requestHeaders = useCallback((extra: Record<string, string> = {}) => ({
    ...authHeaders(user, viewRole, extra),
  }), [user, viewRole]);

  const loadSaved = useCallback(async () => {
    if (!user || !groupId) return;
    setBusy('load');
    try {
      const [profilesResponse, titleResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/ai/groups/${encodeURIComponent(groupId)}/profiles`, { headers: requestHeaders() }),
        fetch(`${API_BASE_URL}/ai/groups/${encodeURIComponent(groupId)}/selected-title`, { headers: requestHeaders() }),
      ]);
      const profilesData = await profilesResponse.json() as { profiles?: MemberProfile[]; message?: string };
      const titleData = await titleResponse.json() as { selected_title?: TitleCandidate | null; message?: string };
      if (!profilesResponse.ok) throw new Error(profilesData.message || 'Could not load member profiles.');
      if (!titleResponse.ok) throw new Error(titleData.message || 'Could not load the selected title.');
      setProfiles(profilesData.profiles || []);
      setSelectedTitle(titleData.selected_title || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load saved AI data.');
    } finally {
      setBusy(null);
    }
  }, [user, groupId, requestHeaders]);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  const analyze = async () => {
    if (!user || !file) { setError('Choose a PDF, DOCX, or TXT document first.'); return; }
    const allowed = /\.(pdf|docx|txt)$/i.test(file.name);
    if (!allowed) { setError('Only PDF, DOCX, and TXT files are supported.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('The file must be 10 MB or smaller.'); return; }
    setBusy('analyze'); setError(''); setNotice(''); setResult(null);
    try {
      const url = `${API_BASE_URL}/ai/groups/${encodeURIComponent(groupId)}/analyze-member?filename=${encodeURIComponent(file.name)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders({ 'Content-Type': 'application/octet-stream' }),
        body: file,
      });
      const data = await response.json() as { success?: boolean; member_profile?: MemberProfile['profile']; message?: string; detail?: string };
      if (!response.ok) throw new Error(data.message || data.detail || 'Document analysis failed.');
      setFile(null);
      setNotice('Document analyzed and your member profile was saved.');
      await loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Document analysis failed.');
    } finally { setBusy(null); }
  };

  const generate = async () => {
    if (!user) return;
    setBusy('generate'); setError(''); setNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/ai/groups/${encodeURIComponent(groupId)}/generate-titles`, {
        method: 'POST', headers: requestHeaders({ 'Content-Type': 'application/json' }), body: '{}',
      });
      const data = await response.json() as GenerateResult & ApiError;
      if (!response.ok) throw new Error(data.message || data.detail || 'Title generation failed.');
      setResult(data); setNotice('Title candidates generated. Choose one to save for your group.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Title generation failed.');
    } finally { setBusy(null); }
  };

  const saveTitle = async (title: TitleCandidate) => {
    if (!user) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/ai/groups/${encodeURIComponent(groupId)}/select-title`, {
        method: 'POST',
        headers: requestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title }),
      });
      const data = await response.json() as { success?: boolean; message?: string; selected_title?: TitleCandidate };
      if (!response.ok) throw new Error(data.message || 'Could not save the selected title.');
      setSelectedTitle(data.selected_title || title);
      setNotice('Selected title saved. Adviser matching can now use this title.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the selected title.');
    } finally { setBusy(null); }
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--card-bg, rgba(255,255,255,.04))',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 12,
    padding: 18,
    color: 'var(--text-primary, inherit)',
  };
  const buttonStyle: React.CSSProperties = {
    border: 0, borderRadius: 8, padding: '9px 13px', fontWeight: 700,
    background: 'var(--amber, #f59e0b)', color: 'var(--navy, #111827)',
    cursor: 'pointer',
  };

  return (
    <section style={{ marginTop: 24, display: 'grid', gap: 16 }} aria-labelledby="capstone-ai-heading">
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <i className="ti ti-brain" style={{ fontSize: 24 }} aria-hidden="true" />
          <h2 id="capstone-ai-heading" style={{ margin: 0, fontSize: 20 }}>AI Capstone Title Generator</h2>
        </div>
        <p style={{ opacity: .78, marginTop: 0 }}>
          Each group member can upload a CV, skills summary, or project description. JuanFinder extracts relevant skills and combines saved member profiles to suggest achievable capstone titles.
        </p>
        <label htmlFor="capstone-member-file" style={{ display: 'block', fontWeight: 600, marginBottom: 7 }}>Member document (PDF, DOCX, TXT; max 10 MB)</label>
        <input id="capstone-member-file" type="file" accept=".pdf,.docx,.txt" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'block', marginBottom: 12, maxWidth: '100%' }} />
        {file && <p style={{ fontSize: 13, opacity: .75 }}>Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={buttonStyle} disabled={!file || busy !== null} onClick={() => void analyze()}>
            {busy === 'analyze' ? 'Analyzing document…' : 'Analyze & Save My Profile'}
          </button>
          <button type="button" style={{ ...buttonStyle, background: 'rgba(255,255,255,.1)', color: 'inherit' }} disabled={busy !== null || profiles.length === 0} onClick={() => void generate()}>
            {busy === 'generate' ? 'Generating titles…' : 'Generate Group Titles'}
          </button>
          <button type="button" style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: 'inherit' }} disabled={busy !== null} onClick={() => void loadSaved()}>
            Refresh
          </button>
        </div>
        <p style={{ marginBottom: 0, marginTop: 10, fontSize: 12, opacity: .7 }}>
          Profiles saved: {profiles.length}. Each student's latest analyzed document replaces their previous profile for this group.
        </p>
        {busy === 'load' && <p role="status">Loading saved profiles…</p>}
        {error && <div role="alert" style={{ marginTop: 12, color: '#fca5a5' }}>{error}</div>}
        {notice && <div role="status" style={{ marginTop: 12, color: '#86efac' }}>{notice}</div>}
      </div>

      {profiles.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, fontSize: 17 }}>Analyzed member profiles</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            {profiles.map(profile => (
              <div key={profile.user_id} style={{ borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 12 }}>
                <strong>Group member #{profile.user_id}</strong>
                <div style={{ fontSize: 12, opacity: .65 }}>{profile.source_filename} · Updated {new Date(profile.updated_at).toLocaleString()}</div>
                <p><strong>Skills:</strong> {(profile.profile.skills || []).join(', ') || 'Not identified'}</p>
                <p><strong>Tools:</strong> {(profile.profile.tools_and_technologies || []).join(', ') || 'Not identified'}</p>
                <p><strong>Project experience:</strong> {(profile.profile.project_experience || []).join('; ') || 'Not identified'}</p>
                <p><strong>Interests:</strong> {(profile.profile.research_interests || []).join(', ') || 'Not identified'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedTitle && (
        <div style={{ ...cardStyle, borderColor: 'var(--amber, #f59e0b)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, opacity: .8 }}>CURRENT SELECTED TITLE</div>
          <h3 style={{ marginBottom: 8 }}>{selectedTitle.title}</h3>
          <p>{selectedTitle.description}</p>
          {selectedTitle.problem && <p><strong>Problem:</strong> {selectedTitle.problem}</p>}
          {selectedTitle.proposed_solution && <p><strong>Proposed solution:</strong> {selectedTitle.proposed_solution}</p>}
          <p style={{ fontSize: 12, opacity: .7 }}>Adviser recommendations will be connected after this title-selection flow is tested.</p>
        </div>
      )}

      {result && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, fontSize: 18 }}>Suggested capstone titles</h3>
          {result.shared_strengths?.length ? <p><strong>Shared strengths:</strong> {result.shared_strengths.join(', ')}</p> : null}
          {result.skill_gaps?.length ? <p><strong>Skills to develop:</strong> {result.skill_gaps.join(', ')}</p> : null}
          <div style={{ display: 'grid', gap: 12 }}>
            {result.titles.map((title, index) => (
              <article key={title.title} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, opacity: .7 }}>OPTION {index + 1} · {title.feasibility || 'Feasibility to review'}</div>
                <h4 style={{ margin: '6px 0 8px' }}>{title.title}</h4>
                <p>{title.description}</p>
                {title.problem && <p><strong>Problem:</strong> {title.problem}</p>}
                {title.proposed_solution && <p><strong>Solution:</strong> {title.proposed_solution}</p>}
                {title.relevant_member_skills?.length > 0 && <p><strong>Relevant skills:</strong> {title.relevant_member_skills.join(', ')}</p>}
                {title.skills_to_learn?.length > 0 && <p><strong>Skills to learn:</strong> {title.skills_to_learn.join(', ')}</p>}
                {title.intended_users?.length > 0 && <p><strong>Intended users:</strong> {title.intended_users.join(', ')}</p>}
                {title.reason_for_fit && <p><strong>Why it fits:</strong> {title.reason_for_fit}</p>}
                <button type="button" style={buttonStyle} disabled={busy !== null} onClick={() => void saveTitle(title)}>
                  {busy === 'save' ? 'Saving…' : 'Select this title'}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
